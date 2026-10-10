import { vi } from "vitest";
import { migrate, openPglite, setDb, type Db } from "@/lib/db";
import { createParent } from "@/lib/auth";
import { createChild } from "@/lib/children";

/** Cookie jar shared with the mocked next/headers module. */
export const jar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    set: (n: string, v: string) => void jar.set(n, v),
    delete: (n: string) => void jar.delete(n),
  }),
}));

// Outside Next's request scope, run after() callbacks immediately so background work is exercised.
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (fn: () => unknown) => void Promise.resolve().then(fn),
}));

export async function freshDb(): Promise<Db> {
  const db = await openPglite(); // in-memory
  await migrate(db);
  setDb(db);
  return db;
}

export async function family(db: Db, email = "parent@example.com") {
  const parentId = await createParent(db, email, "correct horse battery");
  const childId = await createChild(db, parentId, { display_name: "Hanya", age: 5, birthday: null });
  return { parentId, childId };
}

export function req(url: string, init: RequestInit & { json?: unknown } = {}) {
  const headers = new Headers(init.headers);
  headers.set("host", "localhost:3000");
  headers.set("origin", "http://localhost:3000");
  if (init.json !== undefined) headers.set("content-type", "application/json");
  return new Request("http://localhost:3000" + url, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
}

export const ctx = (params: Record<string, unknown>) => ({ params: Promise.resolve(params) }) as never;
