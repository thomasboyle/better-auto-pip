const DEFAULTS = {
  enabled: true,
  collapseWidthPx: 8,
  collapseHeightPx: 80,
  debounceMs: 250,
  armMinutes: 10,
  exitOnExpand: false,
  siteEnabled: {},
  enableTabSwitch: true,
  tabSwitchDelay: 500,
  showBlockAlerts: true
};

let CFG = DEFAULTS;
let IS_VIVALDI = false;
let LAST_TAB = null;
const TIMERS = {};
const INJECTED = new Set();
const HOST_CACHE = new Map();
const HOST_CACHE_MAX = 100;
const URL_HOST_RE = /^https?:\/\/([^\/?#]+)/i;

chrome.storage.sync.get(DEFAULTS, (c) => {
  const cfg = CFG;
  for (const k in DEFAULTS) cfg[k] = k in c ? c[k] : DEFAULTS[k];
  CFG = cfg;
});
chrome.storage.onChanged.addListener((changes) => {
  const cfg = CFG;
  const defs = DEFAULTS;
  for (const k in changes) {
    if (k in defs) cfg[k] = changes[k].newValue;
  }
});

(async function initDetectVivaldi() {
  if (typeof chrome.vivaldi !== 'undefined') {
    IS_VIVALDI = true;
    return;
  }
  if (chrome.runtime?.getBrowserInfo) {
    const info = await chrome.runtime.getBrowserInfo().catch(() => null);
    if (info?.name?.toLowerCase().includes('vivaldi')) {
      IS_VIVALDI = true;
      return;
    }
  }
  try {
    const wins = await chrome.windows.getAll({ windowTypes: ['normal'] });
    if (wins.length > 0 && 'vivExtData' in wins[0]) IS_VIVALDI = true;
  } catch { }
})();

const getHost = (url) => {
  if (!url) return "";
  const cached = HOST_CACHE.get(url);
  if (cached !== undefined) return cached;
  let host = "";
  const match = url.match(URL_HOST_RE);
  if (match) {
    host = match[1];
  } else {
    try {
      host = new URL(url).host;
    } catch {
      host = "";
    }
  }
  if (HOST_CACHE.size >= HOST_CACHE_MAX) {
    const firstKey = HOST_CACHE.keys().next().value;
    HOST_CACHE.delete(firstKey);
  }
  HOST_CACHE.set(url, host);
  return host;
};

const isSiteEnabled = (url) => {
  if (!url) return false;
  const host = getHost(url);
  if (!host) return false;
  const se = CFG.siteEnabled;
  return !se || se[host] !== false;
};

async function ensureScript(tabId) {
  if (INJECTED.has(tabId)) return true;
  try {
    const r = await chrome.tabs.sendMessage(tabId, { action: "ping" }).catch(() => null);
    if (r && r.pong) {
      INJECTED.add(tabId);
      return true;
    }
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    INJECTED.add(tabId);
    return true;
  } catch {
    INJECTED.delete(tabId);
    return false;
  }
}

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const cfg = CFG;
  if (!cfg.enabled || !cfg.enableTabSwitch) return;

  const newTabId = activeInfo.tabId;
  const oldTabId = LAST_TAB;
  LAST_TAB = newTabId;

  const timer = TIMERS[newTabId];
  if (timer) {
    clearTimeout(timer);
    delete TIMERS[newTabId];
  }

  if (oldTabId && oldTabId !== newTabId) {
    try {
      const tab = await chrome.tabs.get(oldTabId);
      if (tab && tab.url && isSiteEnabled(tab.url)) {
        if (await ensureScript(oldTabId)) {
          chrome.tabs.sendMessage(oldTabId, { action: "tryPiP", reason: "tabSwitch" })
            .catch(() => INJECTED.delete(oldTabId));
        }
      }
    } catch { }
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    INJECTED.delete(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  INJECTED.delete(tabId);
  const timer = TIMERS[tabId];
  if (timer) {
    clearTimeout(timer);
    delete TIMERS[tabId];
  }
  if (LAST_TAB === tabId) LAST_TAB = null;
});

chrome.runtime.onMessage.addListener((msg, sender, sendRespond) => {
  if (msg.action === "isVivaldi") {
    if (!IS_VIVALDI) {
      sendRespond({ isVivaldi: false, isPanel: false });
      return false;
    }

    (async () => {
      try {
        const winId = sender.tab.windowId;
        const win = await chrome.windows.get(winId).catch(() => null);

        let isPanel = false;
        if (win && win.vivExtData) {
          const dataStr = typeof win.vivExtData === 'string' ? win.vivExtData : null;
          if (!dataStr || dataStr.includes("SELECTED_PANEL") || dataStr.includes("SHOW_PANEL")) {
            try {
              const data = dataStr ? JSON.parse(dataStr) : win.vivExtData;
              const webPanelActive = (data.SELECTED_PANEL && data.SELECTED_PANEL.startsWith("WEBPANEL_")) || data.SHOW_PANEL;

              if (webPanelActive) {
                let t = sender.tab;
                if (!t.width) t = await chrome.tabs.get(sender.tab.id);

                if (t.width && win.width) {
                  const ratio = t.width / win.width;
                  if (ratio < 0.7) isPanel = true;
                }
              }
            } catch { }
          }
        }
        sendRespond({ isVivaldi: true, isPanel });
      } catch {
        sendRespond({ isVivaldi: true, isPanel: false });
      }
    })();
    return true;
  }
  return false;
});
