// POST /api/parent/setup — one-time creation of the parent account and child profile. Needs SETUP_TOKEN.
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { cookieOptions, createParent, loginParent, PARENT_COOKIE } from "@/lib/auth";
import { createChild } from "@/lib/children";
import { safeEqual } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { assertSameOrigin, HttpError, route } from "@/lib/http";

const Body = z.object({
  setupToken: z.string().min(1),
  email: z.string().email().max(200),
  password: z.string().min(10).max(200),
  childName: z.string().trim().min(1).max(40),
  age: z.number().int().min(3).max(18),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  timezone: z.string().max(60).default("UTC"),
});

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const b = Body.parse(await req.json());
  const expected = process.env.SETUP_TOKEN;
  if (!expected || !safeEqual(b.setupToken, expected)) throw new HttpError(403, "bad_setup_token", "Setup token is incorrect or SETUP_TOKEN is not configured.");
  const db = await getDb();
  await db.tx(async (q) => {
    await q.query("SELECT pg_advisory_xact_lock(777)");
    const { rows } = await q.query("SELECT 1 FROM parent_accounts LIMIT 1");
    if (rows[0]) throw new HttpError(409, "already_set_up", "A parent account already exists. Please log in.");
    const parentId = await createParent(q, b.email, b.password);
    await createChild(q, parentId, { display_name: b.childName, age: b.age, birthday: b.birthday }, b.timezone);
  });
  (await cookies()).set(PARENT_COOKIE, await loginParent(db, b.email, b.password), cookieOptions(14));
  return NextResponse.json({ ok: true });
});
