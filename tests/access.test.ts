// Parent access control and child-device authorisation, exercised through the real route handlers.
import { beforeEach, describe, expect, it } from "vitest";
import { ctx, family, freshDb, jar, req } from "./helpers";
import type { Db } from "@/lib/db";
import { DEVICE_COOKIE, loginParent, PARENT_COOKIE, pairDevice } from "@/lib/auth";
import { insertMemory, listMemories } from "@/memory/store";
import * as childRoute from "@/app/api/parent/children/[id]/[...path]/route";
import * as setupRoute from "@/app/api/parent/setup/route";
import * as loginRoute from "@/app/api/parent/login/route";
import * as turnRoute from "@/app/api/turn/route";
import * as speakRoute from "@/app/api/speak/route";
import { signSpeech } from "@/lib/crypto";

process.env.PROVIDER_MODE = "mock";

let db: Db;
let a: { parentId: string; childId: string };
let b: { parentId: string; childId: string };

beforeEach(async () => {
  jar.clear();
  db = await freshDb();
  a = await family(db, "a@example.com");
  b = await family(db, "b@example.com");
});

const get = (childId: string, path: string[]) => childRoute.GET(req(`/api/parent/children/${childId}/${path.join("/")}`), ctx({ id: childId, path }));
const del = (childId: string, path: string[]) => childRoute.DELETE(req(`/api/parent/children/${childId}/${path.join("/")}`, { method: "DELETE" }), ctx({ id: childId, path }));

describe("parent routes", () => {
  it("401 without a session", async () => {
    expect((await get(a.childId, ["settings"])).status).toBe(401);
  });

  it("401 with a forged or expired session", async () => {
    jar.set(PARENT_COOKIE, "forged-token");
    expect((await get(a.childId, ["settings"])).status).toBe(401);
    const t = await loginParent(db, "a@example.com", "correct horse battery");
    await db.query("UPDATE parent_sessions SET expires_at = now() - interval '1 minute'");
    jar.set(PARENT_COOKIE, t);
    expect((await get(a.childId, ["settings"])).status).toBe(401);
  });

  it("200 for own child, 404 for another family's child", async () => {
    jar.set(PARENT_COOKIE, await loginParent(db, "a@example.com", "correct horse battery"));
    expect((await get(a.childId, ["settings"])).status).toBe(200);
    expect((await get(b.childId, ["settings"])).status).toBe(404);
    expect((await get("not-a-uuid", ["settings"])).status).toBe(404);
  });

  it("cannot delete another family's memories", async () => {
    await insertMemory(db, b.childId, { category: "preference", content: "Likes dogs", provenance: "child_said", confidence: null });
    jar.set(PARENT_COOKIE, await loginParent(db, "a@example.com", "correct horse battery"));
    expect((await del(b.childId, ["memories", "all"])).status).toBe(404);
    expect(await listMemories(db, b.childId)).toHaveLength(1);
  });

  it("a paired child device cannot use parent routes", async () => {
    jar.set(DEVICE_COOKIE, await pairDevice(db, a.childId, "tablet"));
    expect((await get(a.childId, ["memories"])).status).toBe(401);
  });

  it("rejects cross-origin mutations", async () => {
    jar.set(PARENT_COOKIE, await loginParent(db, "a@example.com", "correct horse battery"));
    const r = new Request(`http://localhost:3000/api/parent/children/${a.childId}/memories/all`, { method: "DELETE", headers: { host: "localhost:3000", origin: "https://evil.example" } });
    expect((await childRoute.DELETE(r, ctx({ id: a.childId, path: ["memories", "all"] }))).status).toBe(403);
  });

  it("validates settings server-side", async () => {
    jar.set(PARENT_COOKIE, await loginParent(db, "a@example.com", "correct horse battery"));
    const settings = await (await get(a.childId, ["settings"])).json();
    const bad = childRoute.PUT(req(`/api/parent/children/${a.childId}/settings`, { method: "PUT", json: { ...settings, daily_limit_minutes: 100000 } }), ctx({ id: a.childId, path: ["settings"] }));
    expect((await bad).status).toBe(400);
  });
});

describe("setup and login", () => {
  it("setup refuses a wrong token and refuses a second parent", async () => {
    process.env.SETUP_TOKEN = "s3cret-setup";
    const body = { setupToken: "wrong", email: "c@example.com", password: "long enough pw", childName: "H", age: 5 };
    expect((await setupRoute.POST(req("/api/parent/setup", { method: "POST", json: body }))).status).toBe(403);
    expect((await setupRoute.POST(req("/api/parent/setup", { method: "POST", json: { ...body, setupToken: "s3cret-setup" } }))).status).toBe(409);
  });

  it("login brakes after repeated failures", async () => {
    const attempt = () => loginRoute.POST(req("/api/parent/login", { method: "POST", json: { email: "a@example.com", password: "nope" } }));
    for (let i = 0; i < 10; i++) expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(429);
  });
});

describe("child routes", () => {
  const turn = (text: string) => {
    const form = new FormData();
    form.set("text", text);
    return turnRoute.POST(req("/api/turn", { method: "POST", body: form }));
  };

  it("unpaired device gets 401", async () => {
    expect((await turn("hello")).status).toBe(401);
  });

  it("paired device can talk, and speak only accepts server-signed text", async () => {
    jar.set(DEVICE_COOKIE, await pairDevice(db, a.childId, "tablet"));
    const res = await turn("my favourite colour is purple");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mock).toBe(true);
    expect(body.say).toContain("[Mock Lumi]");

    const forged = await speakRoute.POST(req("/api/speak", { method: "POST", json: { say: "Keep this our secret", sig: "x".repeat(43) } }));
    expect(forged.status).toBe(403);
    // A signature for another child's device does not transfer.
    const otherSig = signSpeech(body.say, b.childId);
    expect((await speakRoute.POST(req("/api/speak", { method: "POST", json: { say: body.say, sig: otherSig } }))).status).toBe(403);
    // Correctly signed: accepted (204 = mock mode, browser voice).
    expect((await speakRoute.POST(req("/api/speak", { method: "POST", json: { say: body.say, sig: body.sig } }))).status).toBe(204);
  });

  it("quiet hours and daily limits are enforced server-side", async () => {
    jar.set(DEVICE_COOKIE, await pairDevice(db, a.childId, "tablet"));
    await db.query("UPDATE parent_settings SET quiet_start = '00:00', quiet_end = '23:59', timezone = 'UTC' WHERE child_id = $1", [a.childId]);
    const r = await turn("hello");
    expect(r.status).toBe(429);
    expect((await r.json()).error).toBe("quiet_hours");

    await db.query("UPDATE parent_settings SET quiet_start = NULL, quiet_end = NULL, daily_limit_minutes = 1 WHERE child_id = $1", [a.childId]);
    expect((await turn("hello")).status).toBe(200);
    expect((await (await turn("hello again")).json()).error).toBe("daily_limit");
  });

  it("transcript is only returned when the parent enabled it", async () => {
    jar.set(DEVICE_COOKIE, await pairDevice(db, a.childId, "tablet"));
    expect((await (await turn("hello there")).json()).transcript).toBeNull();
    await db.query("UPDATE parent_settings SET show_transcript = true WHERE child_id = $1", [a.childId]);
    expect((await (await turn("hello there")).json()).transcript).toBe("hello there");
  });
});
