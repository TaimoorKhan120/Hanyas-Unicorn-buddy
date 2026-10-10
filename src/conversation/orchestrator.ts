// One conversation turn, after speech-to-text. Every reply that leaves here has passed output validation.
import { CHARACTER_VERSION } from "@/character/lumi";
import type { Mood } from "@/character/stateMachine";
import { getActiveStage, getProfile, getSettings, type Settings } from "@/lib/children";
import { signSpeech } from "@/lib/crypto";
import type { Db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { checkLimits, purgeTranscripts, recordSafetyEvent, recordUsage, SESSION_GAP_MINUTES } from "@/lib/limits";
import { purgeExpiredMemories } from "@/memory/store";
import { retrieveMemories } from "@/memory/retrieve";
import { PRICES } from "@/providers/config";
import { generateReply, ModelRefused, type Msg } from "@/providers/llm";
import { moderate } from "@/providers/speech";
import { assessInput, validateOutput } from "@/safety/rules";
import { buildMessages, buildSystemPrompt } from "./prompt";

export const COMFORT_FALLBACK = "That sounds like a big feeling. Please tell a grown-up who loves you about it. They are really good at helping.";
export const UNHEARD_LINE = "Oops, my ears were full of glitter! Can you say that again?";
const SELF_HARM_MODERATION = /^self-harm/;

export interface TurnResult {
  say: string;
  mood: Mood;
  sig: string;
  transcript: string;
  sessionId: string | null;
  /** Present only when memory extraction is permitted for this turn. */
  memoryJob: { childId: string; sessionId: string; childText: string; unicornText: string } | null;
}

export async function runTurn(db: Db, childId: string, rawText: string): Promise<TurnResult> {
  const [settings, profile, stage] = await Promise.all([getSettings(db, childId), getProfile(db, childId), getActiveStage(db, childId)]);
  await purgeTranscripts(db, childId, settings);
  await purgeExpiredMemories(db, childId);

  const limit = await checkLimits(db, childId, settings);
  if (limit) throw new HttpError(429, limit);

  const text = rawText.trim().slice(0, 600);
  if (text.replace(/[^a-z]/gi, "").length < 2) {
    return { say: UNHEARD_LINE, mood: "curious", sig: signSpeech(UNHEARD_LINE, childId), transcript: text, sessionId: null, memoryJob: null };
  }

  const input = assessInput(text);
  const [inputMod, memories] = await Promise.all([
    moderate(input.redacted).catch(() => null), // output moderation below is the fail-closed gate
    settings.memory_enabled ? retrieveMemories(db, childId, input.redacted).catch(() => []) : Promise.resolve([]),
  ]);
  if (inputMod?.categories.some((c) => SELF_HARM_MODERATION.test(c)) && !input.flags.includes("self_harm")) {
    input.flags.push("self_harm");
    input.sensitive = input.comforting = true;
  }

  const sessionId = await currentSession(db, childId, stage.id);
  const recent = await recentTurns(db, sessionId);

  let say: string;
  let mood: Mood;
  let blocked: string[] = [];
  if (input.scripted || input.flags.includes("self_harm")) {
    say = input.scripted ?? COMFORT_FALLBACK;
    mood = "comforting";
  } else {
    const system = buildSystemPrompt({
      childName: profile.display_name,
      stage,
      activities: settings.activities,
      birthdayToday: settings.birthday_celebration && isBirthday(profile.birthday, settings),
    });
    try {
      const { reply, usage } = await generateReply(system, buildMessages(recent, memories, input.redacted, input.comforting));
      await recordUsage(db, childId, "anthropic", "reply_tokens_in", usage.inputTokens, "tokens", (usage.inputTokens / 1e6) * PRICES.claudeInputPerMTok);
      await recordUsage(db, childId, "anthropic", "reply_tokens_out", usage.outputTokens, "tokens", (usage.outputTokens / 1e6) * PRICES.claudeOutputPerMTok);
      ({ say, mood } = await validated(reply.say, reply.mood, stage, input.comforting, (r) => (blocked = r)));
    } catch (err) {
      if (!(err instanceof ModelRefused)) throw err;
      blocked = ["model_refusal"];
      ({ say, mood } = fallback(stage, input.comforting));
    }
  }

  await db.tx(async (q) => {
    await q.query("INSERT INTO conversation_turns (session_id, child_id, role, text, sensitive) VALUES ($1, $2, 'child', $3, $4)", [sessionId, childId, input.redacted, input.sensitive]);
    await q.query("INSERT INTO conversation_turns (session_id, child_id, role, text, sensitive, created_at) VALUES ($1, $2, 'unicorn', $3, $4, now() + interval '1 millisecond')", [sessionId, childId, say, input.sensitive]);
    await q.query("UPDATE conversation_sessions SET last_turn_at = now() WHERE id = $1", [sessionId]);
  });

  if (settings.safety_alerts !== "off") {
    for (const f of input.flags.filter((f) => f !== "personal_info" && f !== "danger")) await recordSafetyEvent(db, childId, f, input.scripted ? "scripted_reply" : "guided_reply");
    for (const r of blocked) await recordSafetyEvent(db, childId, `output_${r}`, "fallback_spoken");
  }

  const memoryJob = settings.memory_enabled && !input.sensitive && !input.flags.includes("injection") && blocked.length === 0 && !input.scripted
    ? { childId, sessionId, childText: input.redacted, unicornText: say }
    : null;
  return { say, mood, sig: signSpeech(say, childId), transcript: input.redacted, sessionId, memoryJob };
}

async function validated(raw: string, mood: Mood, stage: Parameters<typeof validateOutput>[1] & { fallbackLines: string[] }, comforting: boolean, onBlock: (r: string[]) => void) {
  const verdict = validateOutput(raw, stage);
  let reasons = verdict.reasons;
  if (verdict.ok) {
    try {
      const mod = await moderate(verdict.text);
      if (mod.flagged) reasons = mod.categories.map((c) => `moderation_${c}`);
    } catch {
      reasons = ["moderation_unavailable"]; // fail closed: never speak unmoderated text
    }
  }
  if (reasons.length) {
    onBlock(reasons);
    return fallback(stage, comforting);
  }
  return { say: verdict.text, mood };
}

function fallback(stage: { fallbackLines: string[] }, comforting: boolean): { say: string; mood: Mood } {
  if (comforting) return { say: COMFORT_FALLBACK, mood: "comforting" };
  return { say: stage.fallbackLines[Math.floor(Math.random() * stage.fallbackLines.length)], mood: "curious" };
}

async function currentSession(db: Db, childId: string, stageId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "SELECT id FROM conversation_sessions WHERE child_id = $1 AND last_turn_at > now() - $2 * interval '1 minute' ORDER BY last_turn_at DESC LIMIT 1",
    [childId, SESSION_GAP_MINUTES]);
  if (rows[0]) return rows[0].id;
  const created = await db.query<{ id: string }>(
    "INSERT INTO conversation_sessions (child_id, character_version, stage_id) VALUES ($1, $2, $3) RETURNING id", [childId, CHARACTER_VERSION, stageId]);
  return created.rows[0].id;
}

/** Bounded recent-context window: the last 10 turns of the current session only. */
async function recentTurns(db: Db, sessionId: string): Promise<Msg[]> {
  const { rows } = await db.query<{ role: string; text: string }>(
    "SELECT role, text FROM (SELECT role, text, created_at FROM conversation_turns WHERE session_id = $1 ORDER BY created_at DESC LIMIT 10) t ORDER BY created_at",
    [sessionId]);
  const msgs: Msg[] = rows.map((r) => ({ role: r.role === "child" ? "user" : "assistant", content: r.text }));
  while (msgs[0]?.role === "assistant") msgs.shift();
  return msgs;
}

function isBirthday(birthday: string | null, s: Settings): boolean {
  if (!birthday) return false;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: s.timezone, month: "2-digit", day: "2-digit" }).format(new Date());
  return birthday.slice(5) === today;
}
