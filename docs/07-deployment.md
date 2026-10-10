# 07 — Setup and deployment

## Local development (no keys needed)

```bash
npm install
cp .env.example .env.local      # set SETUP_TOKEN; leave DATABASE_URL empty to use embedded PGlite in .data/
PROVIDER_MODE=mock npm run dev   # fake AI, yellow "DEV MOCK" banner, type instead of speaking
```

Open `http://localhost:3000/parent`, create the parent account with your `SETUP_TOKEN`, then **Device & data → Use this device for Lumi**, then open `/`.

For real voice locally, set `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` in `.env.local` and run `npm run dev` without `PROVIDER_MODE`. Microphone access needs `localhost` or HTTPS.

## Tests

```bash
npm test            # unit + integration (PGlite, mocked providers), no network
npm run eval:live   # live-model safety eval + latency probe; needs both API keys; costs money
npm run build
```

## Production (Vercel + managed Postgres)

1. Create a Postgres database (Neon, Supabase or Vercel Postgres). Copy the connection string.
2. Create a Vercel project from this GitHub repo.
3. Set environment variables (Production): `DATABASE_URL`, `APP_SECRET` (`openssl rand -hex 32`), `SETUP_TOKEN` (random), `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, optionally `MONTHLY_BUDGET_USD`. Never set `PROVIDER_MODE` in production (the app refuses mock mode when `NODE_ENV=production`).
4. Deploy. Migrations run automatically on first database use (serialised with an advisory lock). You can also run `DATABASE_URL=... npm run migrate` beforehand.
5. Visit `/parent` over HTTPS, create the account, pair the child's device.
6. After setup, rotate or remove `SETUP_TOKEN` (setup is also refused once a parent exists).
7. Set spend limits in the Anthropic and OpenAI consoles.

Function duration: `/api/turn` declares `maxDuration = 60`. Vercel Hobby allows this.

Any Node 20+ host also works: `npm ci && npm run build && npm start` with the same environment variables behind HTTPS.
