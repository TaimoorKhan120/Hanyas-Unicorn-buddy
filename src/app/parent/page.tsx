import { cookies } from "next/headers";
import { PARENT_COOKIE, parentFromToken } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { ParentAuth } from "@/components/ParentAuth";
import { ParentApp } from "@/components/ParentApp";

export const dynamic = "force-dynamic";

export default async function ParentPage() {
  const db = await getDb();
  const parentId = await parentFromToken(db, (await cookies()).get(PARENT_COOKIE)?.value);
  if (!parentId) {
    const { rows } = await db.query("SELECT 1 FROM parent_accounts LIMIT 1");
    return <ParentAuth mode={rows[0] ? "login" : "setup"} />;
  }
  const { rows } = await db.query<{ id: string; display_name: string }>(
    "SELECT id, display_name FROM child_profiles WHERE parent_id = $1 ORDER BY created_at", [parentId]);
  return <ParentApp childrenList={rows} />;
}
