# Okupy

Okupy is a TypeScript Mastra agent for builders who have been heads-down too long. It remembers what each person is building, uses Exa to find nearby events with free food and useful people, schedules timed iMessage reminders, and replies over Photon Spectrum iMessage.

## Flow

1. The dashboard or iMessage onboarding records what you are building, where you are, and who you need to meet.
2. A Neon Postgres database retains profiles, onboarding drafts, reminders, and an audit trail of delivered reminders across deploys. LibSQL keeps the recent Mastra thread memory hot.
3. A typed Mastra tool turns the profile into a time-bounded Exa search for current local opportunities.
4. Results are classified for food, networking, and builder credits, with source links and an RSVP reminder.
5. After every discovery turn the agent deterministically asks whether to schedule reminders and acts on natural-language batch instructions like "go through the scans and pick the ones to schedule invites for".
6. A 30s scheduler ticks, fires due reminders through the same agent, and delivers via Spectrum iMessage (or logs when Photon is offline).
7. Photon Spectrum carries the same agent conversation over iMessage, while Composio provides a Gmail Connect Link.

## Local setup

```bash
npm install
cp .env.example .env # add AIML_API_KEY and EXA_API_KEY, plus DATABASE_URL from Neon
npm run dev
```

To exercise the database tests against a throwaway Neon branch:

```bash
export DATABASE_URL_TEST=postgresql://…branch-host…?sslmode=require
npm test
```

Open <http://localhost:4111>. Mastra also exposes its standard developer APIs and Studio.

Useful validation commands:

```bash
npm test
npm run typecheck
npm run build
```

## Deployment

Create a Neon project, copy the pooled connection string into Render as `DATABASE_URL`, then create a Render Blueprint from `render.yaml` with the AIML, Exa, Composio, and Photon credentials. The agent routes to AIML API (`https://api.aimlapi.com/v1`) using `gpt-4o-mini`. One Node service runs both Mastra and Photon. Schema migrations run on startup, so no separate migration step is required. Public integration locations are constants in `src/mastra/config.ts`; there are no URL environment variables or Python services.

See [the architecture guide](docs/architecture.md) for trust boundaries and production notes.