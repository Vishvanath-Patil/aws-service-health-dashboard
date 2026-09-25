"use strict";

/* AWS Service Health dashboard renderer.
   Reads the committed snapshot at data/health-snapshot.json (produced by the
   sync-health GitHub Action) and renders the page. Pure client-side, no build. */

const SNAPSHOT_PATH = "data/health-snapshot.json";
const STALE_MS = 2 * 60 * 60 * 1000; // warn if snapshot older than 2 h
const AUTO_REFRESH_MS = 5 * 60 * 1000; // 5 min

const STATUS = {
  labels: { 0: "Normal", 1: "Informational", 2: "Degraded", 3: "Disruption" },
};

const $ = (id) => document.getElementById(id);
const els = {
  summaryText: $("summary-text"),
  summaryStats: $("summary-stats"),
  lastUpdatedTime: $("last-updated-time"),
  dataSource: $("data-source"),
  incidents: $("incidents"),
  incidentList: $("incident-list"),
  impacted: $("impacted"),
  impactBody: $("impact-body"),
  impactEmpty: $("impact-empty"),
  serviceSearch: $("service-search"),
  regionFilter: $("region-filter"),
  allNormal: $("all-normal"),
  errorState: $("error-state"),
  errorMessage: $("error-message"),
  staleBadge: $("stale-badge"),
  refreshBtn: $("refresh-btn"),
  autoToggle: $("autorefresh-toggle"),
};

let snapshot = null;
let autoTimer = null;
let impactedRows = [];

/* ---------- Helpers ---------- */

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function timeAgo(unixSeconds, nowS) {
  const diff = Math.max(0, Math.round(nowS - unixSeconds));
  if (diff < 60) return "just now";
  const m = Math.floor(diff / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function fmtTime(unix) {
  if (!unix) return "—";
  return new Date((unix > 1e12 ? unix : unix * 1000)).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function statusClass(status) {
  const s = Number(status);
  return Number.isFinite(s) && s >= 0 && s <= 3 ? `s${s}` : "s0";
}
function chipClass(status) {
  const s = Number(status);
  return Number.isFinite(s) && s >= 0 && s <= 3 ? `c${s}` : "c0";
}

/* ---------- Snapshot loading ---------- */

async function loadSnapshot() {
  const res = await fetch(SNAPSHOT_PATH, { cache: "no-cache", headers: { "Accept": "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const data = await res.json();
  if (!Array.isArray(data.events)) throw new Error("Snapshot has an unexpected shape (no events array).");
  return data;
}

function render() {
  const now = Math.floor(Date.now() / 1000);
  const events = snapshot.events || [];
  const generated = snapshot.generated_at_unix || now;

  impactedRows = events.flatMap((ev) =>
    (ev.impacted_services || []).map((svc) => ({
      service: svc.service_name || svc.service,
      region: ev.region_name || ev.region || "—",
      status: svc.current,
      max: svc.max,
    }))
  );

  // Summary text
  if (events.length === 0) {
    els.summaryText.textContent = "All AWS services are operating normally";
  } else {
    const regions = new Set(events.map((e) => e.region_name || e.region)).size;
    els.summaryText.textContent =
      `${events.length} active incident${events.length > 1 ? "s" : ""} affecting ${regions} region${regions > 1 ? "s" : ""}`;
  }

  // Summary stats
  const regionsCount = new Set(impactedRows.map((r) => r.region)).size;
  const servicesCount = new Set(impactedRows.map((r) => r.service)).size;
  const stats = [
    { value: String(events.length), cap: "Active events", cls: events.length ? "bad" : "ok" },
    { value: String(servicesCount), cap: "Impacted services", cls: impactedRows.length ? "warn" : "ok" },
    { value: String(regionsCount), cap: "Affected regions", cls: regionsCount ? "warn" : "ok" },
  ];
  els.summaryStats.innerHTML = stats
    .map((s) => `<div class="stat"><div class="value ${s.cls}">${esc(s.value)}</div><div class="caption">${esc(s.cap)}</div></div>`)
    .join("");

  // Last updated
  els.lastUpdatedTime.textContent = fmtTime(generated);
  els.lastUpdatedTime.title = new Date(
    (generated > 1e12 ? generated : generated * 1000)
  ).toString();
  const stale = now > generated && now - generated > STALE_MS;
  els.staleBadge.classList.toggle("hidden", !stale);

  els.dataSource.textContent = snapshot.source ? `Feed: ${snapshot.source}` : "";

  // Sections
  els.allNormal.classList.toggle("hidden", events.length !== 0);
  els.incidents.classList.toggle("hidden", events.length === 0);
  els.impacted.classList.toggle("hidden", impactedRows.length === 0);

  renderIncidents(events);
  populateRegionFilter(impactedRows);
  renderImpact(impactedRows);
}

/* ---------- Incidents ---------- */

function renderIncidents(events) {
  els.incidentList.innerHTML = events
    .map((ev, i) => {
      const open = i === 0;
      const log = ev.event_log || [];
      const impactedCount = (ev.impacted_services || []).length;

      const timeline = log
        .slice()
        .reverse()
        .map(
          (m) => `<li>
            <div class="tl-marker"><span class="status-dot ${statusClass(m.status)}"></span></div>
            <div class="tl-msg">
              <div>
                <span class="tl-summary">${esc(m.summary || "Update")}</span>
                <span class="tl-time">· ${esc(timeAgo(m.timestamp_unix, Math.floor(Date.now() / 1000)))}</span>
              </div>
              <div class="tl-detail">${esc(m.message || "")}</div>
            </div>
          </li>`
        )
        .join("");

      const statusLabel = ev.status_label || STATUS.labels[ev.status] || "Unknown";
      const badgeCls = Number(ev.status) >= 0 && Number(ev.status) <= 3 ? `b${ev.status}` : "b0";

      return `<article class="incident ${open ? "open" : ""}" data-i="${i}">
        <button class="incident-header" type="button" aria-expanded="${open}">
          <span class="status-dot ${statusClass(ev.status)}"></span>
          <span class="incident-title">
            <span class="name">${esc(ev.service_name || "Unknown service")} — ${esc(ev.region_name || ev.region || "Unknown region")}</span>
            <span class="meta">${esc(ev.summary || "")} · started ${esc(timeAgo(ev.date_unix, Math.floor(Date.now() / 1000)))}</span>
          </span>
          <span class="status-badge ${badgeCls}">${esc(statusLabel)}</span>
          <span class="chevron" aria-hidden="true">▶</span>
        </button>
        <div class="incident-body ${open ? "" : "hidden"}">
          <ul class="timeline">${timeline}</ul>
          <p class="impact-summary">
            Affects <span class="count">${impactedCount}</span> service${impactedCount === 1 ? "" : "s"} in this region.
            See the table below for per-service status.
          </p>
        </div>
      </article>`;
    })
    .join("");
}

/* ---------- Impacted services table ---------- */

function populateRegionFilter(rows) {
  const regions = [...new Set(rows.map((r) => r.region))].sort();
  const keep = els.regionFilter.value;
  els.regionFilter.innerHTML =
    `<option value="">All regions</option>` +
    regions.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join("");
  if (keep && regions.includes(keep)) els.regionFilter.value = keep;
}

function filters() {
  const q = (els.serviceSearch.value || "").trim().toLowerCase();
  const region = els.regionFilter.value;
  return { q, region };
}

function filteredRows(rows) {
  const { q, region } = filters();
  return rows
    .filter((r) => !region || r.region === region)
    .filter((r) => !q || (r.service || "").toLowerCase().includes(q) || (r.region || "").toLowerCase().includes(q));
}

function renderImpact(rows) {
  const list = filteredRows(rows).sort(
    (a, b) => (Number(b.status) - Number(a.status)) || (a.service < b.service ? -1 : 1)
  );
  els.impactBody.innerHTML = list
    .map(
      (r) => `<tr>
        <td>${esc(r.service)}</td>
        <td>${esc(r.region)}</td>
        <td class="col-status"><span class="chip ${chipClass(r.status)}">${esc(STATUS.labels[r.status] ?? r.status)}</span></td>
      </tr>`
    )
    .join("");
  els.impactEmpty.classList.toggle("hidden", list.length !== 0);
}

/* ---------- Wire-up ---------- */

async function loadAndRender() {
  els.refreshBtn.disabled = true;
  els.refreshBtn.title = "Reloading…";
  try {
    snapshot = await loadSnapshot();
    els.errorState.classList.add("hidden");
    render();
  } catch (err) {
    els.errorMessage.textContent = `${err.message} — the latest snapshot may not have been published yet.`;
    els.errorState.classList.remove("hidden");
    els.allNormal.classList.add("hidden");
    els.incidents.classList.add("hidden");
    els.impacted.classList.add("hidden");
    if (!snapshot) els.summaryText.textContent = "Status data unavailable";
  } finally {
    els.refreshBtn.disabled = false;
    els.refreshBtn.title = "Re-read the latest committed health snapshot";
  }
}

els.refreshBtn.addEventListener("click", loadAndRender);
els.serviceSearch.addEventListener("input", () => {
  if (snapshot) renderImpact(impactedRows);
});
els.regionFilter.addEventListener("change", () => {
  if (snapshot) renderImpact(impactedRows);
});

// Incident card accordion
document.addEventListener("click", (e) => {
  const header = e.target.closest(".incident-header");
  if (!header) return;
  const card = header.closest(".incident");
  const open = card.classList.toggle("open");
  card.querySelector(".incident-body").classList.toggle("hidden", !open);
  header.setAttribute("aria-expanded", String(open));
});

// Auto-refresh
els.autoToggle.addEventListener("change", () => {
  if (els.autoToggle.checked && !autoTimer) {
    autoTimer = setInterval(() => loadAndRender(), AUTO_REFRESH_MS);
  } else if (!els.autoToggle.checked && autoTimer) {
    clearInterval(autoTimer);
    autoTimer = null;
  }
});
autoTimer = setInterval(() => loadAndRender(), AUTO_REFRESH_MS);

loadAndRender();
