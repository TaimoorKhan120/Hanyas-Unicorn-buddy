# 04 — External services, credentials and cost

## Required

| Service | Used for | Env var | Notes |
|---|---|---|---|
| Anthropic API | Conversation + memory extraction | `ANTHROPIC_API_KEY` | Set a monthly spend limit in the Anthropic Console. |
| OpenAI API | Speech-to-text, text-to-speech, moderation | `OPENAI_API_KEY` | Set a monthly usage limit in the OpenAI dashboard. |
| PostgreSQL | All persistent data | `DATABASE_URL` | Any managed Postgres (Neon, Supabase, Vercel Postgres) or self-hosted. Optional in local dev (PGlite fallback). |
| App secrets | Cookie/HMAC signing, first-run parent setup | `APP_SECRET` (≥32 random chars), `SETUP_TOKEN` | Generate with `openssl rand -hex 32`. |

Optional: `CLAUDE_MODEL`, `STT_MODEL`, `TTS_MODEL`, `TTS_VOICE`, `MONTHLY_BUDGET_USD`, `PROVIDER_MODE=mock` (dev only).

Hosting: Vercel (Hobby is free for personal use) or any Node 20+ host.

## Cost estimate (assumptions explicit — estimates, not invoices)

Prices checked 2026-10-10 from provider pricing pages:
- `gpt-4o-mini-transcribe` ≈ $0.003 / audio minute (OpenAI estimate).
- `gpt-4o-mini-tts` $0.60 / 1M text tokens + $12 / 1M audio tokens ≈ $0.015 / audio minute (OpenAI estimate).
- `omni-moderation-latest` free.
- `claude-opus-5-5` $4 / 1M input, $20 / 1M output tokens.

Per turn assumptions: child speaks 6 s; Lumi speaks 8 s; ~2,500 input tokens (system prompt + context, uncached) and ~120 output tokens (including low-effort thinking) for the reply; memory extraction ~1,500 in / 150 out on half of turns.

| Item | Per turn |
|---|---|
| STT 0.1 min | $0.0003 |
| TTS 0.133 min | $0.0020 |
| Claude reply | $0.0100 + $0.0024 = $0.0124 |
| Claude extraction (×0.5) | $0.0045 |
| **Total** | **≈ $0.019** |

| Usage | Turns / month | Est. monthly |
|---|---|---|
| Light: 10 min/day, ~2 turns/min, 20 days | 400 | ≈ $8 |
| Moderate: 20 min/day, 30 days | 1,200 | ≈ $23 |
| Heavy: 45 min/day, 30 days | 2,700 | ≈ $51 |

The largest lever is the model: setting `CLAUDE_MODEL=claude-haiku-4-5` would cut the Claude share by roughly 4× but must be re-evaluated against the safety eval suite first. Prompt caching of the stable system prompt also reduces input cost on repeated turns.

## Before using with Hanya — owner checklist

- [ ] Read OpenAI and Anthropic API data-retention terms; request zero-data-retention if available to you.
- [ ] Decide jurisdiction-specific obligations (e.g. COPPA if US-hosted/targeted, UK AADC/GDPR if UK/EU, Pakistan PECA/data protection). This app is built for private family use; no compliance is claimed.
- [ ] Set provider-side spending limits.
- [ ] Choose a strong parent password.
