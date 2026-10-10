// POST /api/metric — client-measured voice metrics (no content). kind: first_audio_ms | stt_fail | playback_fail | cancel
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireDeviceChild } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { assertSameOrigin, route } from "@/lib/http";
import { recordUsage } from "@/lib/limits";

const Body = z.object({
  kind: z.enum(["first_audio_ms", "turn_error", "playback_fail", "cancel", "interrupt"]),
  value: z.number().min(0).max(120_000).default(1),
});

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const childId = await requireDeviceChild();
  const { kind, value } = Body.parse(await req.json());
  await recordUsage(await getDb(), childId, "client", kind, value, kind === "first_audio_ms" ? "ms" : "count");
  return NextResponse.json({ ok: true });
});
