# Okupy

Okupy is an iMessage-first agent for builders who have been heads-down too long. It remembers what each person is building, uses Exa to find nearby events with free food and useful people, and highlights opportunities offering cloud/API credits or other startup perks.

## Flow

1. The dashboard asks what you are building, where you are, and who you need to meet.
2. Durable SQLite memory stores that profile under the user's channel ID.
3. The agent turns the profile into an Exa search for current, local opportunities.
4. Results are labelled for food, networking, and builder credits, with source URLs.
5. Photon Spectrum carries the conversation over iMessage. Composio provides Gmail authorization.

## Local setup

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e '.[dev,composio]'
cp .env.example .env # add EXA_API_KEY
uvicorn okupy.api:app --reload
```

Open <http://localhost:8000>. API docs are at `/docs`.

```bash
curl -X PUT localhost:8000/v1/profile/demo -H 'content-type: application/json' -d '{
  "user_id":"demo", "project":"privacy-first CRM for freelancers",
  "location":"Brooklyn, NY", "goals":["customers","feedback"], "interests":["AI","SaaS"]
}'
curl -X POST localhost:8000/v1/discover -H 'content-type: application/json' -d '{
  "user_id":"demo", "message":"What should I attend this week?"
}'
```

## Deployment

Create a Render Blueprint from `render.yaml`, then set the Exa, Composio, and Photon credentials. The API uses a persistent disk for memory; the Photon worker keeps the iMessage stream alive. API URLs are constants in `src/okupy/config.py`, not environment variables.

See [the architecture guide](docs/architecture.md) for trust boundaries and production notes.
