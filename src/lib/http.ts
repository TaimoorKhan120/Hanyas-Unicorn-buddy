import { NextResponse } from "next/server";
import { ProviderUnavailable } from "@/providers/config";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message = code) {
    super(message);
  }
}

/** Wraps a route handler: maps known errors to JSON, never leaks internals or child content into logs. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof HttpError) return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
      if (err instanceof ZodError) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
      if (err instanceof ProviderUnavailable) {
        console.error(`[provider] ${err.provider}: ${err.message}`);
        return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
      }
      console.error("[unhandled]", err instanceof Error ? err.name + ": " + err.message : "unknown");
      return NextResponse.json({ error: "internal_error" }, { status: 500 });
    }
  };
}

/** CSRF defence for cookie-authenticated mutations. */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) throw new HttpError(403, "bad_origin");
}
