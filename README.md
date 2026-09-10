# Okupy

Okupy is a Node service that runs two iMessage-first agents over Photon Spectrum:

1. **Event scout** — remembers what each user is building, uses Firecrawl to find nearby events with free food and useful people, schedules timed iMessage reminders.
2. **Amazon watch** — tracks Amazon products the user pastes, scrapes each one via Firecrawl every 24h, and iMessages the user the moment a price drops or a target is hit.

Both agents use the **Vercel AI SDK** (`generateText` + tools) backed by `gpt-4o-mini` via AIML API. Conversation threads live in Postgres so memory survives restarts. Photon Spectrum carries iMessage in and out, while Composio provides a Gmail Connect Link.

## Flow

1. The dashboard or iMessage onboarding records what you are building, where you are, and who you need to meet.
2. Neon Postgres persists profiles, onboarding drafts, reminders, agent threads, watched Amazon items, price history, and watch alerts.
3. The event agent uses Firecrawl to search for current events, classifies for food/networking/builder credits, and schedules timed reminders via the same scheduler.
4. The watch agent accepts an Amazon URL, scrapes it through Firecrawl `/extract` with a JSON schema, stores the canonical title/price/image/ASIN.
5. A hourly scheduler checks each watched item once every 24h (staggered by `created_at`) and texts the user on Spectrum iMessage when the price drops.
6. Photon Spectrum delivers inbound iMessage to the right agent based on URL/keyword routing — Amazon requests go to the watch agent, everything else to the event agent.

## Local setup

```bash
npm install
cp .env.example .env # add AIML_API_KEY, FIRECRAWL_API_KEY, plus DATABASE_URL
npm run dev
```

To exercise the database tests against a throwaway Neon branch:

```bash
export DATABASE_URL_TEST=postgresql://…branch-host…?sslmode=require
npm test
```

Open <http://localhost:4111> for the dashboard.

Useful validation commands:

```bash
npm test
npm run typecheck
npm run build
```

## Deployment

Create a Neon project, copy the pooled connection string into Render as `DATABASE_URL`, then create a Render Blueprint from `render.yaml` with `AIML_API_KEY`, `FIRECRAWL_API_KEY`, `COMPOSIO_API_KEY`, and Photon/Spectrum credentials. One Node service runs the HTTP server, all agents, schedulers, and Photon. Schema migrations run on startup. Public integration locations are constants in `src/agent/config.ts`.

See [the architecture guide](docs/architecture.md) for trust boundaries and production notes.