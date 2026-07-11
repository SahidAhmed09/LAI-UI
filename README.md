# LAI-UI — Frontend for the LAI Legal AI Platform

React + Vite + TypeScript frontend for the German wind-energy legal-DD
assistant. Was extracted from the [LAI](https://github.com/Ravijangid820/LAI)
monorepo at backend tag `v1.0.0-pre-split`. History before that lives
in the backend repo.

## Pairs against

| Service | Port | What it serves |
|---|---|---|
| `serve_rag.py` (FastAPI in [LAI](https://github.com/Ravijangid820/LAI)) | 18000 | Conversational RAG + V2 contract analyzer |
| `lai-backend` (FastAPI in `LAI/micro-services/`) | 18001 | DDiQ pipeline (`/ddiq/*`) — multi-doc cadastral / due-diligence reports |

Configure URLs via `.env`:

```bash
VITE_BACKEND_URL=http://localhost:18000
VITE_DDIQ_URL=http://localhost:18001
```

For VPN-trusted access, swap `localhost` for the server's LAN IP.

## Develop

```bash
npm install
npm run dev
# → http://localhost:5173
```

## Deploy

`vercel.json` and `wrangler.json` are checked in for Vercel and
Cloudflare-Workers deploys; pick whichever target you want. Cloudflare
config lives in `src/worker/`.

## Where things are

| Path | Purpose |
|---|---|
| `src/react-app/pages/` | Page-level components — Dashboard, Chat, Documents, Risk, Projects, Settings |
| `src/react-app/components/` | Shared components — DashboardLayout, ProjectLocationMap (react-leaflet), ChatInput, ReportDownloadPanel |
| `src/react-app/lib/ragApi.ts` | Client for the conversational backend (`serve_rag`) |
| `src/react-app/lib/ddiqApi.ts` | Client for the DDiQ microservice |
| `src/worker/` | Cloudflare Worker entrypoint (optional deploy path) |

Anything backend-related — Python, Docker, ALKIS WFS adapters, the
analyzer pipeline, persistence — lives in the backend repo.
