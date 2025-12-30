// Background service worker for tab switching and panel detection
const DEFAULTS = {
  enabled: true,
  collapseWidthPx: 8,
  collapseHeightPx: 80,
  debounceMs: 250,
  armMinutes: 10,
  exitOnExpand: false,
  siteEnabled: {},
  enableTabSwitch: true, // New: trigger PiP on tab switch
  tabSwitchDelay: 500 // Delay before triggering PiP on tab switch
};

const state = {
  lastActiveTab: null,
  tabTimers: {}
};

const log = (...args) => console.debug("[BetterAutoPiP Background]", ...args);

// Load configuration
async function loadConfig() {
  const cfg = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...cfg };
}

// Check if site is enabled
function isSiteEnabled(cfg, url) {
  if (!url) return false;
  try {
    const host = new URL(url).host;
    if (host && host in cfg.siteEnabled) return !!cfg.siteEnabled[host];
    return true;
  } catch {
    return false;
  }
}

// Handle tab activation (switching tabs)
async function onTabActivated(activeInfo) {
  const cfg = await loadConfig();
  if (!cfg.enabled || !cfg.enableTabSwitch) return;

  const tabId = activeInfo.tabId;

  // Clear any existing timer for this tab
  if (state.tabTimers[tabId]) {
    clearTimeout(state.tabTimers[tabId]);
  }

  // If we had a previous active tab, notify it to potentially enter PiP
  if (state.lastActiveTab && state.lastActiveTab !== tabId) {
    try {
      const tab = await chrome.tabs.get(state.lastActiveTab);
      if (tab && tab.url && isSiteEnabled(cfg, tab.url)) {
        // Send message to the old tab to try entering PiP
        chrome.tabs.sendMessage(state.lastActiveTab, {
          action: "tryPiP",
          reason: "tabSwitch"
        }).catch(() => {
          // Tab might not have content script loaded
          log("Could not send message to tab", state.lastActiveTab);
        });
      }
    } catch (e) {
      // Tab might have been closed
      log("Error accessing previous tab:", e);
    }
  }

  state.lastActiveTab = tabId;
}

// Handle tab updates (URL changes, loading states)
async function onTabUpdated(tabId, changeInfo, tab) {
  const cfg = await loadConfig();
  if (!cfg.enabled) return;

  // If the tab finished loading and it's a supported site
  if (changeInfo.status === "complete" && tab.url) {
    if (isSiteEnabled(cfg, tab.url)) {
      // Inject content script if needed (for dynamically loaded sites)
      log("Tab loaded:", tab.url);
    }
  }
}

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  log("Message received:", message);

  if (message.action === "pipEntered") {
    log("PiP entered in tab", sender.tab?.id);
  } else if (message.action === "pipExited") {
    log("PiP exited in tab", sender.tab?.id);
  }

  return false;
});

// Listen for tab events
chrome.tabs.onActivated.addListener(onTabActivated);
chrome.tabs.onUpdated.addListener(onTabUpdated);

// Initialize
log("Background service worker initialized");
