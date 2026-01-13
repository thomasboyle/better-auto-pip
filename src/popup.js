// Popup script for Better Auto PiP
const $ = (id) => document.getElementById(id);

// Default configuration
const DEFAULT_CONFIG = {
  enabled: true,
  debounce: 250,
  enableTabSwitch: true,
  tabSwitchDelay: 500,
  enablePanelCollapse: true,
  collapseWidthThreshold: 8,
  collapseHeightThreshold: 80,
  armDuration: 10,
  exitOnExpand: true,
  siteSettings: {}
};

// Load current config and update UI
async function loadConfig() {
  const result = await chrome.storage.sync.get(DEFAULT_CONFIG);
  const cfg = { ...DEFAULT_CONFIG, ...result };

  updateUI(cfg.enabled);
}

// Update UI based on enabled state
function updateUI(enabled) {
  const toggleSwitch = $('toggleSwitch');
  const status = $('status');

  if (enabled) {
    toggleSwitch.classList.add('enabled');
    status.textContent = 'Enabled';
    status.style.color = '#1a73e8';
  } else {
    toggleSwitch.classList.remove('enabled');
    status.textContent = 'Disabled';
    status.style.color = '#5f6368';
  }
}

// Toggle enabled state
async function toggleEnabled() {
  const result = await chrome.storage.sync.get(DEFAULT_CONFIG);
  const cfg = { ...DEFAULT_CONFIG, ...result };

  const newEnabled = !cfg.enabled;

  await chrome.storage.sync.set({ enabled: newEnabled });

  updateUI(newEnabled);

  // Show brief feedback
  const status = $('status');
  const originalText = status.textContent;
  status.textContent = newEnabled ? 'Enabled ✓' : 'Disabled ✓';
  setTimeout(() => {
    status.textContent = originalText;
  }, 1000);
}

// Open options page
function openOptions() {
  chrome.runtime.openOptionsPage();
  window.close();
}

// Event listeners
$('toggleContainer').addEventListener('click', toggleEnabled);
$('optionsButton').addEventListener('click', openOptions);

// Initialize
loadConfig();
