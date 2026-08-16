const REFRESH_INTERVAL_MS = 3 * 60 * 1000; // poll every 3 minutes
const SEEN_KEY = "hackathon_tracker_seen_ids";

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

  for (const h of filtered) {
    const isNew = !seen.has(h.id);
    const card = document.createElement("a");
    card.className = "card";
    card.href = h.url || "#";
    card.target = "_blank";
    card.rel = "noopener noreferrer";

    card.innerHTML = `
      <div class="card-header">
        <div>
          <span class="badge ${h.source}">${h.source}</span>
          ${isNew ? '<span class="new-tag">NEW</span>' : ""}
        </div>
        ${h.prize ? `<span class="prize">${escapeHtml(h.prize)}</span>` : ""}
      </div>
      <p class="title">${escapeHtml(h.title || "Untitled")}</p>
      ${h.deadline ? `<p class="deadline">${escapeHtml(h.deadline)}</p>` : ""}
    `;
    listEl.appendChild(card);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
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
    subtitleEl.textContent = `${data.count} listed · updated ${updated.toLocaleTimeString()}`;

    if (isPoll && newOnes.length > 0) {
      bannerEl.hidden = false;
      bannerEl.textContent = `${newOnes.length} new hackathon${
        newOnes.length > 1 ? "s" : ""
      } just showed up — tap to mark as seen`;
      bannerEl.onclick = markAllSeen;
    }

    render();
  } catch (e) {
    loadingEl.textContent =
      "Couldn't load hackathons right now. Retrying shortly…";
    loadingEl.hidden = false;
  }
}

document.querySelectorAll(".filter-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".filter-chip").forEach((c) => c.classList.remove("active"));
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
