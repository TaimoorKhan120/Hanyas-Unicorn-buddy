// POST /api/speak {say, sig} — voices ONLY text the server validated and signed in /api/turn.
import { z } from "zod";
import { requireDeviceChild } from "@/lib/auth";
import { getSettings } from "@/lib/children";
import { verifySpeech } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { assertSameOrigin, HttpError, route } from "@/lib/http";
import { recordUsage } from "@/lib/limits";
import { PRICES } from "@/providers/config";
import { synthesize } from "@/providers/speech";

const Body = z.object({ say: z.string().min(1).max(1200), sig: z.string().min(10).max(100) });

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const childId = await requireDeviceChild();
  const { say, sig } = Body.parse(await req.json());
  if (!verifySpeech(say, childId, sig)) throw new HttpError(403, "unsigned_text");

  const db = await getDb();
  const settings = await getSettings(db, childId);
  const audio = await synthesize(say, settings.voice);
  if (!audio) return new Response(null, { status: 204 }); // dev mock: client uses the browser voice

  const minutes = say.split(/\s+/).length / PRICES.ttsWordsPerMinute;
  await recordUsage(db, childId, "openai", "tts", say.length, "characters", minutes * PRICES.ttsPerMinute);
  return new Response(audio, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
});
