const DEFAULTS = {
  enabled: true,
  collapseWidthPx: 8,
  collapseHeightPx: 80,
  debounceMs: 250,
  armMinutes: 10,
  exitOnExpand: true,
  siteSettings: {}, // Stores {enableTab, enablePanel} per site
  tabSwitchDelay: 500
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

function $(id) { return document.getElementById(id); }

async function isVivaldi() {
  // Ask the background script for Vivaldi detection status
  try {
    const response = await chrome.runtime.sendMessage({ action: "isVivaldi" });
    return response?.isVivaldi || false;
  } catch (e) {
    console.error("Error detecting Vivaldi:", e);
    return false;
  }
}

function renderSites(cfg, showPanelColumn) {
  const wrap = $("sites");
  wrap.innerHTML = "";

  const hosts = new Set([...PIP_SITES, ...Object.keys(cfg.siteSettings || {})]);

  // Create table header
  const table = document.createElement("table");
  table.className = "site-table";
  const thead = document.createElement("thead");

  let headerHTML = `
    <tr>
      <th>Site</th>
      <th>Tab Switching</th>`;

  if (showPanelColumn) {
    headerHTML += `<th class="panel-column">Panel Collapse</th>`;
  }

  headerHTML += `</tr>`;
  thead.innerHTML = headerHTML;
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  for (const host of hosts) {
    const settings = (cfg.siteSettings && cfg.siteSettings[host]) || { enableTab: true, enablePanel: true };

    const row = document.createElement("tr");

    // Site name
    const tdSite = document.createElement("td");
    tdSite.textContent = host;
    row.appendChild(tdSite);

    // Tab switching checkbox
    const tdTab = document.createElement("td");
    const cbTab = document.createElement("input");
    cbTab.type = "checkbox";
    cbTab.dataset.host = host;
    cbTab.dataset.setting = "tab";
    cbTab.checked = settings.enableTab !== false;
    tdTab.appendChild(cbTab);
    row.appendChild(tdTab);

    // Panel collapse checkbox (only if Vivaldi)
    if (showPanelColumn) {
      const tdPanel = document.createElement("td");
      tdPanel.className = "panel-column";
      const cbPanel = document.createElement("input");
      cbPanel.type = "checkbox";
      cbPanel.dataset.host = host;
      cbPanel.dataset.setting = "panel";
      cbPanel.checked = settings.enablePanel !== false;
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

  $("enabled").checked = !!cfg.enabled;
  $("collapseWidthPx").value = cfg.collapseWidthPx;
  $("collapseHeightPx").value = cfg.collapseHeightPx;
  $("debounceMs").value = cfg.debounceMs;
  $("armMinutes").value = cfg.armMinutes;
  $("exitOnExpand").checked = !!cfg.exitOnExpand;
  $("tabSwitchDelay").value = cfg.tabSwitchDelay;

  // Detect Vivaldi and hide/show panel options accordingly
  const vivaldiDetected = await isVivaldi();
  const panelSection = $("panelSection");
  if (panelSection) {
    panelSection.style.display = vivaldiDetected ? "block" : "none";
  }

  renderSites(cfg, vivaldiDetected);
}

async function save() {
  const cfg = {
    enabled: $("enabled").checked,
    collapseWidthPx: Number($("collapseWidthPx").value),
    collapseHeightPx: Number($("collapseHeightPx").value),
    debounceMs: Number($("debounceMs").value),
    armMinutes: Number($("armMinutes").value),
    exitOnExpand: $("exitOnExpand").checked,
    tabSwitchDelay: Number($("tabSwitchDelay").value),
    siteSettings: {}
  };

  // Collect per-site settings
  const hosts = new Set();
  for (const input of document.querySelectorAll("input[data-host]")) {
    hosts.add(input.dataset.host);
  }

  for (const host of hosts) {
    const tabCheckbox = document.querySelector(`input[data-host="${host}"][data-setting="tab"]`);
    const panelCheckbox = document.querySelector(`input[data-host="${host}"][data-setting="panel"]`);

    cfg.siteSettings[host] = {
      enableTab: tabCheckbox ? tabCheckbox.checked : true,
      enablePanel: panelCheckbox ? panelCheckbox.checked : true
    };
  }

  await chrome.storage.sync.set(cfg);

  $("status").textContent = "Saved.";
  setTimeout(() => ($("status").textContent = ""), 1200);
}

$("save").addEventListener("click", save);
load();
