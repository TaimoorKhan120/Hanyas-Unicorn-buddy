// Child profiles, parent settings and developmental-stage lifecycle.
import { z } from "zod";
import type { Queryable } from "./db";
import { HttpError } from "./http";
import { DEFAULT_STAGE_ID, getStage, STAGES, type Stage } from "@/character/stages";

export const ACTIVITIES = {
  pretend: "Pretend play",
  stories: "Storytelling",
  animals: "Animals & nature",
  colours: "Colours & shapes",
  riddles: "Riddles & guessing games",
  jokes: "Gentle jokes",
  feelings: "Feelings words",
  drawing: "Drawing ideas",
  science: "Simple science",
} as const;
export type ActivityId = keyof typeof ACTIVITIES;

const allOn = Object.fromEntries(Object.keys(ACTIVITIES).map((k) => [k, true])) as Record<ActivityId, boolean>;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const SettingsSchema = z.object({
  memory_enabled: z.boolean(),
  retain_transcripts: z.boolean(),
  transcript_retention_days: z.number().int().min(1).max(90),
  show_transcript: z.boolean(),
  daily_limit_minutes: z.number().int().min(1).max(240),
  max_session_minutes: z.number().int().min(1).max(120),
  quiet_start: hhmm.nullable(),
  quiet_end: hhmm.nullable(),
  timezone: z.string().refine(validTimeZone, "invalid timezone"),
  activities: z.record(z.enum(Object.keys(ACTIVITIES) as [ActivityId, ...ActivityId[]]), z.boolean()),
  voice: z.object({ voice: z.enum(["shimmer", "coral", "nova", "sage", "alloy", "ballad"]).optional(), speed: z.number().min(0.8).max(1.2).optional() }),
  safety_alerts: z.enum(["category_only", "off"]),
  birthday_celebration: z.boolean(),
});
export type Settings = z.infer<typeof SettingsSchema>;

function validTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const ProfileSchema = z.object({
  display_name: z.string().trim().min(1).max(40),
  age: z.number().int().min(3).max(18),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

export async function createChild(q: Queryable, parentId: string, profile: z.infer<typeof ProfileSchema>, timezone = "UTC") {
  const p = ProfileSchema.parse(profile);
  const { rows } = await q.query<{ id: string }>(
    "INSERT INTO child_profiles (parent_id, display_name, age, birthday) VALUES ($1, $2, $3, $4) RETURNING id",
    [parentId, p.display_name, p.age, p.birthday],
  );
  const childId = rows[0].id;
  await q.query("INSERT INTO parent_settings (child_id, activities, timezone) VALUES ($1, $2, $3)",
    [childId, JSON.stringify(allOn), validTimeZone(timezone) ? timezone : "UTC"]);
  // The tested 5–6 configuration is always the starting point, regardless of age.
  const stage = getStage(DEFAULT_STAGE_ID);
  await q.query("INSERT INTO stage_history (child_id, stage_id, config_version, status, decided_at) VALUES ($1, $2, $3, 'active', now())",
    [childId, stage.id, stage.version]);
  return childId;
}

export async function getProfile(q: Queryable, childId: string) {
  const { rows } = await q.query<{ id: string; display_name: string; age: number; birthday: string | null }>(
    "SELECT id, display_name, age, to_char(birthday, 'YYYY-MM-DD') AS birthday FROM child_profiles WHERE id = $1", [childId]);
  if (!rows[0]) throw new HttpError(404, "not_found");
  return rows[0];
}

export async function updateProfile(q: Queryable, childId: string, input: unknown) {
  const p = ProfileSchema.parse(input);
  // Age is informational. Changing it never changes the active stage (see proposeStage).
  await q.query("UPDATE child_profiles SET display_name = $2, age = $3, birthday = $4 WHERE id = $1", [childId, p.display_name, p.age, p.birthday]);
}

export async function getSettings(q: Queryable, childId: string): Promise<Settings> {
  const { rows } = await q.query("SELECT * FROM parent_settings WHERE child_id = $1", [childId]);
  if (!rows[0]) throw new HttpError(404, "not_found");
  const { child_id: _, ...rest } = rows[0];
  return { ...(rest as Settings), activities: { ...allOn, ...(rest.activities as object) } };
}

export async function updateSettings(q: Queryable, childId: string, input: unknown): Promise<Settings> {
  const s = SettingsSchema.parse(input);
  await q.query(
    `UPDATE parent_settings SET memory_enabled=$2, retain_transcripts=$3, transcript_retention_days=$4, show_transcript=$5,
       daily_limit_minutes=$6, max_session_minutes=$7, quiet_start=$8, quiet_end=$9, timezone=$10, activities=$11, voice=$12,
       safety_alerts=$13, birthday_celebration=$14 WHERE child_id=$1`,
    [childId, s.memory_enabled, s.retain_transcripts, s.transcript_retention_days, s.show_transcript, s.daily_limit_minutes,
      s.max_session_minutes, s.quiet_start, s.quiet_end, s.timezone, JSON.stringify(s.activities), JSON.stringify(s.voice),
      s.safety_alerts, s.birthday_celebration],
  );
  return s;
}

// ---- Developmental stages: propose → preview → approve/reject; rollback; history ----

export interface StageRow { id: string; stage_id: string; config_version: number; status: string; created_at: string; decided_at: string | null }

export async function getActiveStage(q: Queryable, childId: string): Promise<Stage> {
  const { rows } = await q.query<{ stage_id: string; config_version: number }>(
    "SELECT stage_id, config_version FROM stage_history WHERE child_id = $1 AND status = 'active'", [childId]);
  return getStage(rows[0]?.stage_id ?? DEFAULT_STAGE_ID);
}

export async function stageHistory(q: Queryable, childId: string): Promise<StageRow[]> {
  return (await q.query<StageRow>(
    "SELECT id, stage_id, config_version, status, created_at::text, decided_at::text FROM stage_history WHERE child_id = $1 ORDER BY created_at DESC",
    [childId])).rows;
}

export async function proposeStage(q: Queryable, childId: string, stageId: string) {
  const stage = STAGES.find((s) => s.id === stageId);
  if (!stage) throw new HttpError(400, "unknown_stage");
  await q.query("UPDATE stage_history SET status = 'rejected', decided_at = now() WHERE child_id = $1 AND status = 'proposed'", [childId]);
  const { rows } = await q.query<{ id: string }>(
    "INSERT INTO stage_history (child_id, stage_id, config_version, status) VALUES ($1, $2, $3, 'proposed') RETURNING id",
    [childId, stage.id, stage.version]);
  return rows[0].id;
}

/** Approving an untested stage requires an explicit acknowledgement from the parent. */
export async function decideStage(q: Queryable, childId: string, proposalId: string, approve: boolean, acknowledgeUntested = false) {
  const { rows } = await q.query<{ stage_id: string }>(
    "SELECT stage_id FROM stage_history WHERE id = $1 AND child_id = $2 AND status = 'proposed'", [proposalId, childId]);
  if (!rows[0]) throw new HttpError(404, "not_found");
  if (!approve) {
    await q.query("UPDATE stage_history SET status = 'rejected', decided_at = now() WHERE id = $1", [proposalId]);
    return;
  }
  if (!getStage(rows[0].stage_id).tested && !acknowledgeUntested) throw new HttpError(400, "untested_stage_ack_required");
  await q.query("UPDATE stage_history SET status = 'superseded' WHERE child_id = $1 AND status = 'active'", [childId]);
  await q.query("UPDATE stage_history SET status = 'active', decided_at = now() WHERE id = $1", [proposalId]);
}

/** Roll back to the most recently superseded configuration. */
export async function revertStage(q: Queryable, childId: string) {
  const { rows } = await q.query<{ stage_id: string; config_version: number }>(
    "SELECT stage_id, config_version FROM stage_history WHERE child_id = $1 AND status = 'superseded' ORDER BY decided_at DESC NULLS LAST, created_at DESC LIMIT 1",
    [childId]);
  if (!rows[0]) throw new HttpError(400, "nothing_to_revert");
  await q.query("UPDATE stage_history SET status = 'superseded' WHERE child_id = $1 AND status = 'active'", [childId]);
  await q.query("INSERT INTO stage_history (child_id, stage_id, config_version, status, decided_at) VALUES ($1, $2, $3, 'active', now())",
    [childId, rows[0].stage_id, rows[0].config_version]);
}
