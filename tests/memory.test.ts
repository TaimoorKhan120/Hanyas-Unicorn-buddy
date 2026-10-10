// Memory lifecycle on a real Postgres engine (PGlite, in-memory). Providers in dev mock mode.
import { beforeEach, describe, expect, it } from "vitest";
import { family, freshDb } from "./helpers";
import type { Db } from "@/lib/db";
import { deleteAllMemories, deleteMemory, insertMemory, listMemories, purgeExpiredMemories, updateMemory } from "@/memory/store";
import { retrieveMemories, scoreMemories } from "@/memory/retrieve";
import { extractAndSave, validateCandidate } from "@/memory/extract";
import { getSettings, updateSettings } from "@/lib/children";
import { runTurn } from "@/conversation/orchestrator";

process.env.PROVIDER_MODE = "mock";

let db: Db;
let childId: string;
beforeEach(async () => {
  db = await freshDb();
  ({ childId } = await family(db));
});

describe("memory persistence and provenance", () => {
  it("persists across sessions and keeps provenance", async () => {
    await insertMemory(db, childId, { category: "story", content: "Pretend butterfly Flutter lives in a teacup castle", provenance: "pretend_play", confidence: null });
    await insertMemory(db, childId, { category: "preference", content: "Favourite colour is purple", provenance: "child_said", confidence: null });
    // A "new session" is just a new request: re-read from the database.
    const items = await listMemories(db, childId);
    expect(items.map((m) => m.provenance).sort()).toEqual(["child_said", "pretend_play"]);
  });

  it("inferences require confidence and expire; facts do not", async () => {
    await insertMemory(db, childId, { category: "interest", content: "Seems to love dinosaurs", provenance: "inferred", confidence: 0.8 });
    await insertMemory(db, childId, { category: "interest", content: "Loves drawing", provenance: "child_said", confidence: 0.9 });
    const items = await listMemories(db, childId);
    const inferred = items.find((m) => m.provenance === "inferred")!;
    const said = items.find((m) => m.provenance === "child_said")!;
    expect(inferred.confidence).toBeCloseTo(0.8);
    expect(inferred.expires_at).not.toBeNull();
    expect(said.confidence).toBeNull();
    expect(said.expires_at).toBeNull();
    await expect(db.query("INSERT INTO memory_items (child_id, category, content, provenance) VALUES ($1, 'interest', 'x', 'inferred')", [childId])).rejects.toThrow();
  });

  it("a parent edit confirms the memory", async () => {
    const id = await insertMemory(db, childId, { category: "interest", content: "Seems to love dinosaurs", provenance: "inferred", confidence: 0.7 });
    await updateMemory(db, childId, id, { category: "interest", content: "Loves dinosaurs, especially stegosaurus" });
    const m = (await listMemories(db, childId))[0];
    expect(m).toMatchObject({ provenance: "parent_added", confidence: null, expires_at: null });
  });

  it("expired memories are purged with a deletion record", async () => {
    const id = await insertMemory(db, childId, { category: "interest", content: "Seems to love trains", provenance: "inferred", confidence: 0.7 });
    await db.query("UPDATE memory_items SET expires_at = now() - interval '1 second' WHERE id = $1", [id]);
    expect(await listMemories(db, childId)).toHaveLength(0);
    await purgeExpiredMemories(db, childId);
    expect((await db.query("SELECT count(*)::int AS n FROM memory_items")).rows[0]).toEqual({ n: 0 });
    expect((await db.query("SELECT scope, count FROM memory_deletion_records")).rows).toEqual([{ scope: "expired", count: 1 }]);
  });
});

describe("retrieval relevance", () => {
  beforeEach(async () => {
    await insertMemory(db, childId, { category: "story", content: "Pretend butterfly adventure: Flutter the butterfly found a glowing acorn", provenance: "pretend_play", confidence: null });
    await insertMemory(db, childId, { category: "preference", content: "Favourite food is mango", provenance: "child_said", confidence: null });
    await insertMemory(db, childId, { category: "achievement", content: "Learned to swim with armbands", provenance: "child_said", confidence: null });
  });

  it("continuing the butterfly adventure retrieves the story, not unrelated facts", async () => {
    const got = await retrieveMemories(db, childId, "can we continue our butterfly adventure?");
    expect(got.map((m) => m.content)).toEqual(["Pretend butterfly adventure: Flutter the butterfly found a glowing acorn"]);
  });

  it("returns nothing for an unrelated query", async () => {
    expect(await retrieveMemories(db, childId, "what sound does a cow make")).toEqual([]);
  });

  it("is scoped to the child", async () => {
    const other = await family(db, "other@example.com");
    expect(await retrieveMemories(db, other.childId, "butterfly adventure")).toEqual([]);
  });

  it("stems plurals", () => {
    const items = [{ id: "1", category: "interest", content: "Loves butterflies", provenance: "child_said", confidence: null, in_scrapbook: false, created_at: "", updated_at: new Date().toISOString(), last_retrieved_at: null, expires_at: null }] as never;
    expect(scoreMemories("tell me about a butterfly", items)).toHaveLength(1);
  });
});

describe("deletion", () => {
  it("deleting one memory prevents retrieval and leaves a content-free record", async () => {
    const id = await insertMemory(db, childId, { category: "story", content: "Pretend dragon called Sparkle", provenance: "pretend_play", confidence: null });
    expect(await retrieveMemories(db, childId, "sparkle dragon")).toHaveLength(1);
    await db.tx((q) => deleteMemory(q, childId, id));
    expect(await retrieveMemories(db, childId, "sparkle dragon")).toEqual([]);
    expect((await db.query("SELECT count(*)::int AS n FROM memory_items WHERE id = $1", [id])).rows[0]).toEqual({ n: 0 });
    const rec = (await db.query("SELECT * FROM memory_deletion_records")).rows[0];
    expect(rec).toMatchObject({ memory_id: id, scope: "one", count: 1 });
    expect(JSON.stringify(rec)).not.toContain("Sparkle");
  });

  it("delete-all removes every memory for that child only", async () => {
    const other = await family(db, "other@example.com");
    await insertMemory(db, childId, { category: "preference", content: "Likes purple", provenance: "child_said", confidence: null });
    await insertMemory(db, childId, { category: "preference", content: "Likes cats", provenance: "child_said", confidence: null });
    await insertMemory(db, other.childId, { category: "preference", content: "Likes dogs", provenance: "child_said", confidence: null });
    expect(await db.tx((q) => deleteAllMemories(q, childId))).toBe(2);
    expect(await listMemories(db, childId)).toEqual([]);
    expect(await listMemories(db, other.childId)).toHaveLength(1);
  });

  it("a child cannot delete another child's memory", async () => {
    const other = await family(db, "other@example.com");
    const id = await insertMemory(db, other.childId, { category: "preference", content: "Likes dogs", provenance: "child_said", confidence: null });
    await expect(db.tx((q) => deleteMemory(q, childId, id))).rejects.toThrow();
    expect(await listMemories(db, other.childId)).toHaveLength(1);
  });
});

describe("conservative extraction", () => {
  const ok = (content: string, extra: object = {}) => validateCandidate({ category: "preference", content, provenance: "child_said", confidence: null, ...extra } as never, []);

  it("rejects sensitive topics, identifiers, real people's names and weak inferences", () => {
    expect(ok("Was sick and went to the doctor").ok).toBe(false);
    expect(ok("Goes to Beaconhouse school").ok).toBe(false);
    expect(ok("Lives on 12 Rose Street").ok).toBe(false);
    expect(ok("Best friend is Ayesha").reason).toBe("possible_person_name");
    expect(ok("Seems to like cars", { provenance: "inferred", confidence: 0.4 }).reason).toBe("low_confidence");
    expect(ok("Favourite colour is purple").ok).toBe(true);
  });

  it("does not store magic as a real event", () => {
    expect(validateCandidate({ category: "story", content: "Rode a dragon to a castle", provenance: "child_said", confidence: null }, []).reason).toBe("fiction_marked_real");
    expect(validateCandidate({ category: "story", content: "Rode a dragon to a castle", provenance: "pretend_play", confidence: null }, []).ok).toBe(true);
  });

  it("dedupes near-identical memories", () => {
    expect(validateCandidate({ category: "preference", content: "Favourite colour is purple", provenance: "child_said", confidence: null }, [{ content: "Favourite colour: purple" }]).reason).toBe("duplicate");
  });

  it("saves permitted memories from a normal turn", async () => {
    const r = await extractAndSave(db, { childId, sessionId: (await newSession()).id, childText: "my favourite animal is otters", unicornText: "Otters are lovely!" });
    expect(r.saved).toBe(1);
    expect((await listMemories(db, childId))[0]).toMatchObject({ content: "Favourite animal is otters", provenance: "child_said" });
  });

  async function newSession() {
    return (await db.query<{ id: string }>("INSERT INTO conversation_sessions (child_id, character_version, stage_id) VALUES ($1, 1, '5-6') RETURNING id", [childId])).rows[0];
  }
});

describe("memory disabled", () => {
  it("creates no new memories and skips retrieval", async () => {
    await insertMemory(db, childId, { category: "story", content: "Pretend butterfly Flutter", provenance: "pretend_play", confidence: null });
    await updateSettings(db, childId, { ...(await getSettings(db, childId)), memory_enabled: false });
    const turn = await runTurn(db, childId, "my favourite animal is otters");
    expect(turn.memoryJob).toBeNull();
    // Even if a job was queued before the switch, extraction re-checks the setting.
    const r = await extractAndSave(db, { childId, sessionId: turn.sessionId!, childText: "my favourite animal is otters", unicornText: "Nice" });
    expect(r.saved).toBe(0);
    expect((await listMemories(db, childId)).map((m) => m.content)).toEqual(["Pretend butterfly Flutter"]);
  });

  it("sensitive turns never produce a memory job", async () => {
    const turn = await runTurn(db, childId, "I am scared, my favourite colour is purple");
    expect(turn.memoryJob).toBeNull();
    expect(turn.mood).toBeDefined();
  });
});
