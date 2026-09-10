# Okupy Architecture

> Project name is **Okupy** (`okupy`, service `okupy-api`). `freeFood` below is
> only an event signal (event offers free food) — not the project name.

Okupy is one TypeScript Node process over the Vercel AI SDK. Two iMessage-first
agents share one inbound router, one Neon Postgres database, and one Spectrum
iMessage transport.

```mermaid
flowchart LR
  U[Builder] --> D[Dashboard]
  U --> P[Photon Spectrum iMessage]
  D --> R[HTTP routes in src/server.ts]
  P --> RSP[respond router]
  R --> RSP
  RSP --> E[Event agent: gpt-4o-mini + Exa tools]
  RSP --> W[Watch agent: gpt-4o-mini + Amazon tools]
  E --> X[Exa search API]
  W --> F[Firecrawl extract API]
  E <--> N[(Neon Postgres: profiles, drafts, reminders, threads)]
  W <--> N2[(Neon Postgres: watched_items, price_history, watch_alerts)]
  R --> C[Composio Gmail Connect Link]
  E --> S[Scheduler: reminders every 30s]
  W --> WS[Scheduler: prices hourly, 24h per item]
  S --> P
  WS --> P
```

`runEventAgent` and `runWatchAgent` both use `generateText` with typed tools and
`stepCountIs(6)`. Event discovery performs time-bounded Exa searches and only
keeps results with explicit food, networking, or builder-credit signals.
Results retain source URLs, and replies remind users to verify event and RSVP
details.

The watch agent tracks Jumia Ghana (`jumia.com.gh/...-<ID>.html`) plus Amazon.
Jumia links from any other country (`.com.ng`, `.co.ke`, `.com.eg`, `.ma`, …)
are rejected with a message asking for the `jumia.com.gh` version. Each link is
scraped through Firecrawl `/extract`, baselined, then checked at most once
every 24h (hourly batch of 5, staggered by `last_checked_at`). Missing prices
only bump `last_checked_at`; they never overwrite `last_price` with a
placeholder. Dedupe is per `(user_id, store, asin)`, so the same numeric id on
Amazon and Jumia tracks independently. Jumia Ghana prices use GHS; Amazon items
default to USD unless the scrape returns a code.

The dashboard and Photon Spectrum call the same response boundary
(`respond()`). New event senders complete a short persisted onboarding
conversation before discovery, so restarts do not lose their progress.
Conversation history lives in Neon `agent_threads` (30 messages per user,
namespaced `watch:` for the watch agent) and is partitioned by stable channel
identity.

Photon runs inside the same Node process. There is no sidecar server, Python
worker, FastAPI service, Uvicorn process, slideshow/video pipeline, Daytona
integration, Mastra runtime, LibSQL file, or internal API URL.

All public integration locations are source-controlled in
`src/mastra/config.ts`. Only provider credentials and secrets are read from the
environment (`AIML_API_KEY`, `EXA_API_KEY`, `FIRECRAWL_API_KEY`,
`COMPOSIO_API_KEY`, `DATABASE_URL`, `SPECTRUM_*`, optional `PUBLIC_BASE_URL`,
`WATCH_POLL_INTERVAL_MS`, `WATCH_BATCH_SIZE`). Gmail OAuth callbacks are built
from allowlisted `PUBLIC_BASE_URL` (https only), never from a client `?host=`.
Production deployments should additionally authenticate dashboard profile
access, normalize channel identities, encrypt persistent data, and provide
profile deletion/export and retention controls.
