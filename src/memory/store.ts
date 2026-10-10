// Long-term memory store. Deletion is a hard DELETE plus a content-free deletion record.
// There are no caches, search indexes or replicas outside Postgres, so a deleted row cannot be retrieved.
import { z } from "zod";
import type { Queryable } from "@/lib/db";
import { HttpError } from "@/lib/http";

export const CATEGORIES = ["preference", "interest", "story", "game", "achievement", "communication", "milestone"] as const;
export const PROVENANCE = ["child_said", "parent_added", "inferred", "pretend_play"] as const;
export type Category = (typeof CATEGORIES)[number];
export type Provenance = (typeof PROVENANCE)[number];

export interface MemoryItem {
  id: string;
  category: Category;
  content: string;
  provenance: Provenance;
  confidence: number | null;
  in_scrapbook: boolean;
  created_at: string;
  updated_at: string;
  last_retrieved_at: string | null;
  expires_at: string | null;
}

const COLS = "id, category, content, provenance, confidence, in_scrapbook, created_at::text, updated_at::text, last_retrieved_at::text, expires_at::text";

/** Inferences are unconfirmed, so they fade unless a parent confirms them. */
const INFERRED_TTL_DAYS = 90;

export async function listMemories(q: Queryable, childId: string): Promise<MemoryItem[]> {
  return (await q.query<MemoryItem>(
    `SELECT ${COLS} FROM memory_items WHERE child_id = $1 AND (expires_at IS NULL OR expires_at > now()) ORDER BY updated_at DESC`, [childId])).rows;
}

export async function insertMemory(
  q: Queryable, childId: string,
  m: { category: Category; content: string; provenance: Provenance; confidence: number | null; sessionId?: string | null },
): Promise<string> {
  const ttl = m.provenance === "inferred" ? INFERRED_TTL_DAYS : null;
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO memory_items (child_id, category, content, provenance, confidence, source_session_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7::int IS NULL THEN NULL ELSE now() + $7::int * interval '1 day' END) RETURNING id`,
    [childId, m.category, m.content, m.provenance, m.provenance === "inferred" ? m.confidence ?? 0.5 : null, m.sessionId ?? null, ttl],
  );
  return rows[0].id;
}

export const ParentMemorySchema = z.object({
  category: z.enum(CATEGORIES),
  content: z.string().trim().min(1).max(200),
  in_scrapbook: z.boolean().optional(),
});

/** A parent edit confirms the memory: it becomes parent-provided, loses inference confidence and expiry. */
export async function updateMemory(q: Queryable, childId: string, id: string, input: unknown) {
  const m = ParentMemorySchema.parse(input);
  const { rows } = await q.query(
    `UPDATE memory_items SET category = $3, content = $4, in_scrapbook = COALESCE($5, in_scrapbook), updated_at = now(),
       provenance = CASE WHEN provenance = 'pretend_play' THEN provenance ELSE 'parent_added' END, confidence = NULL, expires_at = NULL
     WHERE id = $1 AND child_id = $2 RETURNING id`,
    [id, childId, m.category, m.content, m.in_scrapbook ?? null]);
  if (!rows[0]) throw new HttpError(404, "not_found");
}

export async function setScrapbook(q: Queryable, childId: string, id: string, on: boolean) {
  const { rows } = await q.query("UPDATE memory_items SET in_scrapbook = $3 WHERE id = $1 AND child_id = $2 RETURNING id", [id, childId, on]);
  if (!rows[0]) throw new HttpError(404, "not_found");
}

export async function deleteMemory(q: Queryable, childId: string, id: string) {
  const { rows } = await q.query("DELETE FROM memory_items WHERE id = $1 AND child_id = $2 RETURNING id", [id, childId]);
  if (!rows[0]) throw new HttpError(404, "not_found");
  await q.query("INSERT INTO memory_deletion_records (child_id, memory_id, scope, count) VALUES ($1, $2, 'one', 1)", [childId, id]);
}

export async function deleteAllMemories(q: Queryable, childId: string): Promise<number> {
  const { rows } = await q.query("DELETE FROM memory_items WHERE child_id = $1 RETURNING id", [childId]);
  await q.query("INSERT INTO memory_deletion_records (child_id, memory_id, scope, count) VALUES ($1, NULL, 'all', $2)", [childId, rows.length]);
  return rows.length;
}

export async function purgeExpiredMemories(q: Queryable, childId: string) {
  const { rows } = await q.query("DELETE FROM memory_items WHERE child_id = $1 AND expires_at <= now() RETURNING id", [childId]);
  if (rows.length) await q.query("INSERT INTO memory_deletion_records (child_id, memory_id, scope, count) VALUES ($1, NULL, 'expired', $2)", [childId, rows.length]);
}
