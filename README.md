# Okupy

Tutorial engine: give it any tutorial, get a TikTok slideshow (and optionally a Google Gemini Omni video).

Three Claude Agent SDK agents run the job:

1. **supervisor** — routes the request, picks a model profile, handles Gmail/iMessage
2. **slideshow** — writes a 9:16 carousel and asks Daytona for screenshots
3. **video** — generates a 9:16 clip with Gemini Omni

This is **not** hardcoded to Opus. The custom model builder swaps the Anthropic API key, base URL, and model id.

Architecture and the decisions I pushed back on: [docs/architecture.md](docs/architecture.md).

## Quick start

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
uvicorn okupy.api:app --reload
```

Open `http://localhost:8000`. Paste a tutorial. Generate.

CLI:

```bash
okupy "1. Heat the pan. 2. Add eggs. 3. Fold the omelette." --title "30-second omelette"
```

## Integrations

| Piece | Role |
| --- | --- |
| Claude Agent SDK | Supervisor + 2 specialists (`OKUPY_AGENT_MODE=agent`) |
| Custom model builder | `POST /v1/models` or `OKUPY_MODEL` / `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` |
| Gemini Omni | AI video via Interactions API |
| Daytona | Sandbox screenshots after slides are done |
| Photon Spectrum | DM the agent over iMessage (Node sidecar + Render worker) |
| Composio | Gmail (and later other apps) OAuth |
| Render | `render.yaml` — web API + iMessage worker |

Direct mode (`OKUPY_AGENT_MODE=direct`) uses the same three-agent plan without calling Anthropic, so slideshows work in CI.

## Deploy

Connect the repo to Render. The Blueprint in `render.yaml` creates `okupy-api` and `okupy-imessage`. Set the `sync: false` secrets in the dashboard.
