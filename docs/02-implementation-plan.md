# 02 — Implementation plan and release gates

Each phase ends in a working, committed state on `feat/v1`. A gate is passed only on the evidence listed; "builds" is not evidence that voice works.

| Phase | Deliverable | Gate evidence |
|---|---|---|
| 0 Repository & architecture | Docs 00–04, project skeleton, test runner | Docs committed; `npm test` runs |
| 1 Character experience | Lumi SVG, state machine, talk/stop/retry controls, reduced motion, mobile layout | State-machine unit tests; manual render check desktop + 375px mobile |
| 2 Real voice | STT, orchestrator, Claude adapter, output validation, signed TTS, playback + interruption, latency metrics | Unit tests with mocked providers; **live check requires API keys** (blocked until supplied) |
| 3 Persistent memory | Schema, conservative extraction, provenance, retrieval, parent view/edit/delete/disable, export | Memory lifecycle integration tests on PGlite: persist across sessions, delete → not retrievable, disabled → nothing saved |
| 4 Safety & parental controls | Parent auth, device pairing, server-side authz, retention, limits, quiet hours, budget, safety events | Access-control integration tests (no cookie / wrong child / child device on parent route → 401/403); deterministic safety suite |
| 5 Growth & activities | Stage configs 5–6 … 13+, preview / approve / reject / rollback / history, activities toggles, scrapbook, birthday | Stage tests: older stages never default, safety rules identical across stages, rollback works |
| 6 Hardening | Full test run, production build, live evals (if keys), mobile/a11y checks, security review | Recorded results in delivery report |
| 7 GitHub & deployment | Pushed branch, deployment guide, env var list | Push verified with `git ls-remote`; **deploy only with credentials + owner approval** |

Owner approval required before: merging `feat/v1` into `main`, any production deploy, any paid plan change.
