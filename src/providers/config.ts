// Provider configuration. Secrets are read server-side only (no NEXT_PUBLIC_ prefix anywhere).

export class ProviderUnavailable extends Error {
  constructor(public readonly provider: string, message: string) {
    super(message);
  }
}

export function providerMode(): "live" | "mock" {
  if (process.env.PROVIDER_MODE !== "mock") return "live";
  // Never silently substitute fake AI in a live deployment.
  if (process.env.NODE_ENV === "production") throw new Error("PROVIDER_MODE=mock is refused when NODE_ENV=production");
  return "mock";
}

export function requireKey(name: "ANTHROPIC_API_KEY" | "OPENAI_API_KEY"): string {
  const v = process.env[name];
  if (!v) throw new ProviderUnavailable(name, `${name} is not configured`);
  return v;
}

export const models = {
  claude: () => process.env.CLAUDE_MODEL || "claude-opus-5-5",
  stt: () => process.env.STT_MODEL || "gpt-4o-mini-transcribe",
  tts: () => process.env.TTS_MODEL || "gpt-4o-mini-tts",
  ttsVoice: () => process.env.TTS_VOICE || "shimmer",
};

// Estimated prices (USD), checked 2026-10-10. Estimates only — see docs/04-external-services.md.
export const PRICES = {
  claudeInputPerMTok: 4,
  claudeOutputPerMTok: 20,
  sttPerMinute: 0.003,
  ttsPerMinute: 0.015,
  ttsWordsPerMinute: 150,
};
