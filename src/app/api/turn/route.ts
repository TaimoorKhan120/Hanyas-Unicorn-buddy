// POST /api/turn — one spoken turn. multipart/form-data: audio (Blob), durationMs. In dev mock mode: text.
import { after, NextResponse } from "next/server";
import { requireDeviceChild } from "@/lib/auth";
import { getSettings } from "@/lib/children";
import { getDb } from "@/lib/db";
import { assertSameOrigin, HttpError, route } from "@/lib/http";
import { recordUsage } from "@/lib/limits";
import { extractAndSave } from "@/memory/extract";
import { runTurn } from "@/conversation/orchestrator";
import { PRICES, providerMode } from "@/providers/config";
import { transcribe } from "@/providers/speech";

export const maxDuration = 60;
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const AUDIO_TYPES = /^audio\/(webm|mp4|mpeg|ogg|wav|x-m4a|aac)/;

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const childId = await requireDeviceChild();
  const db = await getDb();
  const form = await req.formData().catch(() => {
    throw new HttpError(400, "invalid_input");
  });

  let text: string;
  const audio = form.get("audio");
  if (audio instanceof Blob) {
    if (audio.size === 0) throw new HttpError(400, "empty_audio");
    if (audio.size > MAX_AUDIO_BYTES) throw new HttpError(413, "audio_too_long");
    const type = audio.type.split(";")[0];
    if (!AUDIO_TYPES.test(type)) throw new HttpError(415, "unsupported_audio");
    const ext = type.includes("mp4") || type.includes("m4a") ? "mp4" : type.split("/")[1];
    text = await transcribe(audio, `turn.${ext}`); // audio is only held in memory for this request
    const seconds = Math.min(60, Math.max(0, Number(form.get("durationMs")) / 1000 || audio.size / 16000));
    await recordUsage(db, childId, "openai", "stt", seconds, "seconds", (seconds / 60) * PRICES.sttPerMinute);
  } else if (providerMode() === "mock" && typeof form.get("text") === "string") {
    text = String(form.get("text"));
  } else {
    throw new HttpError(400, "invalid_input");
  }

  const result = await runTurn(db, childId, text);

  if (result.memoryJob) {
    const job = result.memoryJob;
    // Runs after the response is sent; a failure here never affects the conversation or existing memories.
    after(async () => {
      try {
        const { usage } = await extractAndSave(db, job);
        await recordUsage(db, childId, "anthropic", "memory_tokens_in", usage.inputTokens, "tokens", (usage.inputTokens / 1e6) * PRICES.claudeInputPerMTok);
        await recordUsage(db, childId, "anthropic", "memory_tokens_out", usage.outputTokens, "tokens", (usage.outputTokens / 1e6) * PRICES.claudeOutputPerMTok);
      } catch (err) {
        console.error("[memory] extraction skipped:", err instanceof Error ? err.name : "unknown");
      }
    });
  }

  const settings = await getSettings(db, childId);
  return NextResponse.json({
    say: result.say,
    mood: result.mood,
    sig: result.sig,
    transcript: settings.show_transcript ? result.transcript : null,
    mock: providerMode() === "mock",
  });
});
