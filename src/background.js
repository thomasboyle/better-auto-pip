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
  tabTimers: {},
  isVivaldi: false
};

const log = (...args) => console.debug("[BetterAutoPiP Background]", ...args);

// Detect if running in Vivaldi browser
async function detectVivaldi() {
  try {
    // Method 1: Check for Vivaldi API (most reliable)
    const hasVivaldiAPI = typeof chrome.vivaldi !== 'undefined';
    if (hasVivaldiAPI) {
      state.isVivaldi = true;
      log(`Vivaldi detected: ${state.isVivaldi}`);
      return;
    }

    // Method 2: Check for Vivaldi-specific runtime info
    if (chrome.runtime && chrome.runtime.getBrowserInfo) {
      const browserInfo = await chrome.runtime.getBrowserInfo();
      if (browserInfo.name && browserInfo.name.toLowerCase().includes('vivaldi')) {
        state.isVivaldi = true;
        log(`Vivaldi detected: ${state.isVivaldi}`);
        return;
      }
    }

    // Method 3: Check for vivExtData in windows (not splitViewId as Chrome may have it)
    const windows = await chrome.windows.getAll();
    if (windows.length > 0 && 'vivExtData' in windows[0]) {
      state.isVivaldi = true;
    }

    log(`Vivaldi detected: ${state.isVivaldi}`);
  } catch (e) {
    log("Error detecting Vivaldi:", e);
    state.isVivaldi = false;
  }
}

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
  if (message.action === "pipEntered") {
    log("PiP entered in tab", sender.tab?.id);
  } else if (message.action === "pipExited") {
    log("PiP exited in tab", sender.tab?.id);
  } else if (message.action === "isVivaldi") {
    // Content script asking if we're running in Vivaldi and if it's in a panel
    const tabId = sender.tab?.id;

    // Function to handle the Vivaldi detection request
    const handleRequest = async () => {
      // Re-detect if not yet detected (in case content script loads before background finishes init)
      if (!state.isVivaldi) {
        log("Re-running Vivaldi detection for content script request...");
        await detectVivaldi();
      }

      if (tabId && state.isVivaldi) {
        try {
          const [tab, window] = await Promise.all([
            chrome.tabs.get(tabId),
            chrome.windows.get(sender.tab.windowId)
          ]);

          // Vivaldi panel detection
          // Strategy: A web panel is active when SELECTED_PANEL starts with "WEBPANEL_"
          // To identify which tab IS the panel (vs regular tabs), check if the tab
          // occupies significantly less width than the window (< 70%)
          let isPanel = false;

          // Parse vivExtData if it's a string (Vivaldi returns it as JSON string)
          let vivExtDataObj = null;
          if (window.vivExtData) {
            if (typeof window.vivExtData === 'string') {
              try {
                vivExtDataObj = JSON.parse(window.vivExtData);
              } catch (e) {
                log(`Failed to parse vivExtData: ${e.message}`);
              }
            } else if (typeof window.vivExtData === 'object') {
              vivExtDataObj = window.vivExtData;
            }
          }

          // Check if a web panel is currently selected
          let webPanelActive = false;
          if (vivExtDataObj && vivExtDataObj.SELECTED_PANEL) {
            webPanelActive = vivExtDataObj.SELECTED_PANEL.startsWith("WEBPANEL_");
          } else if (vivExtDataObj && vivExtDataObj.SHOW_PANEL === true) {
            webPanelActive = true;
          }

          // If a web panel is active, determine if THIS tab is the panel tab
          // by checking if it's narrower than typical tabs (< 70% of window width)
          if (webPanelActive) {
            const tabWidth = tab.width || 0;
            const windowWidth = window.width || 0;
            const widthRatio = windowWidth > 0 ? (tabWidth / windowWidth) : 1;

            if (widthRatio < 0.70) {
              isPanel = true;
            }
          }

          log(`Tab ${tabId}: isPanel=${isPanel}`)

          sendResponse({ isVivaldi: state.isVivaldi, isPanel: isPanel });
        } catch (err) {
          log(`Error detecting panel: ${err}`);
          sendResponse({ isVivaldi: state.isVivaldi, isPanel: false });
        }
      } else {
        log(`Content script requesting Vivaldi status, responding with isVivaldi: ${state.isVivaldi}, isPanel: false`);
        sendResponse({ isVivaldi: state.isVivaldi, isPanel: false });
      }
    };

    handleRequest();
    return true; // Keep message channel open for async response
  }

  return false;
});

// Listen for tab events
chrome.tabs.onActivated.addListener(onTabActivated);
chrome.tabs.onUpdated.addListener(onTabUpdated);

// Initialize
detectVivaldi();
log("Background service worker initialized");
