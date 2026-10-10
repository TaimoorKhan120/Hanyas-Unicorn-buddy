# Hanya's Unicorn Buddy — Lumi

A voice-first, gentle unicorn companion for a five-year-old, with parent-controlled memory, developmental stages and layered child-safety controls.

Tap the big button, talk, and Lumi answers in a soft voice while her face follows what is really happening (listening, thinking, talking). A separate, password-protected parent area controls memory, retention, time limits, activities, voice and growth stages.

## Status (2026-10-10)

| Area | State |
|---|---|
| Character, animation, state machine | Built; unit tested; checked in browser at desktop and 375 px mobile |
| Voice pipeline (STT → safety → Claude → validation → TTS → playback, interruption) | Built; tested with mocked providers. **Not yet verified with real API keys or a real microphone** |
| Memory (provenance, extraction, retrieval, edit/delete/disable, export, expiry) | Built; integration tested on Postgres (PGlite) |
| Parent auth, device pairing, server-side authorisation, CSRF, limits, budget | Built; integration tested, plus a smoke test against real Postgres in production mode |
| Developmental stages (5–6 … 13+, preview/approve/reject/rollback/history) | Built; tested. Only 5–6 is marked tested for use |
| Live-model safety evals + latency probe | Written (`npm run eval:live`); **not run** — needs API keys |
| Deployment | Not deployed. See `docs/07-deployment.md` |

## Quick start

```bash
npm install
cp .env.example .env.local   # set SETUP_TOKEN
PROVIDER_MODE=mock npm run dev
```

Then open `/parent` → set up → **Device & data → Use this device for Lumi** → open `/`.

## Docs

- `docs/00-repository-assessment.md`
- `docs/01-architecture.md` — stack, components, data model, data flow and retention
- `docs/02-implementation-plan.md` — phases and release gates
- `docs/03-risk-register.md`
- `docs/04-external-services.md` — credentials and cost estimates
- `docs/05-safety-and-parent-support.md`
- `docs/06-character-spec.md`
- `docs/07-deployment.md`

## Layout

```
src/character/    lumi.ts (identity), stages.ts (developmental configs), stateMachine.ts
src/safety/       policy.ts (versioned rules), rules.ts (deterministic enforcement)
src/conversation/ prompt.ts (context assembly), orchestrator.ts (one turn)
src/memory/       store.ts, extract.ts, retrieve.ts
src/providers/    llm.ts (Claude), speech.ts (OpenAI STT/TTS/moderation), config.ts
src/lib/          db.ts, auth.ts, children.ts (settings, stages), limits.ts, crypto.ts, http.ts
src/parent/       actions.ts (dashboard API)
src/app/          pages and API routes
src/components/   Unicorn.tsx, ChildApp.tsx, ParentApp.tsx, ParentAuth.tsx
migrations/       SQL migrations
evals/            cases.json (safety cases), live.eval.ts
tests/            unit + integration tests
```

Providers sit behind small adapter modules (`src/providers/*`). Swapping a vendor means replacing one file; character, safety and memory code do not know which vendor is used.
