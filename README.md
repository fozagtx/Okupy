# Okupy

Okupy is a TypeScript Mastra agent for builders who have been heads-down too long. It remembers what each person is building, uses Exa to find nearby events with free food and useful people, and replies over Photon iMessage.

## Flow

1. The dashboard asks what you are building, where you are, and who you need to meet.
2. Mastra memory and the persistent profile store retain context under the user's channel ID.
3. A typed Mastra tool turns the profile into an Exa search for current, local opportunities.
4. The agent reports food, networking, and builder-credit opportunities with source links.
5. Photon Spectrum carries the same agent conversation over iMessage.

## Local setup

```bash
npm install
cp .env.example .env # add OPENAI_API_KEY and EXA_API_KEY
npm run dev
```

Open <http://localhost:4111>. Mastra also exposes its standard developer APIs and Studio.

## Deployment

Create a Render Blueprint from `render.yaml`, then set the OpenAI, Exa, Composio, and Photon credentials. One Node service runs both Mastra and Photon. Public API locations are constants in `src/mastra/config.ts`; there are no URL environment variables or Python services.

See [the architecture guide](docs/architecture.md) for trust boundaries and production notes.
