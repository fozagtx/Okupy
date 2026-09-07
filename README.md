# Okupy

Backend for a tutorial engine: JSON API that turns a tutorial into a TikTok slideshow and generates or **edits** Google Gemini Omni videos.

This is **not** a web app. There is no generate UI. Call the API (or the CLI). FastAPI `/docs` is OpenAPI for the backend.

Three Claude Agent SDK agents run the job:

1. **supervisor** — routes the request, picks a model profile, handles Gmail/iMessage
2. **slideshow** — writes a 9:16 carousel and asks Daytona for screenshots
3. **video** — Gemini Omni generate, drop-in clip edit, inpaint, and keyframe interpolation

This is **not** hardcoded to Opus. The custom model builder swaps the Anthropic API key, base URL, and model id.

Architecture: [docs/architecture.md](docs/architecture.md).

## Quick start

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
uvicorn okupy.api:app --reload
```

```bash
curl -s http://localhost:8000/health
curl -s -X POST http://localhost:8000/v1/generate \
  -H 'Content-Type: application/json' \
  -d '{"title":"30-second omelette","tutorial":"1. Heat the pan. 2. Add eggs. 3. Fold.","outputs":["slideshow"]}'
```

Drop a clip to edit:

```bash
curl -s -X POST http://localhost:8000/v1/videos/drop \
  -F mode=inpaint \
  -F prompt='remove the watermark' \
  -F video=@talking-head.mp4
```

Keyframe interpolation (first + last frame):

```bash
curl -s -X POST http://localhost:8000/v1/videos/drop \
  -F mode=keyframes \
  -F prompt='smooth push-in, keep lighting' \
  -F first_frame=@start.png \
  -F last_frame=@end.png
```

CLI:

```bash
okupy "1. Heat the pan. 2. Add eggs. 3. Fold the omelette." --title "30-second omelette"
okupy video inpaint "remove the logo" --clip talking-head.mp4
okupy video keyframes "sunrise to sunset" --first-frame start.png --last-frame end.png
okupy video edit "make this anime" --clip talking-head.mp4
```

## Integrations

| Piece | Role |
| --- | --- |
| Claude Agent SDK | Supervisor + 2 specialists (`OKUPY_AGENT_MODE=agent`) |
| Custom model builder | `POST /v1/models` or `OKUPY_MODEL` / `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` |
| Gemini Omni | Generate, edit, inpaint, keyframes via Interactions API |
| Daytona | Sandbox screenshots after slides are done |
| Photon Spectrum | DM the agent over iMessage (Node sidecar + Render worker) |
| Composio | Gmail (and later other apps) OAuth |
| Render | `render.yaml` — API service + iMessage worker |

Direct mode (`OKUPY_AGENT_MODE=direct`) uses the same three-agent plan without calling Anthropic, so slideshows and video *planning* work in CI.

## Deploy

Connect the repo to Render. The Blueprint in `render.yaml` creates `okupy-api` and `okupy-imessage`. Set the `sync: false` secrets in the dashboard.
