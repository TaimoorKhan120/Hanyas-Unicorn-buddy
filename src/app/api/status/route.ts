// GET /api/status — what the child screen needs to start: paired?, name, resting?, mock mode.
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { childFromDeviceToken, DEVICE_COOKIE } from "@/lib/auth";
import { getProfile, getSettings } from "@/lib/children";
import { getDb } from "@/lib/db";
import { route } from "@/lib/http";
import { checkLimits } from "@/lib/limits";
import { providerMode } from "@/providers/config";

export const GET = route(async () => {
  const db = await getDb();
  const childId = await childFromDeviceToken(db, (await cookies()).get(DEVICE_COOKIE)?.value);
  const mock = providerMode() === "mock";
  if (!childId) return NextResponse.json({ paired: false, mock });
  const [profile, settings] = await Promise.all([getProfile(db, childId), getSettings(db, childId)]);
  return NextResponse.json({
    paired: true,
    mock,
    name: profile.display_name,
    resting: await checkLimits(db, childId, settings),
    showTranscript: settings.show_transcript,
  });
});
