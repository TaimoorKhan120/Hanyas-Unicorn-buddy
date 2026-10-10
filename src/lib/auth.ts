// Parent authentication and child-device pairing. All checks are server-side.
import { cookies } from "next/headers";
import type { Queryable } from "./db";
import { getDb } from "./db";
import { hashPassword, newToken, sha256, verifyPassword } from "./crypto";
import { HttpError } from "./http";

export const PARENT_COOKIE = "lumi_parent";
export const DEVICE_COOKIE = "lumi_device";
const PARENT_SESSION_DAYS = 14;

export const cookieOptions = (maxAgeDays: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: maxAgeDays * 86400,
});

export async function createParent(q: Queryable, email: string, password: string): Promise<string> {
  if (password.length < 10) throw new HttpError(400, "weak_password", "Use at least 10 characters.");
  const { rows } = await q.query<{ id: string }>(
    "INSERT INTO parent_accounts (email, password_hash) VALUES (lower($1), $2) RETURNING id",
    [email, await hashPassword(password)],
  );
  return rows[0].id;
}

export async function loginParent(q: Queryable, email: string, password: string): Promise<string> {
  const { rows } = await q.query<{ id: string; password_hash: string }>(
    "SELECT id, password_hash FROM parent_accounts WHERE email = lower($1)", [email]);
  // Hash even when the account is missing, to keep timing uniform.
  const ok = await verifyPassword(password, rows[0]?.password_hash ?? "scrypt$00$00");
  if (!rows[0] || !ok) throw new HttpError(401, "bad_credentials", "Email or password is incorrect.");
  const token = newToken();
  await q.query("INSERT INTO parent_sessions (token_hash, parent_id, expires_at) VALUES ($1, $2, now() + $3 * interval '1 day')",
    [sha256(token), rows[0].id, PARENT_SESSION_DAYS]);
  return token;
}

export async function parentFromToken(q: Queryable, token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const { rows } = await q.query<{ parent_id: string }>(
    "SELECT parent_id FROM parent_sessions WHERE token_hash = $1 AND expires_at > now()", [sha256(token)]);
  return rows[0]?.parent_id ?? null;
}

export async function childFromDeviceToken(q: Queryable, token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const { rows } = await q.query<{ child_id: string }>(
    "UPDATE child_devices SET last_seen_at = now() WHERE token_hash = $1 RETURNING child_id", [sha256(token)]);
  return rows[0]?.child_id ?? null;
}

export async function pairDevice(q: Queryable, childId: string, label: string): Promise<string> {
  const token = newToken();
  await q.query("INSERT INTO child_devices (token_hash, child_id, label) VALUES ($1, $2, $3)", [sha256(token), childId, label.slice(0, 60)]);
  return token;
}

/** Throws 404 (not 403) so a parent can't probe for other families' child ids. */
export async function assertOwnsChild(q: Queryable, parentId: string, childId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(childId)) throw new HttpError(404, "not_found");
  const { rows } = await q.query("SELECT 1 FROM child_profiles WHERE id = $1 AND parent_id = $2", [childId, parentId]);
  if (!rows[0]) throw new HttpError(404, "not_found");
}

// ---- Request helpers (read httpOnly cookies) ----

export async function requireParent(): Promise<string> {
  const token = (await cookies()).get(PARENT_COOKIE)?.value;
  const parentId = await parentFromToken(await getDb(), token);
  if (!parentId) throw new HttpError(401, "parent_login_required");
  return parentId;
}

export async function requireParentChild(childId: string): Promise<{ parentId: string; childId: string }> {
  const parentId = await requireParent();
  await assertOwnsChild(await getDb(), parentId, childId);
  return { parentId, childId };
}

export async function requireDeviceChild(): Promise<string> {
  const token = (await cookies()).get(DEVICE_COOKIE)?.value;
  const childId = await childFromDeviceToken(await getDb(), token);
  if (!childId) throw new HttpError(401, "device_not_paired");
  return childId;
}
