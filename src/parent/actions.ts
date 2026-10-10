// Parent dashboard actions for one child. The caller MUST have verified ownership (requireParentChild).
import { z } from "zod";
import type { Db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { decideStage, getActiveStage, getProfile, getSettings, proposeStage, revertStage, stageHistory, updateProfile, updateSettings } from "@/lib/children";
import { monthEstimatedCost } from "@/lib/limits";
import { STAGES, suggestedStageForAge } from "@/character/stages";
import { CHARACTER_VERSION } from "@/character/lumi";
import { PARENT_SUPPORT_POLICY, SAFETY_POLICY_VERSION } from "@/safety/policy";
import { deleteAllMemories, deleteMemory, insertMemory, listMemories, ParentMemorySchema, setScrapbook, updateMemory } from "@/memory/store";

const Decide = z.object({ proposalId: z.string().uuid(), approve: z.boolean(), acknowledgeUntested: z.boolean().optional() });
const id = (s: string | undefined) => z.string().uuid().parse(s);

export async function childAction(db: Db, childId: string, method: string, path: string[], body: unknown): Promise<unknown> {
  const key = `${method} ${path[0] ?? ""}`;
  switch (key) {
    case "GET overview":
      return overview(db, childId);
    case "PUT profile":
      await updateProfile(db, childId, body);
      return getProfile(db, childId);
    case "GET settings":
      return getSettings(db, childId);
    case "PUT settings":
      return updateSettings(db, childId, body);

    case "GET memories":
      return listMemories(db, childId);
    case "POST memories": {
      const m = ParentMemorySchema.parse(body);
      const created = await insertMemory(db, childId, { category: m.category, content: m.content, provenance: "parent_added", confidence: null });
      if (m.in_scrapbook) await setScrapbook(db, childId, created, true);
      return { id: created };
    }
    case "PATCH memories":
      await updateMemory(db, childId, id(path[1]), body);
      return { ok: true };
    case "DELETE memories":
      if (path[1] === "all") return { deleted: await db.tx((q) => deleteAllMemories(q, childId)) };
      await db.tx((q) => deleteMemory(q, childId, id(path[1])));
      return { ok: true };

    case "GET stage": {
      const [profile, active, history] = await Promise.all([getProfile(db, childId), getActiveStage(db, childId), stageHistory(db, childId)]);
      return { active, history, stages: STAGES, suggested: suggestedStageForAge(profile.age) };
    }
    case "POST stage": {
      const action = path[1];
      if (action === "propose") return { proposalId: await db.tx((q) => proposeStage(q, childId, z.object({ stageId: z.string() }).parse(body).stageId)) };
      if (action === "decide") {
        const d = Decide.parse(body);
        await db.tx((q) => decideStage(q, childId, d.proposalId, d.approve, d.acknowledgeUntested));
        return { ok: true };
      }
      if (action === "revert") {
        await db.tx((q) => revertStage(q, childId));
        return { ok: true };
      }
      break;
    }

    case "GET devices":
      return (await db.query("SELECT sha256_prefix, label, created_at::text, last_seen_at::text FROM (SELECT left(token_hash, 12) AS sha256_prefix, label, created_at, last_seen_at FROM child_devices WHERE child_id = $1) d ORDER BY created_at DESC", [childId])).rows;
    case "DELETE devices": {
      const prefix = z.string().regex(/^[0-9a-f]{12}$/).parse(path[1]);
      await db.query("DELETE FROM child_devices WHERE child_id = $1 AND left(token_hash, 12) = $2", [childId, prefix]);
      return { ok: true };
    }

    case "GET export":
      return exportData(db, childId);
    case "DELETE transcripts":
      return { deleted: (await db.query("DELETE FROM conversation_turns WHERE child_id = $1 RETURNING id", [childId])).rows.length };
    case "DELETE profile":
      // Cascades to settings, devices, sessions, turns, memories, safety events and usage records.
      z.object({ confirm: z.literal("DELETE") }).parse(body);
      await db.query("DELETE FROM child_profiles WHERE id = $1", [childId]);
      return { ok: true };
  }
  throw new HttpError(404, "not_found");
}

async function overview(db: Db, childId: string) {
  const [profile, settings, stage, safety, usage, latency, today] = await Promise.all([
    getProfile(db, childId),
    getSettings(db, childId),
    getActiveStage(db, childId),
    db.query("SELECT category, action, created_at::text FROM safety_events WHERE child_id = $1 ORDER BY created_at DESC LIMIT 50", [childId]),
    db.query(
      `SELECT provider, kind, unit, sum(quantity)::float AS quantity, sum(est_cost_usd)::float AS est_cost_usd
       FROM usage_records WHERE child_id = $1 AND created_at >= date_trunc('month', now()) AND provider <> 'client'
       GROUP BY provider, kind, unit ORDER BY provider, kind`, [childId]),
    db.query<{ p50: number | null; p90: number | null; n: number }>(
      `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY quantity)::float AS p50, percentile_cont(0.9) WITHIN GROUP (ORDER BY quantity)::float AS p90, count(*)::int AS n
       FROM usage_records WHERE child_id = $1 AND kind = 'first_audio_ms' AND created_at > now() - interval '30 days'`, [childId]),
    db.query<{ sessions: number; turns: number }>(
      `SELECT (SELECT count(*)::int FROM conversation_sessions WHERE child_id = $1 AND started_at > now() - interval '1 day') AS sessions,
              (SELECT count(*)::int FROM conversation_turns WHERE child_id = $1 AND role = 'child' AND created_at > now() - interval '1 day') AS turns`, [childId]),
  ]);
  return {
    profile, settings, stage,
    versions: { character: CHARACTER_VERSION, safetyPolicy: SAFETY_POLICY_VERSION },
    parentSupportPolicy: PARENT_SUPPORT_POLICY,
    safetyEvents: safety.rows,
    usageThisMonth: usage.rows,
    estimatedCostThisMonthAllChildren: await monthEstimatedCost(db),
    budgetUsd: Number(process.env.MONTHLY_BUDGET_USD) || null,
    latency: latency.rows[0],
    last24h: today.rows[0],
  };
}

async function exportData(db: Db, childId: string) {
  const q = (sql: string) => db.query(sql, [childId]).then((r) => r.rows);
  return {
    exportedAt: new Date().toISOString(),
    profile: await getProfile(db, childId),
    settings: await getSettings(db, childId),
    stageHistory: await stageHistory(db, childId),
    memories: await listMemories(db, childId),
    memoryDeletions: await q("SELECT memory_id, scope, count, deleted_at::text FROM memory_deletion_records WHERE child_id = $1 ORDER BY deleted_at"),
    sessions: await q("SELECT id, started_at::text, last_turn_at::text, stage_id, character_version FROM conversation_sessions WHERE child_id = $1 ORDER BY started_at"),
    retainedTurns: await q("SELECT session_id, role, text, created_at::text FROM conversation_turns WHERE child_id = $1 ORDER BY created_at"),
    safetyEvents: await q("SELECT category, action, created_at::text FROM safety_events WHERE child_id = $1 ORDER BY created_at"),
    note: "Raw audio is never stored. Provider-side data (OpenAI, Anthropic) is governed by their API retention terms.",
  };
}
