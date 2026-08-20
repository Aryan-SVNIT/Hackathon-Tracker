"""
Hackathon Tracker — API
========================
Scrapes Devpost/MLH/Unstop, caches the results in memory, and serves them
via /api/hackathons.

This is API-only: the frontend (index.html/app.js/style.css) is deployed
separately as a static site (e.g. on Netlify) and talks to this service
over the network. See DEPLOY.md for the Netlify + Railway setup.

Run locally:
    pip install -r requirements.txt
    uvicorn api:app --host 0.0.0.0 --port 8000
Then open http://localhost:8000/api/hackathons in a browser.
"""

import os
import re
import time
from datetime import datetime, timezone

import requests
from bs4 import BeautifulSoup
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Hackathon Tracker API")

# In production, set ALLOWED_ORIGIN to your Netlify site's URL
# (e.g. "https://your-site.netlify.app") instead of leaving this as "*".
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGIN", "*").split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    )
}
REQUEST_TIMEOUT = 15

# Simple in-memory cache so we don't re-scrape every site on every single
# page load from every visitor. Refreshed at most once per CACHE_SECONDS.
CACHE_SECONDS = 10 * 60  # 10 minutes
_cache = {"data": [], "fetched_at": 0}


# ---------------------------------------------------------------------------
# Scrapers
# ---------------------------------------------------------------------------

def fetch_devpost(max_pages=2):
    results = []
    for page in range(1, max_pages + 1):
        url = "https://devpost.com/api/hackathons"
        params = {"status[]": "open", "order_by": "recently-added", "page": page}
        try:
            resp = requests.get(url, params=params, headers=HEADERS, timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            print(f"[devpost] page {page} failed: {e}")
            break

        hackathons = data.get("hackathons", [])
        if not hackathons:
            break

        for h in hackathons:
            results.append({
                "source": "Devpost",
                "id": f"devpost-{h.get('id')}",
                "title": h.get("title"),
                "url": h.get("url"),
                "deadline": h.get("submission_period_dates"),
                "prize": h.get("prize_amount"),
                "themes": [t.get("name") for t in h.get("themes", [])] if h.get("themes") else [],
            })
        time.sleep(0.3)
    return results


MLH_DATE_RE = re.compile(
    r"([A-Z]{3}\s+\d{1,2}\s*-\s*(?:[A-Z]{3}\s+)?\d{1,2})"
)
MLH_TYPE_RE = re.compile(r"(In-Person|Digital|Hybrid)")


def fetch_mlh():
    # MLH moved from mlh.io to mlh.com and redesigned the site, so the old
    # div.event / h3.event-name selectors no longer match anything.
    # /events always redirects to whatever the *current* season page is,
    # so we don't have to hardcode a season year that goes stale every year.
    url = "https://www.mlh.com/events"
    results = []
    try:
        resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT, allow_redirects=True)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "lxml")

        # Each event tile is an <a> that wraps a background <img> and some
        # text containing a "MON DD - DD" date range. We key off that
        # structure (image + date pattern) instead of specific class names,
        # since those are the parts least likely to change on a redesign.
        seen_urls = set()
        for a in soup.find_all("a", href=True):
            img = a.find("img")
            if not img:
                continue
            text = a.get_text(" ", strip=True)
            date_match = MLH_DATE_RE.search(text)
            if not date_match:
                continue

            link = a["href"]
            if link.startswith("/"):
                link = "https://www.mlh.com" + link
            if link in seen_urls:
                continue
            seen_urls.add(link)

            title = None
            alt = img.get("alt", "").strip()
            if alt:
                title = re.sub(r"\s*background\s*$", "", alt, flags=re.I).strip()
            if not title:
                title = text[: date_match.start()].strip()
            if not title:
                continue

            type_match = MLH_TYPE_RE.search(text)
            location = None
            if type_match:
                location = text[date_match.end():type_match.start()].strip(" ,")

            results.append({
                "source": "MLH",
                "id": f"mlh-{link}",
                "title": title,
                "url": link,
                "deadline": date_match.group(1),
                "prize": None,
                "themes": [location] if location else [],
            })
    except Exception as e:
        print(f"[mlh] failed: {e}")
    return results


UNSTOP_DEADLINE_RE = re.compile(r"(\d+\s*days?\s*left|today|tomorrow|closed)", re.I)
UNSTOP_PRIZE_RE = re.compile(r"^\s*hackathons?\s*([\d,]+)", re.I)
UNSTOP_ID_RE = re.compile(r"-(\d+)/?$")
UNSTOP_TITLE_TRAILER_RE = re.compile(
    r"\s*\d+\s*Registered.*$", re.I
)


def fetch_unstop():
    # unstop.com/hackathons is a client-side rendered SPA: a plain requests
    # GET just gets back a "please enable JavaScript / cookies" shell with
    # no listings, which is why this always returned an empty list.
    # unstop.com/hackathons/amp is their server-rendered AMP version of the
    # same page and actually contains the hackathon cards in the HTML.
    url = "https://unstop.com/hackathons/amp"
    results = []
    try:
        resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "lxml")

        seen_urls = set()
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if "/hackathons/" not in href or href.rstrip("/") == "/hackathons":
                continue

            link = "https://unstop.com" + href if href.startswith("/") else href
            if link in seen_urls:
                continue

            text = a.get_text(" ", strip=True)
            # Card links contain "N Registered"; nav/footer links to
            # /hackathons-adjacent paths won't, so this filters them out.
            if "Registered" not in text:
                continue
            seen_urls.add(link)

            id_match = UNSTOP_ID_RE.search(href)
            uid = id_match.group(1) if id_match else link

            deadline_match = UNSTOP_DEADLINE_RE.search(text)
            deadline = deadline_match.group(1) if deadline_match else None

            prize_match = UNSTOP_PRIZE_RE.match(text)
            prize = f"₹{prize_match.group(1)}" if prize_match else None

            title = UNSTOP_PRIZE_RE.sub("", text).strip()
            title = UNSTOP_TITLE_TRAILER_RE.sub("", title).strip()
            if not title:
                title = link.rstrip("/").split("/")[-1]

            results.append({
                "source": "Unstop",
                "id": f"unstop-{uid}",
                "title": title,
                "url": link,
                "deadline": deadline,
                "prize": prize,
                "themes": [],
            })
    except Exception as e:
        print(f"[unstop] failed: {e}")
    return results


def fetch_all_live():
    results = []
    results += fetch_devpost()
    results += fetch_mlh()
    results += fetch_unstop()
    return results


def get_hackathons_cached():
    """Return cached results, refreshing if the cache is stale. This means
    the FIRST visitor after the cache expires pays the ~few-second scrape
    cost, and everyone else gets an instant cached response."""
    now = time.time()
    if now - _cache["fetched_at"] > CACHE_SECONDS or not _cache["data"]:
        _cache["data"] = fetch_all_live()
        _cache["fetched_at"] = now
    return _cache["data"], _cache["fetched_at"]


# ---------------------------------------------------------------------------
# API routes
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health():
    return {"status": "ok", "time": datetime.now(timezone.utc).isoformat()}


@app.get("/api/hackathons")
def get_hackathons():
    data, fetched_at = get_hackathons_cached()
    return {
        "count": len(data),
        "last_updated": datetime.fromtimestamp(fetched_at, tz=timezone.utc).isoformat(),
        "hackathons": data,
    }
