// Orchestrator safety paths with controllable (mocked) providers. These are MOCKED-provider tests.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { family, freshDb } from "./helpers";
import type { Db } from "@/lib/db";
import { ProviderUnavailable } from "@/providers/config";
import { insertMemory } from "@/memory/store";
import { decideStage, getActiveStage, proposeStage, revertStage, stageHistory } from "@/lib/children";

const state = vi.hoisted(() => ({
  reply: { say: "Ooh, purple is lovely! What's purple in your room?", mood: "curious" as const } as { say: string; mood: "happy" | "curious" | "comforting" | "neutral" },
  replyError: null as Error | null,
  moderation: { flagged: false, categories: [] as string[] } as { flagged: boolean; categories: string[] } | "down",
  lastMessages: [] as { role: string; content: string }[],
  calls: 0,
}));

vi.mock("@/providers/llm", async (orig) => ({
  ...(await orig<typeof import("@/providers/llm")>()),
  generateReply: async (_system: string, messages: { role: string; content: string }[]) => {
    state.calls++;
    state.lastMessages = messages;
    if (state.replyError) throw state.replyError;
    return { reply: state.reply, usage: { inputTokens: 1000, outputTokens: 50 } };
  },
}));
vi.mock("@/providers/speech", async (orig) => ({
  ...(await orig<typeof import("@/providers/speech")>()),
  moderate: async () => {
    if (state.moderation === "down") throw new ProviderUnavailable("openai", "down");
    return state.moderation;
  },
}));

const { runTurn, COMFORT_FALLBACK, UNHEARD_LINE } = await import("@/conversation/orchestrator");
const { getStage } = await import("@/character/stages");
const { SCRIPTED } = await import("@/safety/rules");

let db: Db;
let childId: string;
beforeEach(async () => {
  db = await freshDb();
  ({ childId } = await family(db));
  state.reply = { say: "Ooh, purple is lovely! What's purple in your room?", mood: "curious" };
  state.replyError = null;
  state.moderation = { flagged: false, categories: [] };
  state.calls = 0;
});

const fallbacks = getStage("5-6").fallbackLines;

describe("never speak unvalidated text", () => {
  it("passes a clean reply through and records usage", async () => {
    const r = await runTurn(db, childId, "my favourite colour is purple");
    expect(r.say).toBe(state.reply.say);
    expect(r.memoryJob).not.toBeNull();
    const usage = (await db.query("SELECT count(*)::int AS n FROM usage_records WHERE provider = 'anthropic'")).rows[0];
    expect(usage).toEqual({ n: 2 });
  });

  it("replaces a rule-violating reply with a fallback and logs a content-free event", async () => {
    state.reply = { say: "Okay, it will be our little secret!", mood: "happy" };
    const r = await runTurn(db, childId, "can you keep a secret");
    expect(fallbacks).toContain(r.say);
    expect(r.memoryJob).toBeNull();
    const ev = (await db.query("SELECT category, action FROM safety_events ORDER BY category")).rows;
    expect(ev).toContainEqual({ category: "output_secrecy", action: "fallback_spoken" });
    expect(JSON.stringify(ev)).not.toContain("secret!");
  });

  it("fails closed when moderation is unavailable", async () => {
    state.moderation = "down";
    const r = await runTurn(db, childId, "tell me a joke");
    expect(fallbacks).toContain(r.say);
  });

  it("replaces a moderation-flagged reply", async () => {
    state.moderation = { flagged: true, categories: ["violence"] };
    expect(fallbacks).toContain((await runTurn(db, childId, "tell me a story")).say);
  });

  it("uses the comforting fallback when the child was upset", async () => {
    state.reply = { say: "Don't tell your mummy.", mood: "neutral" };
    const r = await runTurn(db, childId, "I'm sad and scared");
    expect(r.say).toBe(COMFORT_FALLBACK);
    expect(r.mood).toBe("comforting");
  });
});

describe("difficult conversations", () => {
  it("self-harm gets a scripted reply without calling the model", async () => {
    const r = await runTurn(db, childId, "I want to hurt myself");
    expect(r.say).toBe(SCRIPTED.self_harm);
    expect(state.calls).toBe(0);
    expect(r.memoryJob).toBeNull();
  });

  it("disclosure is guided, marked sensitive, and recorded by category only", async () => {
    await runTurn(db, childId, "my uncle hits me");
    expect(state.lastMessages.at(-1)!.content).toContain("Do NOT ask probing or leading questions");
    const turn = (await db.query("SELECT sensitive FROM conversation_turns WHERE role = 'child'")).rows[0];
    expect(turn).toEqual({ sensitive: true });
    const ev = (await db.query("SELECT category FROM safety_events")).rows.map((r) => r.category);
    expect(ev).toContain("disclosure");
  });

  it("no safety events when the parent turned them off", async () => {
    await db.query("UPDATE parent_settings SET safety_alerts = 'off' WHERE child_id = $1", [childId]);
    await runTurn(db, childId, "my uncle hits me");
    expect((await db.query("SELECT count(*)::int AS n FROM safety_events")).rows[0]).toEqual({ n: 0 });
  });
});

describe("provider failures and edge cases", () => {
  it("empty transcript asks again without calling the model or storing a turn", async () => {
    const r = await runTurn(db, childId, "  ... ");
    expect(r.say).toBe(UNHEARD_LINE);
    expect(state.calls).toBe(0);
    expect((await db.query("SELECT count(*)::int AS n FROM conversation_turns")).rows[0]).toEqual({ n: 0 });
  });

  it("LLM outage surfaces as ProviderUnavailable and leaves memory untouched", async () => {
    await insertMemory(db, childId, { category: "preference", content: "Likes purple", provenance: "child_said", confidence: null });
    state.replyError = new ProviderUnavailable("anthropic", "down");
    await expect(runTurn(db, childId, "hello")).rejects.toBeInstanceOf(ProviderUnavailable);
    expect((await db.query("SELECT count(*)::int AS n FROM memory_items")).rows[0]).toEqual({ n: 1 });
    expect((await db.query("SELECT count(*)::int AS n FROM conversation_turns")).rows[0]).toEqual({ n: 0 });
  });

  it("only relevant memories reach the model, labelled with provenance", async () => {
    await insertMemory(db, childId, { category: "story", content: "Pretend butterfly Flutter found a glowing acorn", provenance: "pretend_play", confidence: null });
    await insertMemory(db, childId, { category: "preference", content: "Favourite food is mango", provenance: "child_said", confidence: null });
    await runTurn(db, childId, "let's continue the butterfly adventure");
    const sent = state.lastMessages.at(-1)!.content;
    expect(sent).toContain("PRETEND story detail] Pretend butterfly Flutter");
    expect(sent).not.toContain("mango");
  });

  it("recent context is bounded to the current session", async () => {
    for (let i = 0; i < 8; i++) await runTurn(db, childId, `tell me about animal number ${i}`);
    expect(state.lastMessages.length).toBeLessThanOrEqual(11);
    expect(state.lastMessages[0].role).toBe("user");
  });

  it("identifiers are redacted before reaching the model", async () => {
    await runTurn(db, childId, "my phone number is 0300 1234567");
    expect(state.lastMessages.at(-1)!.content).not.toContain("1234567");
  });
});

describe("developmental stages", () => {
  it("starts at 5–6 regardless of age, and age alone never changes it", async () => {
    await db.query("UPDATE child_profiles SET age = 9 WHERE id = $1", [childId]);
    expect((await getActiveStage(db, childId)).id).toBe("5-6");
  });

  it("propose → reject keeps the current stage", async () => {
    const p = await proposeStage(db, childId, "7-8");
    await decideStage(db, childId, p, false);
    expect((await getActiveStage(db, childId)).id).toBe("5-6");
  });

  it("untested stages require explicit acknowledgement; approve and roll back", async () => {
    const p = await proposeStage(db, childId, "7-8");
    await expect(decideStage(db, childId, p, true)).rejects.toThrow("untested_stage_ack_required");
    await decideStage(db, childId, p, true, true);
    expect((await getActiveStage(db, childId)).id).toBe("7-8");
    await revertStage(db, childId);
    expect((await getActiveStage(db, childId)).id).toBe("5-6");
    const statuses = (await stageHistory(db, childId)).map((h) => `${h.stage_id}:${h.status}`);
    expect(statuses.filter((s) => s.endsWith(":active"))).toEqual(["5-6:active"]);
    expect(statuses).toContain("7-8:superseded");
  });

  it("the database enforces a single active stage", async () => {
    await expect(db.query("INSERT INTO stage_history (child_id, stage_id, config_version, status) VALUES ($1, '7-8', 1, 'active')", [childId])).rejects.toThrow();
  });
});
