# Okupy

Okupy is an iMessage-first shopping and price-tracking concierge built on Node and the Vercel AI SDK over Photon Spectrum.

1. **Price Drop & Target Alerts** — monitors Amazon and Jumia Ghana (`jumia.com.gh`) products. Users can paste product links or search by name. A hourly scheduler checks each item once every 24h via Firecrawl `/extract` and texts the user on iMessage the moment a price drops or reaches a user-defined target.
2. **Gmail Deal Scanner** — connects Gmail via Composio. When requested ("check my Gmail for deals"), scans promotional emails from Amazon and Jumia, surfaces structured offers with product links, and tracks chosen items on command.

Both agents use the **Vercel AI SDK** (`generateText` + tools) backed by `gpt-4o-mini` via AIML API. Conversation threads live in Postgres so memory survives restarts. Photon Spectrum carries iMessage in and out.

## Flow

1. The user texts an Amazon or Jumia Ghana product link (or searches by product name).
2. The watch agent scrapes the product via Firecrawl `/extract`, saves it to Neon Postgres (`watched_items`), and records the initial baseline price.
3. The user can specify an optional target price (e.g. "alert me under $150" or "notify me below GH₵ 2000").
4. A hourly background scheduler checks watched items every 24h (staggered by creation offset) and pings the user via iMessage on Spectrum whenever a price drops or hits the target.
5. Users can say "check my Gmail for offers" to scan promotional messages and track any selected deal with a single tap.

## Local setup

```bash
npm install
cp .env.example .env # add AIML_API_KEY, FIRECRAWL_API_KEY, COMPOSIO_API_KEY, plus DATABASE_URL
npm run dev
```

To exercise database tests against a throwaway Neon branch:

```bash
export DATABASE_URL_TEST=postgresql://…branch-host…?sslmode=require
npm test
```

Useful validation commands:

```bash
npm test
npm run typecheck
npm run build
```

## Deployment

Create a Neon project, copy the pooled connection string into Render as `DATABASE_URL`, then create a Render Blueprint from `render.yaml` with `AIML_API_KEY`, `FIRECRAWL_API_KEY`, `COMPOSIO_API_KEY`, and Photon/Spectrum credentials. One Node service runs the HTTP server, the agents, the price-check scheduler, and Photon. Schema migrations run on startup. Public integration locations are constants in `src/agent/config.ts`.

See [the architecture guide](docs/architecture.md) for trust boundaries and production notes.