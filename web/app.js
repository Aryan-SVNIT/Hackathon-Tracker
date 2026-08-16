const REFRESH_INTERVAL_MS = 3 * 60 * 1000; // poll every 3 minutes
const SEEN_KEY = "hackathon_tracker_seen_ids";
const SOURCE_CODES = { Devpost: "DEV", MLH: "MLH", Unstop: "UNS", HackerEarth: "HKE" };
const URGENT_RE = /\b([0-3])\s*days?\s*left\b|\btoday\b|\btomorrow\b/i;

// Backend base URL comes from the <meta name="api-base-url"> tag in
// index.html — set it to your Railway URL once you've deployed the
// backend. Falls back to same-origin (e.g. for local dev against a
// combined server) if left blank.
const API_BASE_URL = (
  document.querySelector('meta[name="api-base-url"]')?.content || ""
).replace(/\/$/, "");
const HACKATHONS_ENDPOINT = `${API_BASE_URL}/api/hackathons`;

let allHackathons = [];
let activeFilter = "all";

const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const loadingEl = document.getElementById("loading");
const subtitleEl = document.getElementById("subtitle");
const bannerEl = document.getElementById("banner");
const clockEl = document.getElementById("clock");

// ---------------------------------------------------------------------
// Live clock — the board's signature "it's alive" element.
// ---------------------------------------------------------------------
function tickClock() {
  const now = new Date();
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mm = String(now.getUTCMinutes()).padStart(2, "0");
  const ss = String(now.getUTCSeconds()).padStart(2, "0");
  clockEl.textContent = `${hh}:${mm}:${ss} UTC`;
}
tickClock();
setInterval(tickClock, 1000);

function getSeenIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function saveSeenIds(ids) {
  localStorage.setItem(SEEN_KEY, JSON.stringify([...ids]));
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function relativeTime(date) {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

function buildNewFlap() {
  const wrap = document.createElement("span");
  wrap.className = "new-flap";
  "NEW".split("").forEach((ch, i) => {
    const s = document.createElement("span");
    s.textContent = ch;
    s.style.animationDelay = `${i * 60}ms`;
    wrap.appendChild(s);
  });
  return wrap;
}

function render() {
  const seen = getSeenIds();
  const filtered =
    activeFilter === "all"
      ? allHackathons
      : allHackathons.filter((h) => h.source === activeFilter);

  listEl.innerHTML = "";

  if (filtered.length === 0) {
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  filtered.forEach((h, index) => {
    const isNew = !seen.has(h.id);
    const deadlineText = h.deadline || "TBD";
    const isUrgent = URGENT_RE.test(deadlineText);
    const code = SOURCE_CODES[h.source] || h.source?.slice(0, 3).toUpperCase();
    const theme = Array.isArray(h.themes) && h.themes.length ? h.themes[0] : null;

    const row = document.createElement("a");
    row.className = "row";
    row.href = h.url || "#";
    row.target = "_blank";
    row.rel = "noopener noreferrer";
    row.style.animationDelay = `${Math.min(index, 14) * 35}ms`;

    const deadlineEl = document.createElement("span");
    deadlineEl.className = "row-deadline" + (isUrgent ? " urgent" : "");
    deadlineEl.textContent = deadlineText;

    const mainEl = document.createElement("span");
    mainEl.className = "row-main";
    const titleEl = document.createElement("span");
    titleEl.className = "row-title";
    titleEl.textContent = h.title || "Untitled";
    mainEl.appendChild(titleEl);
    if (isNew || theme) {
      const metaLine = document.createElement("span");
      metaLine.className = "row-theme";
      metaLine.style.display = "flex";
      metaLine.style.alignItems = "center";
      metaLine.style.gap = "4px";
      if (isNew) metaLine.appendChild(buildNewFlap());
      if (theme) {
        const themeText = document.createElement("span");
        themeText.textContent = escapeHtml(theme);
        metaLine.appendChild(themeText);
      }
      mainEl.appendChild(metaLine);
    }

    const sourceEl = document.createElement("span");
    sourceEl.className = "row-source";
    const codeEl = document.createElement("span");
    codeEl.className = `code ${h.source}`;
    codeEl.textContent = code;
    sourceEl.appendChild(codeEl);

    const prizeEl = document.createElement("span");
    prizeEl.className = "row-prize";
    prizeEl.textContent = h.prize ? h.prize : "—";

    row.appendChild(deadlineEl);
    row.appendChild(mainEl);
    row.appendChild(sourceEl);
    row.appendChild(prizeEl);

    listEl.appendChild(row);
  });
}

function markAllSeen() {
  const seen = getSeenIds();
  for (const h of allHackathons) seen.add(h.id);
  saveSeenIds(seen);
  bannerEl.hidden = true;
  render();
}

async function loadHackathons({ isPoll = false } = {}) {
  try {
    const res = await fetch(HACKATHONS_ENDPOINT);
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    const data = await res.json();

    const seen = getSeenIds();
    const newOnes = data.hackathons.filter((h) => !seen.has(h.id));

    allHackathons = data.hackathons;
    loadingEl.hidden = true;

    const updated = new Date(data.last_updated);
    subtitleEl.textContent = `${data.count} EVENTS TRACKED · UPDATED ${relativeTime(updated).toUpperCase()}`;

    if (isPoll && newOnes.length > 0) {
      bannerEl.hidden = false;
      bannerEl.textContent = `${newOnes.length} NEW EVENT${
        newOnes.length > 1 ? "S" : ""
      } JUST LANDED — TAP TO CLEAR`;
      bannerEl.onclick = markAllSeen;
    }

    render();
  } catch (e) {
    loadingEl.textContent = "FEED SIGNAL LOST. RETRYING\u2026";
    loadingEl.hidden = false;
  }
}

document.querySelectorAll(".gate").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".gate").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    activeFilter = chip.dataset.source;
    render();
  });
});

// Initial load, then poll on an interval so the page updates itself
// without the visitor needing to refresh.
loadHackathons();
setInterval(() => loadHackathons({ isPoll: true }), REFRESH_INTERVAL_MS);

// Also refresh whenever the tab becomes visible again (covers people who
// leave it open in a background tab for hours).
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    loadHackathons({ isPoll: true });
  }
});
