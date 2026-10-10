# 01 — System architecture

## Stack (and why)

| Concern | Choice | Reason |
|---|---|---|
| App framework | **Next.js (App Router) + TypeScript** | One codebase for the child UI, parent dashboard and server APIs. Secrets stay in route handlers. Deploys to Vercel or any Node host. |
| Database | **PostgreSQL**, plain SQL migrations, `pg` driver | Relational data with ownership constraints. No ORM: the schema is small and SQL is readable at 3am. Tests and zero-setup local dev use **PGlite** (Postgres compiled to WASM) through the same `query()` interface. |
| Conversation model | **Anthropic Claude** (`claude-opus-5-5`, `effort: low`, configurable via `CLAUDE_MODEL`) | Strong instruction following for a child-safety persona; structured outputs for reply + mood and for memory extraction. |
| Speech-to-text | **OpenAI `gpt-4o-mini-transcribe`** (configurable) | Good accuracy on children's speech at $0.003/min estimate. |
| Text-to-speech | **OpenAI `gpt-4o-mini-tts`**, voice `shimmer` with style instructions (configurable) | Natural, soft feminine voice; tone steerable by instructions; one vendor for STT + TTS + moderation. |
| Moderation | **OpenAI `omni-moderation-latest`** + deterministic local rules | Free classifier, plus code-enforced rules that do not depend on any model. |
| Animation | **Hand-built SVG + CSS**, amplitude-driven mouth via Web Audio `AnalyserNode` | Lightweight, crisp at any size, works on low-end tablets, honours `prefers-reduced-motion`. No 3D. |
| Tests | **Vitest** | Fast, TypeScript native. |

Rejected for now: real-time speech-to-speech (cannot moderate text before it is spoken — see §7 of the spec), embeddings/vector DB (structured keyword retrieval is sufficient and testable at this data size), separate auth provider (one parent account; scrypt + DB sessions is less moving parts), Tailwind/UI kits (a handful of screens).

## Components

```
Browser (child device)                     Server (Next.js route handlers)                 Providers
──────────────────────                     ───────────────────────────────                 ─────────
Unicorn SVG  ◀── character state machine   POST /api/turn
Talk button  ── MediaRecorder (explicit) ─▶  1 auth: device cookie → child profile
                                             2 limits: quiet hours, daily, session, rate, budget
                                             3 STT ───────────────────────────────────────▶ OpenAI transcribe
                                             4 input safety (rules + moderation) ──────────▶ OpenAI moderation
                                             5 context: character + stage + recent turns
                                               + retrieved memories (as untrusted data)
                                             6 generate reply + mood (structured) ────────▶ Anthropic
                                             7 output validation (rules + moderation) ────▶ OpenAI moderation
                                               fail → safe fallback line
                                             8 sign validated text (HMAC)
          ◀── {transcript, say, mood, sig} ──
Audio     ── POST /api/speak {say, sig} ───▶ verify sig → TTS ─────────────────────────────▶ OpenAI TTS
          ◀── audio/mpeg ───────────────────
                                             after(): memory extraction (if enabled and not
                                               sensitive) → validate → save ───────────────▶ Anthropic
Parent dashboard ── cookie session ────────▶ /api/parent/* (server-side authz on every route)
```

The HMAC signature on step 8 means `/api/speak` will only ever voice text the server produced and validated, without keeping server-side state (works on serverless).

### Character state machine

`src/character/stateMachine.ts` is a pure reducer: `(state, event) → state`, with an explicit transition table and tests. Visual state is derived only from real events (`MIC_STARTED`, `RECORDING_STOPPED`, `REPLY_READY`, `AUDIO_STARTED`, `AUDIO_ENDED`, `FAILED`, `INTERRUPT`, `LIMIT_REACHED` …). Mood states (`HAPPY`, `CURIOUS`, `COMFORTING`) are short-lived expressions entered after speaking, returning to `IDLE`. Every non-terminal state has a recovery edge; `PROCESSING` has a client watchdog timeout that raises `FAILED`.

## Data model

Migrations live in `migrations/*.sql` and run in order, tracked in `schema_migrations`.

| Table | Purpose / notes |
|---|---|
| `parent_accounts` | One parent login: email, scrypt hash. |
| `parent_sessions` | SHA-256 of random session token, expiry. Raw token only in an httpOnly cookie. |
| `child_profiles` | Owned by a parent. Name, age, optional birthday. |
| `parent_settings` | 1:1 with child. Memory on/off, transcript retention, limits, quiet hours, timezone, activities, voice, safety-alert mode. |
| `child_devices` | Paired child devices (hashed token → child). The child UI can only act for the child its device is paired to. |
| `stage_history` | Developmental stage versions per child: `proposed / active / rejected / superseded`. Gives preview, approval, rollback and history. |
| `conversation_sessions` | Start/last-turn timestamps; character + stage version used. |
| `conversation_turns` | Child/unicorn text for the bounded recent-context window. Purged per retention policy. `sensitive` flag blocks memory extraction. |
| `memory_items` | `category`, `content`, `provenance` (`child_said / parent_added / inferred / pretend_play`), `confidence` (only for inferred), `source_session_id`, `in_scrapbook`, timestamps, `expires_at`. |
| `memory_deletion_records` | Content-free proof of deletion: memory id (or `all`), count, time. |
| `safety_events` | Category + action only, **no conversation content**. Powers the disclosed parent-support policy. |
| `usage_records` | Provider, kind, quantity, unit, **estimated** cost, latency metrics. |

Not stored: raw audio (never persisted), `deletion_status` (deletion is a hard `DELETE`; the record table proves it), `source_reference` (session id is sufficient), `CharacterConfiguration` and `DevelopmentalStage` definitions (version-controlled code in `src/character/`, referenced by id + version — they are product definitions, not user data).

Every child-scoped query filters by `child_id`, and every child id is derived server-side from the authenticated device or parent session — never from a request body.

## Data flow and retention

| Hop | Receives | Retention |
|---|---|---|
| Browser | Mic audio while button active; reply text/audio | Nothing persisted except the device cookie. |
| App server | Audio (in memory only, discarded after STT), transcript, reply | Turns kept while needed for recent context; deleted after `transcript_retention_days` if retention is on, or 2 hours after last turn if off. Memories per parent settings. |
| OpenAI (STT, TTS, moderation) | Audio clip, transcript text, reply text | Governed by OpenAI API data policy (API data not used for training by default; abuse-monitoring retention up to 30 days unless zero-retention is arranged). Not controllable by this app. |
| Anthropic | System prompt, recent turns, selected memories | Governed by Anthropic commercial API terms (not used for training by default; limited retention for trust & safety). Not controllable by this app. |
| Database | All tables above | Until parent deletes, or expiry. Provider backups (e.g. Neon/Supabase PITR) may retain deleted rows for the backup window — documented, not promised away. |
| Logs | Request ids, status codes, error classes. **No transcripts or audio.** | Hosting provider log retention. |

## Safety layering

1. Version-controlled policy (`src/safety/policy.ts`) rendered into the system prompt.
2. Input checks: deterministic patterns (distress, disclosure, danger, personal identifiers) + moderation. Flags steer the reply mode (`COMFORTING`) and mark the turn sensitive.
3. Untrusted-content isolation: transcript and memories enter as user-turn data inside labelled tags; the system prompt says they are never instructions.
4. Output validation: deterministic forbidden-pattern rules (secrecy, exclusivity, guilt, "I'm alive", medical diagnosis, personal-info requests, links) + moderation + length cap. Failure → a stage-appropriate safe fallback line. Unvalidated text is never sent to TTS.
5. Fail closed: moderation outage → fallback line, never unmoderated speech.
6. Content-free safety events for the parent.
