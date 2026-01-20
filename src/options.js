const DEFAULTS = {
  enabled: true,
  collapseWidthPx: 8,
  collapseHeightPx: 80,
  debounceMs: 250,
  armMinutes: 10,
  exitOnExpand: true,
  siteSettings: {},
  tabSwitchDelay: 500,
  showBlockAlerts: true
};

const PIP_SITES = [
  "app.plex.tv",
  "teams.microsoft.com",
  "meet.google.com",
  "www.twitch.tv",
  "player.twitch.tv",
  "www.netflix.com",
  "www.espn.com",
  "www.youtube.com",
  "www.hulu.com",
  "vimeo.com",
  "www.dailymotion.com",
  "www.crunchyroll.com"
];

const $ = document.getElementById.bind(document);

let cachedIsVivaldi = null;
async function isVivaldi() {
  if (cachedIsVivaldi !== null) return cachedIsVivaldi;
  try {
    const res = await chrome.runtime.sendMessage({ action: "isVivaldi" });
    cachedIsVivaldi = !!(res && res.isVivaldi);
    return cachedIsVivaldi;
  } catch {
    cachedIsVivaldi = false;
    return false;
  }
}

function renderSites(cfg, showPanel) {
  const wrap = $("sites");
  wrap.textContent = "";

  const hosts = new Set(PIP_SITES);
  const siteSettings = cfg.siteSettings;
  if (siteSettings) {
    for (const k in siteSettings) hosts.add(k);
  }

  const hostsArr = Array.from(hosts);
  const hostsLen = hostsArr.length;
  const table = document.createElement("table");
  table.className = "site-table";

  const thead = document.createElement("thead");
  thead.innerHTML = `<tr><th>Site</th><th>Tab Switching</th>${showPanel ? '<th class="panel-column">Panel Collapse</th>' : ''}</tr>`;
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (let i = 0; i < hostsLen; i++) {
    const host = hostsArr[i];
    const s = siteSettings && siteSettings[host] || { enableTab: true, enablePanel: true };
    const row = document.createElement("tr");

    const tdSite = document.createElement("td");
    tdSite.textContent = host;
    row.appendChild(tdSite);

    const tdTab = document.createElement("td");
    const cbTab = document.createElement("input");
    cbTab.type = "checkbox";
    cbTab.dataset.h = host;
    cbTab.dataset.s = "t";
    cbTab.checked = s.enableTab !== false;
    tdTab.appendChild(cbTab);
    row.appendChild(tdTab);

    if (showPanel) {
      const tdPanel = document.createElement("td");
      tdPanel.className = "panel-column";
      const cbPanel = document.createElement("input");
      cbPanel.type = "checkbox";
      cbPanel.dataset.h = host;
      cbPanel.dataset.s = "p";
      cbPanel.checked = s.enablePanel !== false;
      tdPanel.appendChild(cbPanel);
      row.appendChild(tdPanel);
    }
    tbody.appendChild(row);
  }

  table.appendChild(tbody);
  wrap.appendChild(table);
}

async function load() {
  const cfg = await chrome.storage.sync.get(DEFAULTS);
  const isV = await isVivaldi();

  $("enabled").checked = !!cfg.enabled;
  $("collapseWidthPx").value = cfg.collapseWidthPx;
  $("collapseHeightPx").value = cfg.collapseHeightPx;
  $("debounceMs").value = cfg.debounceMs;
  $("armMinutes").value = cfg.armMinutes;
  $("exitOnExpand").checked = !!cfg.exitOnExpand;
  $("showBlockAlerts").checked = cfg.showBlockAlerts !== false;
  $("tabSwitchDelay").value = cfg.tabSwitchDelay;

  const ps = $("panelSection");
  if (ps) ps.style.display = isV ? "block" : "none";

  renderSites(cfg, isV);
}

const save = async () => {
  const cfg = {
    enabled: $("enabled").checked,
    collapseWidthPx: +$("collapseWidthPx").value,
    collapseHeightPx: +$("collapseHeightPx").value,
    debounceMs: +$("debounceMs").value,
    armMinutes: +$("armMinutes").value,
    exitOnExpand: $("exitOnExpand").checked,
    showBlockAlerts: $("showBlockAlerts").checked,
    tabSwitchDelay: +$("tabSwitchDelay").value,
    siteSettings: {}
  };

  const sitesEl = $("sites");
  const inputs = sitesEl.getElementsByTagName("input");
  const inputsLen = inputs.length;
  const siteSettings = cfg.siteSettings;

  for (let i = 0; i < inputsLen; i++) {
    const el = inputs[i];
    const h = el.dataset.h;
    if (!h) continue;
    const s = el.dataset.s;
    let siteCfg = siteSettings[h];
    if (!siteCfg) {
      siteCfg = { enableTab: true, enablePanel: true };
      siteSettings[h] = siteCfg;
    }
    if (s === "t") siteCfg.enableTab = el.checked;
    else if (s === "p") siteCfg.enablePanel = el.checked;
  }

  await chrome.storage.sync.set(cfg);

  const st = $("status");
  st.textContent = "Saved.";
  setTimeout(() => st.textContent = "", 1200);
};

let timer;
const debouncedSave = () => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(save, 500);
};

document.addEventListener("change", (e) => {
  if (e.target.tagName === "INPUT") debouncedSave();
});
document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.tagName === "INPUT" && (t.type === "number" || t.type === "text")) debouncedSave();
});

load();
