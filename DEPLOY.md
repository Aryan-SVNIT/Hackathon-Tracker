# Deploying: Netlify (frontend) + Railway (backend)

The project is now split into two independently-deployed pieces:

```
web/            → static frontend, deployed to Netlify
api.py          → FastAPI backend, deployed to Railway
Dockerfile      → tells Railway how to build the backend (Chromium baked in)
requirements.txt
netlify.toml    → tells Netlify to publish web/
```

## 1. Deploy the backend to Railway first

You need its URL before the frontend can be configured.

1. Push this repo to GitHub (Railway deploys from a repo).
2. In Railway: **New Project → Deploy from GitHub repo** → pick this repo.
3. Railway will detect the `Dockerfile` at the repo root and build from it
   automatically — you don't need to configure anything else. (If it
   defaults to Nixpacks instead, go to the service's **Settings → Build**
   and set **Builder** to **Dockerfile**.)
4. Railway sets the `$PORT` env var automatically; the `Dockerfile`
   already reads it, so no config needed there.
5. Optional but recommended: once you know your Netlify URL (step 2
   below), come back and add an env var
   `ALLOWED_ORIGIN=https://your-site.netlify.app` in Railway's
   **Variables** tab, then redeploy. This locks CORS down to just your
   frontend instead of `*`.
6. After it deploys, Railway gives you a public URL like
   `https://your-app.up.railway.app`. Confirm it works:
   ```
   curl https://your-app.up.railway.app/api/hackathons
   ```
   The first request after a cold start / cache expiry will take a few
   seconds (it's doing a live scrape, including launching headless
   Chromium for HackerEarth) — that's expected, not a bug.

## 2. Deploy the frontend to Netlify

1. In `web/index.html`, set the meta tag to your Railway URL from step 1:
   ```html
   <meta name="api-base-url" content="https://your-app.up.railway.app" />
   ```
2. Commit that change and push.
3. In Netlify: **Add new site → Import an existing project** → pick this
   repo. Netlify will read `netlify.toml` and publish the `web/` folder
   automatically — no build command needed, it's plain HTML/JS/CSS.
4. Netlify gives you a URL like `https://your-site.netlify.app`. Open it —
   it should now be fetching live data from your Railway backend.

## Notes / gotchas

- **CORS**: `api.py` allows `*` by default so this works out of the box,
  but you should set `ALLOWED_ORIGIN` on Railway (step 1.5) once you know
  your final Netlify URL, rather than leaving it wide open.
- **Cache is per-instance and in-memory**: if Railway restarts or
  redeploys your backend, the 10-minute cache resets and the next request
  pays the full scrape cost again. This is expected with the current
  in-memory-dict design — fine for a single-instance hobby deploy, but if
  you ever scale to multiple backend instances you'd want to move the
  cache to something shared (e.g. Redis) since each instance would
  otherwise scrape independently.
- **Local dev**: leave `content=""` in the meta tag to fall back to a
  same-origin `/api/hackathons` request, useful if you're testing with
  the old combined FastAPI+static setup instead of the split one.
