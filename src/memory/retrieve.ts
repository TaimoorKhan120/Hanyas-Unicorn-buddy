// Structured keyword retrieval. Deliberately simple and testable.
// ponytail: keyword overlap, not embeddings. Add semantic search only if evals show missed recalls.
import type { Queryable } from "@/lib/db";
import type { MemoryItem } from "./store";

const STOP = new Set(
  "a an the and or but if to of in on at for with is are was were be been am i me my you your we our it its this that these those do did does can could would will shall should have has had what who where when why how lets let's please yes no ok okay so very really just like about again tell".split(" "),
);
const RECALL = /\b(remember|last time|again|continue|before|our (story|game|adventure)|what happened)\b/i;

export function keywords(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^a-z\s']/g, " ").split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map((w) => w.replace(/'s$/, "").replace(/(ies)$/, "y").replace(/(?<!s)s$/, "")),
  );
}

export function scoreMemories(query: string, items: MemoryItem[], limit = 5): MemoryItem[] {
  const q = keywords(query);
  const recall = RECALL.test(query);
  const now = Date.now();
  return items
    .map((m) => {
      const overlap = [...keywords(m.content)].filter((w) => q.has(w)).length;
      let score = overlap * 3;
      if (recall && (m.category === "story" || m.category === "game")) score += 2;
      if (m.category === "communication") score += 1.5; // how she likes to be talked to is always relevant
      if (m.provenance === "inferred") score -= 0.5;
      const ageDays = (now - Date.parse(m.updated_at)) / 86_400_000;
      if (score > 0) score += Math.max(0, 1 - ageDays / 60); // recency only breaks ties among relevant items
      return { m, score };
    })
    .filter((x) => x.score >= 1.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.m);
}

export async function retrieveMemories(q: Queryable, childId: string, query: string, limit = 5): Promise<MemoryItem[]> {
  const { rows } = await q.query<MemoryItem>(
    `SELECT id, category, content, provenance, confidence, in_scrapbook, created_at::text, updated_at::text, last_retrieved_at::text, expires_at::text
     FROM memory_items WHERE child_id = $1 AND (expires_at IS NULL OR expires_at > now())
     ORDER BY updated_at DESC LIMIT 300`, [childId]);
  const picked = scoreMemories(query, rows, limit);
  if (picked.length) await q.query("UPDATE memory_items SET last_retrieved_at = now() WHERE child_id = $1 AND id = ANY($2::uuid[])", [childId, picked.map((m) => m.id)]);
  return picked;
}
