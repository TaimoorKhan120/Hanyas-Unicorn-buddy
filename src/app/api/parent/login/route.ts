import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { cookieOptions, loginParent, PARENT_COOKIE } from "@/lib/auth";
import { sha256 } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { assertSameOrigin, HttpError, route } from "@/lib/http";

const Body = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const { email, password } = Body.parse(await req.json());
  const db = await getDb();
  const failKey = `login_fail:${sha256(email.toLowerCase()).slice(0, 16)}`;
  // Brute-force brake: at most 10 failed-looking attempts per email per 15 minutes (tracked as usage rows, no content).
  const { rows } = await db.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM usage_records WHERE provider = 'auth' AND kind = $1 AND created_at > now() - interval '15 minutes'",
    [failKey]);
  if (rows[0].n >= 10) throw new HttpError(429, "too_many_attempts", "Too many attempts. Try again in 15 minutes.");
  try {
    (await cookies()).set(PARENT_COOKIE, await loginParent(db, email, password), cookieOptions(14));
  } catch (err) {
    await db.query("INSERT INTO usage_records (provider, kind, quantity, unit) VALUES ('auth', $1, 1, 'count')", [failKey]);
    throw err;
  }
  return NextResponse.json({ ok: true });
});
