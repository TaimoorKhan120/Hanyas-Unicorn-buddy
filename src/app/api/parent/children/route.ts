import { NextResponse } from "next/server";
import { requireParent } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { route } from "@/lib/http";

export const GET = route(async () => {
  const parentId = await requireParent();
  const { rows } = await (await getDb()).query(
    "SELECT id, display_name, age FROM child_profiles WHERE parent_id = $1 ORDER BY created_at", [parentId]);
  return NextResponse.json(rows, { headers: { "Cache-Control": "no-store" } });
});
