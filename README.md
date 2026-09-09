# Okupy

Okupy is a TypeScript Mastra agent for builders who have been heads-down too long. It remembers what each person is building, uses Exa to find nearby events with free food and useful people, and replies over Photon Spectrum iMessage.

## Flow

1. The dashboard or iMessage onboarding records what you are building, where you are, and who you need to meet.
2. A persistent profile store and LibSQL-backed Mastra memory retain context under the user's channel ID.
3. A typed Mastra tool turns the profile into a time-bounded Exa search for current local opportunities.
4. Results are classified for food, networking, and builder credits, with source links and an RSVP reminder.
5. Photon Spectrum carries the same agent conversation over iMessage, while Composio provides a Gmail Connect Link.

## Local setup

```bash
npm install
cp .env.example .env # add OPENAI_API_KEY and EXA_API_KEY
npm run dev
```

Open <http://localhost:4111>. Mastra also exposes its standard developer APIs and Studio.

Useful validation commands:

```bash
npm test
npm run typecheck
npm run build
```

## Deployment

Create a Render Blueprint from `render.yaml`, then set the OpenAI, Exa, Composio, and Photon credentials. One Node service runs both Mastra and Photon and stores profiles plus conversation history on the persistent disk. Public integration locations are constants in `src/mastra/config.ts`; there are no URL environment variables or Python services.

See [the architecture guide](docs/architecture.md) for trust boundaries and production notes.
