# 05 — Safety controls and parent-support policy

Safety policy version: **1** (`src/safety/policy.ts`). Evaluation cases version: **1** (`evals/cases.json`).

## Layers (what actually enforces what)

| Layer | Where | Enforced by |
|---|---|---|
| Behavioural rules (secrecy, exclusivity, guilt, "I'm alive", danger, medical, personal info, protection, fabricated memory, links) | `src/safety/policy.ts` | System prompt (probabilistic) **and** `src/safety/rules.ts` output patterns (deterministic) |
| Input assessment: self-harm, emergency, disclosure, distress, danger, secrecy request, personal info, injection | `assessInput()` | Code. Self-harm and emergency get fixed scripted replies, no model call. Disclosure/distress get the difficult-conversation guide added. |
| Identifier redaction (phone numbers, emails, street addresses) | `redact()` | Code, before text goes to any provider or the database |
| Untrusted-content isolation | `src/conversation/prompt.ts` | Child speech and memories are wrapped in tags inside the user turn; never in the system prompt |
| Output moderation | `omni-moderation-latest` | Provider classifier; **outage = fallback line (fail closed)** |
| Never voice unvalidated text | `/api/speak` | HMAC signature over validated text, bound to the child; forged or cross-child text → 403 |
| Memory exclusion | `extract.ts` | Sensitive or injection turns never reach extraction; candidates re-validated in code |
| Stage independence | `stages.ts` | Stage objects have no safety fields; tests assert every stage prompt contains every rule |
| Limits | `limits.ts` | Quiet hours, daily/session minutes, rate limit, monthly estimated budget — server-side |

## Difficult conversations

When the child sounds upset or describes something unsafe, Lumi is instructed to: respond calmly; name the feeling without assuming; ask no probing or leading questions; not investigate; never promise secrecy; encourage telling a trusted grown-up today; for possible immediate danger, go to a nearby grown-up now. If the model's reply fails validation in this mode, a fixed comforting line is spoken instead.

Self-harm and emergencies never depend on the model: a pre-written reply directs the child to a nearby grown-up.

## Parent-support policy (disclosed in the dashboard)

- Lumi records **only the category and time** of a concern (e.g. "worried, sad or scared feelings", "possible unsafe experience", "Lumi's reply was replaced by a safe one"). It never records or forwards the words said.
- These appear under **Overview → Gentle check-in notices**. Nothing is sent by email, SMS or push.
- The parent can turn these notices off (Settings → Gentle check-in notices). When off, no safety events are stored.
- If conversation-text retention is on, the parent can read retained text in the data export; it is off by default.
- This app is **not** a safeguarding or emergency service.

## Evidence and limits

- Deterministic tests: `tests/safety.test.ts`, `tests/orchestrator.test.ts` (run with `npm test`).
- Live-model evaluation: `npm run eval:live` (needs API keys; records model + policy versions to `evals/results/`). **Not yet run** — no keys were available during development.
- Passing a finite suite does not prove safety. Pattern rules can miss novel phrasings; moderation can miss context; the model can be subtly off. Review safety notices and spot-check conversations (with retention on) during early use.
