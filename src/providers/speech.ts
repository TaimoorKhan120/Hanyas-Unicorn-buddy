// Speech-to-text, text-to-speech and moderation adapters (OpenAI REST). Audio is never written to disk.
import { models, providerMode, ProviderUnavailable, requireKey } from "./config";
import { LUMI } from "@/character/lumi";

const OPENAI = "https://api.openai.com/v1";

async function openai(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(OPENAI + path, {
      ...init,
      headers: { Authorization: `Bearer ${requireKey("OPENAI_API_KEY")}`, ...init.headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof ProviderUnavailable) throw err;
    throw new ProviderUnavailable("openai", `OpenAI ${path} unreachable or timed out`);
  }
  if (res.status === 401 || res.status === 403) throw new ProviderUnavailable("openai", "OpenAI credentials rejected");
  if (res.status === 429) throw new ProviderUnavailable("openai", "OpenAI rate limit or quota exhausted");
  if (!res.ok) throw new ProviderUnavailable("openai", `OpenAI ${path} failed with ${res.status}`);
  return res;
}

export async function transcribe(audio: Blob, filename: string): Promise<string> {
  if (providerMode() === "mock") throw new ProviderUnavailable("mock", "Speech recognition is not available in mock mode; type instead");
  const form = new FormData();
  form.set("file", audio, filename);
  form.set("model", models.stt());
  form.set("language", "en");
  form.set("response_format", "json");
  // Vocabulary hint; contains no personal data.
  form.set("prompt", "A young child chatting with Lumi the unicorn about Moonpetal Meadow, Pip, Bramble and Dew.");
  const res = await openai("/audio/transcriptions", { method: "POST", body: form }, 15_000);
  const json = (await res.json()) as { text?: unknown };
  return typeof json.text === "string" ? json.text.trim() : "";
}

export interface VoiceSettings { voice?: string; speed?: number }

/** Returns a streaming audio/mpeg body, or null in mock mode (the client then uses the browser's voice). */
export async function synthesize(text: string, settings: VoiceSettings): Promise<ReadableStream<Uint8Array> | null> {
  if (providerMode() === "mock") return null;
  const res = await openai(
    "/audio/speech",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: models.tts(),
        voice: settings.voice || models.ttsVoice(),
        input: text,
        instructions: LUMI.voice.ttsInstructions,
        speed: clamp(settings.speed ?? 0.95, 0.8, 1.2),
        response_format: "mp3",
      }),
    },
    20_000,
  );
  return res.body;
}

export interface ModerationResult { flagged: boolean; categories: string[] }

/** Throws ProviderUnavailable on failure — callers must fail closed. */
export async function moderate(text: string): Promise<ModerationResult> {
  if (providerMode() === "mock") return { flagged: false, categories: [] };
  const res = await openai(
    "/moderations",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "omni-moderation-latest", input: text }) },
    8_000,
  );
  const json = (await res.json()) as { results?: { flagged: boolean; categories: Record<string, boolean> }[] };
  const r = json.results?.[0];
  if (!r) throw new ProviderUnavailable("openai", "malformed moderation response");
  return { flagged: r.flagged, categories: Object.entries(r.categories).filter(([, v]) => v).map(([k]) => k) };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
