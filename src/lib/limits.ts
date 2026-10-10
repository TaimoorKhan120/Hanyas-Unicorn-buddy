// Server-enforced usage limits, quiet hours, budget, and usage/cost records (costs are ESTIMATES).
import type { Queryable } from "./db";
import type { Settings } from "./children";

export type LimitReason = "quiet_hours" | "daily_limit" | "session_limit" | "rate_limit" | "budget";

export const SESSION_GAP_MINUTES = 10;
const MAX_TURNS_PER_MINUTE = 8;

export function localHHMM(now: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
}

export function inQuietHours(now: Date, s: Pick<Settings, "quiet_start" | "quiet_end" | "timezone">): boolean {
  if (!s.quiet_start || !s.quiet_end || s.quiet_start === s.quiet_end) return false;
  const t = localHHMM(now, s.timezone);
  return s.quiet_start < s.quiet_end ? t >= s.quiet_start && t < s.quiet_end : t >= s.quiet_start || t < s.quiet_end;
}

export async function checkLimits(q: Queryable, childId: string, s: Settings, now = new Date()): Promise<LimitReason | null> {
  if (inQuietHours(now, s)) return "quiet_hours";

  const { rows: rate } = await q.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM conversation_turns WHERE child_id = $1 AND role = 'child' AND created_at > $2::timestamptz - interval '1 minute'",
    [childId, now.toISOString()]);
  if (rate[0].n >= MAX_TURNS_PER_MINUTE) return "rate_limit";

  // Minutes today in the child's timezone = sum of session spans (+1 min each for the opening turn).
  const { rows: day } = await q.query<{ minutes: number }>(
    `SELECT COALESCE(sum(extract(epoch FROM (last_turn_at - started_at)) / 60 + 1), 0)::float AS minutes
     FROM conversation_sessions
     WHERE child_id = $1 AND (started_at AT TIME ZONE $2)::date = ($3::timestamptz AT TIME ZONE $2)::date`,
    [childId, s.timezone, now.toISOString()]);
  if (day[0].minutes >= s.daily_limit_minutes) return "daily_limit";

  const { rows: cur } = await q.query<{ minutes: number }>(
    `SELECT extract(epoch FROM ($2::timestamptz - started_at)) / 60 AS minutes FROM conversation_sessions
     WHERE child_id = $1 AND last_turn_at > $2::timestamptz - $3 * interval '1 minute' ORDER BY last_turn_at DESC LIMIT 1`,
    [childId, now.toISOString(), SESSION_GAP_MINUTES]);
  if (cur[0] && Number(cur[0].minutes) >= s.max_session_minutes) return "session_limit";

  const budget = Number(process.env.MONTHLY_BUDGET_USD);
  if (budget > 0 && (await monthEstimatedCost(q, now)) >= budget) return "budget";
  return null;
}

export async function monthEstimatedCost(q: Queryable, now = new Date()): Promise<number> {
  const { rows } = await q.query<{ usd: number }>(
    "SELECT COALESCE(sum(est_cost_usd), 0)::float AS usd FROM usage_records WHERE created_at >= date_trunc('month', $1::timestamptz)",
    [now.toISOString()]);
  return rows[0].usd;
}

export async function recordUsage(q: Queryable, childId: string | null, provider: string, kind: string, quantity: number, unit: string, estCostUsd = 0) {
  await q.query("INSERT INTO usage_records (child_id, provider, kind, quantity, unit, est_cost_usd) VALUES ($1, $2, $3, $4, $5, $6)",
    [childId, provider, kind, quantity, unit, estCostUsd]);
}

export async function recordSafetyEvent(q: Queryable, childId: string, category: string, action: string) {
  await q.query("INSERT INTO safety_events (child_id, category, action) VALUES ($1, $2, $3)", [childId, category, action]);
}

/** Retention: transcripts kept N days if retention is on; otherwise only ~2h for the recent-context window. */
export async function purgeTranscripts(q: Queryable, childId: string, s: Settings) {
  if (s.retain_transcripts) {
    await q.query("DELETE FROM conversation_turns WHERE child_id = $1 AND created_at < now() - $2 * interval '1 day'", [childId, s.transcript_retention_days]);
  } else {
    await q.query(
      `DELETE FROM conversation_turns t USING conversation_sessions s
       WHERE t.session_id = s.id AND t.child_id = $1 AND s.last_turn_at < now() - interval '2 hours'`, [childId]);
  }
}
