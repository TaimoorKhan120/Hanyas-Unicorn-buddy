# 03 — Risk register

Likelihood / impact: L/M/H. "Residual" is what remains after the listed controls.

| # | Area | Risk | L | I | Controls | Residual |
|---|---|---|---|---|---|---|
| S1 | Safety | Model produces harmful, frightening or sexual content | L | H | Policy prompt, output moderation, deterministic forbidden-pattern rules, safe fallback, never speak unvalidated text | Novel phrasing that passes both moderation and rules. Live evals + parent review of safety events. |
| S2 | Safety | Unicorn encourages secrecy, exclusivity, guilt or dependence | M | H | Explicit policy rules + deterministic output rules for secrecy/exclusivity/guilt/"I'm alive" phrases; tests | Subtle relational framing not caught by patterns. |
| S3 | Safety | Distress or abuse disclosure handled badly (leading questions, promises of secrecy) | M | H | Input detector routes to COMFORTING mode with fixed guidance: acknowledge, no interrogation, tell a trusted adult; no secrecy promises; content-free parent alert | Detector false negatives on indirect language. Product is not a safeguarding service. |
| S4 | Safety | Prompt injection via speech ("ignore your rules") or via stored memories | M | M | Transcript and memories wrapped as untrusted data; memory content validated on write; output rules apply regardless of instructions | Model may partially comply; output layer is the backstop. |
| S5 | Safety | Moderation / provider outage → unchecked output | L | H | Fail closed: fallback line, no TTS of unmoderated text | Child experiences "Lumi is sleepy" errors during outages. |
| P1 | Privacy | Child data sent to third parties | H (by design) | M | Minimised context (≤5 memories, ≤10 recent turns), no raw audio stored, no names of other people extracted to memory, documented flows | Provider-side retention (abuse monitoring) outside our control. |
| P2 | Privacy | Sensitive disclosure stored as memory | M | H | Sensitive turns skip extraction; extraction validator rejects health, family conflict, location, identifiers, other people's names | Validator misses. Parent can view/delete all memories. |
| P3 | Privacy | Unauthorised access to child data | L | H | Server-side authz on every route, hashed tokens, httpOnly cookies, Origin check on mutations, child id never from request body | Compromised parent password. Recommend strong password. |
| P4 | Privacy | Legal obligations (COPPA, UK Age Appropriate Design Code, GDPR-K, PECA/local law) not assessed | M | M | No compliance claims; private single-family use; assessment checklist in `04-external-services.md` | Owner must assess before wider use. |
| V1 | Voice | Latency > 2.5 s makes conversation feel broken | M | M | Short replies, low effort, TTS starts as soon as text validated, latency recorded | Network and provider variance. |
| V2 | Voice | STT mis-hears a 5-year-old | H | M | Empty/low-content transcripts → gentle "say that again"; optional transcript display for parents | Unavoidable error rate. |
| V3 | Voice | iOS Safari audio autoplay / mic quirks | M | M | Audio unlocked on the talk-button gesture; MediaRecorder mime negotiation; clear permission errors | Older iOS versions. |
| M1 | Memory | Fabricated memories ("remember when we…") | M | M | Prompt rule + only retrieved memories presented; "I can't quite remember" behaviour; tests | Model may still embellish. |
| M2 | Memory | Pretend play stored as fact | M | L | `pretend_play` provenance, rendered to the model as "pretend story", tests | Ambiguous utterances. |
| M3 | Memory | Deletion incomplete | L | H | Hard delete; no caches/indexes/replicas outside Postgres; integration test proves non-retrieval | Hosting provider backups for their retention window. |
| C1 | Cost | Runaway spend (bug, loop, abuse) | L | M | Per-minute rate limit, daily minutes, session length, monthly estimated-cost budget enforced server-side, paired devices only | Budget is based on estimates, not provider invoices. Set provider-side hard limits too. |
| D1 | Deploy | Secrets leaked | L | H | Env vars only, `.env*` git-ignored, no `NEXT_PUBLIC_` secrets, check in delivery report | Human error. |
| D2 | Deploy | Mock mode leaks into production | L | M | Mock refused when `NODE_ENV=production`; visible "DEV MOCK" banner | — |
