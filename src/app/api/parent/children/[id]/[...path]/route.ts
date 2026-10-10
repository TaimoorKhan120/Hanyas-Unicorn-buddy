// /api/parent/children/:id/* — every request is authenticated and ownership-checked server-side.
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { cookieOptions, DEVICE_COOKIE, pairDevice, requireParentChild } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { assertSameOrigin, route } from "@/lib/http";
import { childAction } from "@/parent/actions";

type Ctx = { params: Promise<{ id: string; path: string[] }> };

async function handle(req: Request, ctx: Ctx) {
  const { id, path } = await ctx.params;
  if (req.method !== "GET") assertSameOrigin(req);
  const { childId } = await requireParentChild(id);
  const db = await getDb();

  if (req.method === "POST" && path[0] === "pair") {
    // Pair THIS browser as the child's device (sets a long-lived httpOnly cookie).
    const label = (req.headers.get("user-agent") ?? "device").replace(/\(.*?\)/g, "").slice(0, 60);
    (await cookies()).set(DEVICE_COOKIE, await pairDevice(db, childId, label), cookieOptions(365));
    return NextResponse.json({ ok: true });
  }

  const body = req.method === "GET" ? undefined : await req.json().catch(() => ({}));
  const result = await childAction(db, childId, req.method, path, body);
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}

export const GET = route(handle);
export const POST = route(handle);
export const PUT = route(handle);
export const PATCH = route(handle);
export const DELETE = route(handle);
