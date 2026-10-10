// Language-model adapter. Anthropic Claude in live mode; deterministic fake in dev mock mode.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { models, providerMode, ProviderUnavailable, requireKey } from "./config";

export const ReplySchema = z.object({
  say: z.string().describe("Exactly what Lumi says aloud. Plain spoken words only."),
  mood: z.enum(["happy", "curious", "comforting", "neutral"]),
});
export type Reply = z.infer<typeof ReplySchema>;

export const CandidateSchema = z.object({
  memories: z.array(
    z.object({
      category: z.enum(["preference", "interest", "story", "game", "achievement", "communication"]),
      content: z.string().describe("Short third-person note, under 20 words, e.g. 'Likes purple butterflies'."),
      provenance: z.enum(["child_said", "inferred", "pretend_play"]),
      confidence: z.number().min(0).max(1).nullable().describe("Only for inferred; otherwise null."),
    }),
  ),
});
export type Candidates = z.infer<typeof CandidateSchema>;

export interface Usage { inputTokens: number; outputTokens: number }
export interface Msg { role: "user" | "assistant"; content: string }

export class ModelRefused extends Error {}

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic({ apiKey: requireKey("ANTHROPIC_API_KEY"), timeout: 20_000, maxRetries: 1 }));

async function structured<T>(schema: z.ZodType<T>, system: string, messages: Msg[], maxTokens: number): Promise<{ value: T; usage: Usage }> {
  try {
    // No server-side `fallbacks`: in a child product, a refusal should end in our own safe fallback line,
    // not a silent re-run on a different model.
    const res = await anthropic().messages.parse({
      model: models.claude(),
      max_tokens: maxTokens,
      output_config: { effort: "low", format: zodOutputFormat(schema) },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages,
    });
    if (res.stop_reason === "refusal") throw new ModelRefused(String(res.stop_details?.category ?? "refusal"));
    if (!res.parsed_output) throw new Error(`unparseable model output (stop_reason=${res.stop_reason})`);
    return { value: res.parsed_output, usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens } };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError)
      throw new ProviderUnavailable("anthropic", "Anthropic credentials rejected");
    if (err instanceof Anthropic.RateLimitError) throw new ProviderUnavailable("anthropic", "Anthropic rate limit");
    if (err instanceof Anthropic.APIConnectionError || (err instanceof Anthropic.APIError && (err.status ?? 0) >= 500))
      throw new ProviderUnavailable("anthropic", "Anthropic unavailable");
    throw err;
  }
}

export async function generateReply(system: string, messages: Msg[]): Promise<{ reply: Reply; usage: Usage }> {
  if (providerMode() === "mock") return { reply: mockReply(messages), usage: { inputTokens: 0, outputTokens: 0 } };
  const { value, usage } = await structured(ReplySchema, system, messages, 2000);
  return { reply: value, usage };
}

export async function extractCandidates(system: string, transcript: string): Promise<{ candidates: Candidates; usage: Usage }> {
  if (providerMode() === "mock") return { candidates: mockCandidates(transcript), usage: { inputTokens: 0, outputTokens: 0 } };
  const { value, usage } = await structured(CandidateSchema, system, [{ role: "user", content: transcript }], 2000);
  return { candidates: value, usage };
}

// ---- Dev mock (clearly labelled; refused in production by providerMode()) ----
function mockReply(messages: Msg[]): Reply {
  const last = messages.at(-1)?.content ?? "";
  const said = last.match(/<child_said>([\s\S]*?)<\/child_said>/)?.[1]?.trim() ?? "";
  return { say: `[Mock Lumi] Ooh, you said "${said.slice(0, 60)}". That sounds fun! What colour should it be?`, mood: "curious" };
}

function mockCandidates(transcript: string): Candidates {
  const m = transcript.match(/my favou?rite (\w+) is (\w+)/i);
  return { memories: m ? [{ category: "preference", content: `Favourite ${m[1]} is ${m[2]}`, provenance: "child_said", confidence: null }] : [] };
}
