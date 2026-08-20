const REFRESH_INTERVAL_MS = 3 * 60 * 1000; // poll every 3 minutes
const SEEN_KEY = "hackathon_tracker_seen_ids";
const SOURCE_CODES = { Devpost: "DEV", MLH: "MLH", Unstop: "UNS" };
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
let activeSort = "deadline"; // deadline | prize | name

const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const loadingEl = document.getElementById("loading");
const subtitleEl = document.getElementById("subtitle");
const bannerEl = document.getElementById("banner");
const clockEl = document.getElementById("clock");
const sortSelectEl = document.getElementById("sort-select");
const modalOverlayEl = document.getElementById("modal-overlay");
const modalCloseEl = document.getElementById("modal-close");
const modalSourceCodeEl = document.getElementById("modal-source-code");
const modalTitleEl = document.getElementById("modal-title");
const modalDeadlineEl = document.getElementById("modal-deadline");
const modalPrizeEl = document.getElementById("modal-prize");
const modalThemesRowEl = document.getElementById("modal-themes-row");
const modalThemesEl = document.getElementById("modal-themes");
const modalSourceEl = document.getElementById("modal-source");
const modalLinkEl = document.getElementById("modal-link");

// ---------------------------------------------------------------------
// Live clock — the board's signature "it's alive" element.
// Shown in IST (Asia/Kolkata, UTC+5:30) regardless of the visitor's
// local timezone, using Intl so we don't have to hand-roll the +5:30
// offset (and it stays correct even though IST has no DST).
// ---------------------------------------------------------------------
const IST_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function tickClock() {
  clockEl.textContent = `${IST_TIME_FORMATTER.format(new Date())} IST`;
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

// ---------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------
// Deadlines arrive as free-form strings from four different sources
// ("3 days left", "today", "AUG 22 - 24", "Sep 15, 2026", etc.), so
// there's no single Date field to sort on directly. deadlineRank()
// turns each style into a comparable "days from now" number — lower
// is more urgent — so real chronological/urgency order works across
// all sources at once. Anything unparseable sorts to the very end.
const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function deadlineRank(text) {
  if (!text) return Infinity;
  const t = text.trim().toLowerCase();

  if (/^closed$/.test(t)) return Infinity - 1; // still shown, but last
  if (/^today$/.test(t)) return 0;
  if (/^tomorrow$/.test(t)) return 1;

  const daysLeft = t.match(/^(\d+)\s*days?\s*left$/);
  if (daysLeft) return parseInt(daysLeft[1], 10);

  // "AUG 22 - 24" / "AUG 22 - SEP 3" style ranges (MLH) — rank by the
  // start date. Assume the current year, rolling to next year if the
  // date has already passed this year (handles Dec→Jan boards).
  const range = t.match(/^([a-z]{3})\s+(\d{1,2})\s*-/);
  if (range && MONTHS[range[1]] !== undefined) {
    const now = new Date();
    let year = now.getFullYear();
    let d = new Date(year, MONTHS[range[1]], parseInt(range[2], 10));
    if (d < now) d = new Date(year + 1, MONTHS[range[1]], parseInt(range[2], 10));
    return (d.getTime() - now.getTime()) / 86400000;
  }

  // A plain parseable date string (e.g. "Sep 15, 2026").
  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) {
    return (parsed - Date.now()) / 86400000;
  }

  return Infinity; // unknown/TBD — push to the end
}

function prizeValue(text) {
  if (!text) return -1;
  const digits = text.replace(/[^\d]/g, "");
  return digits ? parseInt(digits, 10) : -1;
}

const SORTERS = {
  deadline: (a, b) => deadlineRank(a.deadline) - deadlineRank(b.deadline),
  prize: (a, b) => prizeValue(b.prize) - prizeValue(a.prize),
  name: (a, b) => (a.title || "").localeCompare(b.title || ""),
};

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

// ---------------------------------------------------------------------
// Details modal
// ---------------------------------------------------------------------
let lastFocusedEl = null;

function openModal(h) {
  const deadlineText = h.deadline || "TBD";
  const isUrgent = URGENT_RE.test(deadlineText);
  const code = SOURCE_CODES[h.source] || h.source?.slice(0, 3).toUpperCase();
  const themes = Array.isArray(h.themes) ? h.themes.filter(Boolean) : [];

  modalSourceCodeEl.textContent = code || "—";
  modalSourceCodeEl.className = `modal-source-code code ${h.source || ""}`;
  modalTitleEl.textContent = h.title || "Untitled";

  modalDeadlineEl.textContent = deadlineText;
  modalDeadlineEl.className = isUrgent ? "urgent" : "";

  modalPrizeEl.textContent = h.prize || "Not specified";
  modalSourceEl.textContent = h.source || "Unknown";

  if (themes.length) {
    modalThemesEl.textContent = themes.join(", ");
    modalThemesRowEl.hidden = false;
  } else {
    modalThemesRowEl.hidden = true;
  }

  if (h.url) {
    modalLinkEl.href = h.url;
    modalLinkEl.hidden = false;
  } else {
    modalLinkEl.hidden = true;
  }

  lastFocusedEl = document.activeElement;
  modalOverlayEl.hidden = false;
  document.body.style.overflow = "hidden";
  modalCloseEl.focus();
}

function closeModal() {
  modalOverlayEl.hidden = true;
  document.body.style.overflow = "";
  if (lastFocusedEl && typeof lastFocusedEl.focus === "function") {
    lastFocusedEl.focus();
  }
}

modalCloseEl.addEventListener("click", closeModal);
modalOverlayEl.addEventListener("click", (e) => {
  if (e.target === modalOverlayEl) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modalOverlayEl.hidden) closeModal();
});

function render() {
  const seen = getSeenIds();
  const filtered = (
    activeFilter === "all"
      ? allHackathons
      : allHackathons.filter((h) => h.source === activeFilter)
  )
    .slice()
    .sort(SORTERS[activeSort] || SORTERS.deadline);

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

    const row = document.createElement("div");
    row.className = "row";
    row.setAttribute("role", "button");
    row.tabIndex = 0;
    row.setAttribute("aria-haspopup", "dialog");
    row.style.animationDelay = `${Math.min(index, 14) * 35}ms`;

    const openThisModal = () => openModal(h);
    row.addEventListener("click", openThisModal);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openThisModal();
      }
    });

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

sortSelectEl?.addEventListener("change", () => {
  activeSort = sortSelectEl.value;
  render();
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
