import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { PARENT_COOKIE } from "@/lib/auth";
import { sha256 } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { assertSameOrigin, route } from "@/lib/http";

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const jar = await cookies();
  const token = jar.get(PARENT_COOKIE)?.value;
  if (token) await (await getDb()).query("DELETE FROM parent_sessions WHERE token_hash = $1", [sha256(token)]);
  jar.delete(PARENT_COOKIE);
  return NextResponse.json({ ok: true });
});
