# Hackathon Tracker

A live board of open hackathons pulled from **Devpost**, **MLH** and **Unstop** — one place to scan deadlines instead of checking four sites.

**Live:** (https://hackatrack.netlify.app)

## Features

- Aggregates open hackathons from four platforms in a single feed
- Auto-refreshes every 3 minutes and on tab focus, no manual reload needed
- Flags newly-listed events and lets you mark them as seen
- Filter by source (Devpost / MLH / Unstop / HackerEarth)
- Server-side caching (10 min) so the scrapers don't run on every page load

## Tech stack

| Layer     | Stack                                                              |
|-----------|---------------------------------------------------------------------|
| Frontend  | Vanilla HTML / CSS / JS — static site on **Netlify**                |
| Backend   | **FastAPI** on **Railway** (Docker), scraping with `requests` + `BeautifulSoup`, and **Playwright** (headless Chromium) for JS-rendered sources |

The frontend and backend deploy and scale independently — the frontend is just static files, the backend is a small API service.

## Project structure

```
.
├── web/                # Static frontend — deployed to Netlify
│   ├── index.html
│   ├── app.js
│   └── style.css
├── api.py              # FastAPI backend — deployed to Railway
├── Dockerfile           # Backend build (includes Chromium for Playwright)
├── requirements.txt
├── netlify.toml         # Tells Netlify to publish web/
├── .dockerignore
└── DEPLOY.md            # Full step-by-step deploy guide
```

## Local development

**Backend**

```bash
pip install -r requirements.txt
playwright install --with-deps chromium   # one-time, needed for the HackerEarth scraper
uvicorn api:app --host 0.0.0.0 --port 8000
```

Confirm it's serving data:

```bash
curl http://localhost:8000/api/hackathons
```

**Frontend**

Open `web/index.html` directly in a browser, or serve it with any static file server. Leave the `api-base-url` meta tag in `web/index.html` blank to have it call the local backend at `/api/hackathons`; set it to a full URL to point at a deployed backend instead.

## Deployment

Frontend (Netlify) and backend (Railway) deploy separately. See [`DEPLOY.md`](./DEPLOY.md) for the full walkthrough, including environment variables and CORS setup.

## API

### `GET /api/hackathons`

Returns the current cached list.

```json
{
  "count": 95,
  "last_updated": "2026-08-16T12:09:49.506721+00:00",
  "hackathons": [
    {
      "source": "Devpost",
      "id": "devpost-30875",
      "title": "STEMinate Wildcard Hack",
      "url": "https://steminate-wildcard-hack.devpost.com",
      "deadline": "Aug 20 - 22",
      "prize": "$15,000",
      "themes": ["Hardware"]
    }
  ]
}
```

### `GET /api/health`

Basic liveness check, returns `{"status": "ok", "time": "..."}`.

## Notes

- The cache is per-instance and in-memory — a backend restart or redeploy resets it, and the next request pays the full scrape cost again. Fine for a single-instance deploy; move to something shared (e.g. Redis) if you scale to multiple backend instances.
- HackerEarth's listing page is client-rendered with no public API, so that scraper uses headless Chromium via Playwright instead of a plain HTTP request — it's the reason the Docker image is larger and the first cold-start request is slower.

## License

MIT (or update this to match your actual license).
