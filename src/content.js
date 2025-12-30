(() => {
  const DEFAULTS = {
    enabled: true,
    // Only trigger when the visible viewport is very small (collapse)
    collapseWidthPx: 8,
    collapseHeightPx: 80, // mostly to ignore weird layouts where width stays >0 but height collapses
    debounceMs: 250,
    // If PiP fails due to gesture requirements, user can "arm" for this many minutes
    armMinutes: 10,
    // Exit PiP when expanded again (default: true)
    exitOnExpand: true,
    // Per-site settings: {enableTab, enablePanel} per host
    siteSettings: {},
    // Tab switch delay
    tabSwitchDelay: 500
  };

  const state = {
    armedUntil: 0,
    lastCollapsed: false,
    lastAttemptTs: 0,
    debounceTimer: null,
    toastEl: null,
    bannerEl: null,
    isInPiP: false,
    lastVisibilityState: document.visibilityState,
    lastViewportKey: null,
    tabSwitchFailCount: 0,
    lastUserInteraction: 0
  };

  // Check if extension context is still valid
  function isExtensionValid() {
    try {
      return !!(chrome?.runtime?.id);
    } catch {
      return false;
    }
  }

  // Check if running in Vivaldi browser
  function isVivaldi() {
    // Check for Vivaldi-specific properties
    // Vivaldi exposes window.vivaldi object
    return !!(window.vivaldi) || navigator.userAgent.includes("Vivaldi");
  }

  const log = (...args) => {
    if (!isExtensionValid()) return; // Don't log if extension was reloaded
    console.log("[BetterAutoPiP]", ...args);
  };

  function hostKey() {
    try { return location.host; } catch { return ""; }
  }

  function now() {
    return Date.now();
  }

  function isArmed() {
    return now() < state.armedUntil;
  }

  function arm(minutes) {
    state.armedUntil = now() + minutes * 60 * 1000;
    state.tabSwitchFailCount = 0; // Reset fail count when armed
    log(`Extension armed for ${minutes} minutes`);
  }

  function getViewportSize() {
    // visualViewport is best for these “UI resized” scenarios
    const vv = window.visualViewport;
    const w = vv?.width ?? window.innerWidth ?? document.documentElement.clientWidth ?? 0;
    const h = vv?.height ?? window.innerHeight ?? document.documentElement.clientHeight ?? 0;
    return { w: Math.round(w), h: Math.round(h) };
  }

  function isVivaldiPanel() {
    // Panel features only work in Vivaldi
    if (!isVivaldi()) {
      return false;
    }

    // Vivaldi web panels inject specific markers or have unique window properties
    // Check if we're in a Vivaldi panel context
    try {
      // Check if viewport is very narrow (typical of panel)
      const { w } = getViewportSize();
      // Panels typically start around 300-400px but can be resized
      // We'll use viewport width as a heuristic along with other factors
      return w > 0 && w < 600; // Likely a panel if narrower than typical browser window
    } catch {
      return false;
    }
  }

  function isCollapsed(cfg) {
    const { w, h } = getViewportSize();
    // Panel collapse in Vivaldi usually drives width extremely low; height may remain
    // The collapsed state is when the panel is minimized/hidden
    const widthCollapsed = w > 0 && w <= cfg.collapseWidthPx;
    const heightCollapsed = h > 0 && h <= cfg.collapseHeightPx;

    // Log for debugging Vivaldi panel behavior
    if (widthCollapsed || heightCollapsed) {
      log(`Detected collapse: w=${w}, h=${h}, inPanel=${isVivaldiPanel()}, widthThreshold=${cfg.collapseWidthPx}, heightThreshold=${cfg.collapseHeightPx}`);
    }

    return widthCollapsed || heightCollapsed;
  }

  function visibleAreaScore(video) {
    // choose the best candidate: largest displayed, currently playing, with valid dims
    const rect = video.getBoundingClientRect();
    const area = Math.max(0, rect.width) * Math.max(0, rect.height);
    // If it’s offscreen or basically invisible, penalize
    const onScreen = rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
    return area * (onScreen ? 1 : 0.2);
  }

  function getAllVideos() {
    // Collect videos from main document
    let videos = Array.from(document.querySelectorAll("video"));

    // YouTube-specific: ensure we're getting the main video player
    if (location.host.includes("youtube.com")) {
      // YouTube uses a specific video element structure
      const ytVideo = document.querySelector("#movie_player video, .html5-video-player video, ytd-player video");
      if (ytVideo && !videos.includes(ytVideo)) {
        videos.unshift(ytVideo); // Prioritize YouTube's main video
      }
    }

    // Try to collect videos from same-origin iframes
    try {
      const iframes = Array.from(document.querySelectorAll("iframe"));
      for (const iframe of iframes) {
        try {
          // This will throw if iframe is cross-origin
          const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
          if (iframeDoc) {
            const iframeVideos = Array.from(iframeDoc.querySelectorAll("video"));
            videos = videos.concat(iframeVideos);
            log(`Found ${iframeVideos.length} video(s) in iframe`);
          }
        } catch (e) {
          // Cross-origin iframe, can't access
          // For these, we need to inject content script into the iframe separately
        }
      }
    } catch (e) {
      log("Error checking iframes:", e);
    }

    log(`Total videos found: ${videos.length}`);
    return videos;
  }

  function getBestVideo() {
    const vids = getAllVideos();
    if (!vids.length) {
      log("No video elements found");
      return null;
    }

    // Prefer playing videos with enough data
    const candidates = vids.filter(v => {
      try {
        const isPlaying = !v.paused && !v.ended;
        const hasData = v.readyState >= 2;
        log(`Video check: paused=${v.paused}, ended=${v.ended}, readyState=${v.readyState}, duration=${v.duration}`);
        return isPlaying && hasData;
      } catch {
        return false;
      }
    });

    log(`Found ${candidates.length} playing video(s) out of ${vids.length} total`);

    // Use candidates if found, otherwise try any video with reasonable readyState
    let list = candidates.length ? candidates : vids.filter(v => {
      try {
        return v.readyState >= 1; // At least some metadata loaded
      } catch {
        return false;
      }
    });

    // If still nothing, just use all videos
    if (!list.length) {
      log("No ready videos, using all videos");
      list = vids;
    }

    // Choose highest visible area
    let best = null;
    let bestScore = 0;
    for (const v of list) {
      let score = 0;
      try { score = visibleAreaScore(v); } catch { score = 0; }
      if (score > bestScore) {
        bestScore = score;
        best = v;
      }
    }

    if (best) {
      log(`Selected video: paused=${best.paused}, readyState=${best.readyState}, duration=${best.duration}`);
    } else {
      log("No suitable video found");
    }

    return best;
  }

  async function tryEnterPiP(cfg, reason = "unknown") {
    // throttle attempts
    const t = now();
    if (t - state.lastAttemptTs < 1500) return;
    state.lastAttemptTs = t;

    const video = getBestVideo();
    if (!video) {
      log("No video found for PiP");
      return;
    }

    // Already in PiP?
    if (document.pictureInPictureElement) {
      log("Already in PiP mode");
      return;
    }

    // Check if armed or recently had user interaction
    const isArmed = t < state.armedUntil;
    const timeSinceInteraction = t - state.lastUserInteraction;
    const hasRecentInteraction = timeSinceInteraction < 5000; // Within 5 seconds

    log(`Attempting PiP (reason: ${reason}, armed: ${isArmed}, recentInteraction: ${hasRecentInteraction}, timeSinceInteraction: ${timeSinceInteraction}ms, failCount: ${state.tabSwitchFailCount})`);

    // If not armed and no recent interaction for tab switch, wait a bit for potential user interaction
    if (reason === "tabSwitch" && !isArmed && !hasRecentInteraction && timeSinceInteraction > 10000) {
      log("Tab switch without recent interaction or arming - PiP may fail. Waiting briefly...");
      // Wait a tiny bit in case there's an interaction coming
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // If not armed, we still try; if it fails, we show toast to arm it.
    try {
      await video.requestPictureInPicture();
      state.isInPiP = true;
      state.tabSwitchFailCount = 0; // Reset fail count on success
      hideToast();
      hideBanner();
      log("Entered PiP successfully");

      // Notify background script
      try {
        if (chrome.runtime?.id) {
          chrome.runtime.sendMessage({ action: "pipEntered", reason });
        }
      } catch (e) {
        // Background script might not be available or extension was reloaded
        log("Could not notify background script:", e.message);
      }
    } catch (e) {
      log("PiP request failed:", e?.name, e?.message);

      // Handle user gesture errors
      if (e?.name === "NotAllowedError" || e?.message?.includes("gesture")) {
        if (reason === "tabSwitch") {
          // For tab switches, show notification on first failure
          state.tabSwitchFailCount++;
          const isArmed = now() < state.armedUntil;
          const timeSinceInteraction = now() - state.lastUserInteraction;

          log(`Tab switch failure #${state.tabSwitchFailCount}: armed=${isArmed}, timeSinceInteraction=${Math.round(timeSinceInteraction/1000)}s`);

          if (state.tabSwitchFailCount === 1 && !isArmed) {
            log("First tab switch PiP failure - showing notification banner");
            showInteractionBanner(cfg, "tab");
          } else if (!isArmed) {
            log(`Tab switch PiP blocked (attempt ${state.tabSwitchFailCount}), no recent interaction (${Math.round(timeSinceInteraction/1000)}s ago)`);
          } else {
            log(`Tab switch PiP blocked even while armed (attempt ${state.tabSwitchFailCount}), need recent interaction (${Math.round(timeSinceInteraction/1000)}s ago)`);
          }
        } else {
          // For collapse and other reasons, show notification
          log("Panel/collapse PiP failure - showing notification banner");
          showInteractionBanner(cfg, "panel");
        }
      } else if (reason !== "tabSwitch") {
        log("PiP failed for other reason:", e);
      }
    }
  }

  async function maybeExitPiP(cfg) {
    log(`maybeExitPiP called: exitOnExpand=${cfg.exitOnExpand}, isInPiP=${!!document.pictureInPictureElement}`);
    if (!cfg.exitOnExpand) {
      log("exitOnExpand is disabled, not exiting PiP");
      return;
    }
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        state.isInPiP = false;
        log("Exited PiP");

        // Notify background script
        try {
          if (chrome.runtime?.id) {
            chrome.runtime.sendMessage({ action: "pipExited" });
          }
        } catch (e) {
          // Background script might not be available or extension was reloaded
          log("Could not notify background script:", e.message);
        }
      } else {
        log("No PiP element to exit from");
      }
    } catch (e) {
      log("Exit PiP failed:", e?.name, e?.message);
    }
  }

  function showToast(cfg, text) {
    if (state.toastEl) return;

    const el = document.createElement("div");
    el.className = "betterautopip-toast";
    el.textContent = text;

    el.addEventListener("click", async () => {
      // If extension was reloaded, just hide the toast
      if (!isExtensionValid()) {
        hideToast();
        return;
      }

      arm(cfg.armMinutes);
      el.textContent = `Armed for ${cfg.armMinutes} min. Trying PiP now...`;

      // Try to enter PiP immediately after arming (user just clicked, so we have gesture)
      const video = getBestVideo();
      if (video && !document.pictureInPictureElement) {
        try {
          await video.requestPictureInPicture();
          state.isInPiP = true;
          log("Entered PiP after arming");
          setTimeout(hideToast, 1000);

          // Notify background script
          try {
            if (chrome.runtime?.id) {
              chrome.runtime.sendMessage({ action: "pipEntered", reason: "armed" });
            }
          } catch (e) {
            // Background script might not be available or extension was reloaded
            log("Could not notify background script:", e.message);
          }
        } catch (e) {
          log("PiP still failed after arming:", e);
          el.textContent = `Armed for ${cfg.armMinutes} min. Collapse again to trigger PiP.`;
          setTimeout(hideToast, 2000);
        }
      } else {
        setTimeout(hideToast, 2000);
      }
    }, { once: true });

    document.documentElement.appendChild(el);
    state.toastEl = el;
  }

  function hideToast() {
    if (!state.toastEl) return;
    state.toastEl.remove();
    state.toastEl = null;
  }

  function showInteractionBanner(cfg, triggerType) {
    // Only show one banner at a time
    if (state.bannerEl) {
      log("Banner already showing, skipping");
      return;
    }

    log(`Creating interaction banner (type: ${triggerType})`);

    const el = document.createElement("div");
    el.className = "betterautopip-banner";

    const message = triggerType === "tab"
      ? "Better Auto PiP needs page interaction to work when switching tabs."
      : "Better Auto PiP needs page interaction to work when panel collapses.";

    el.innerHTML = `
      <div class="betterautopip-banner-content">
        <div class="betterautopip-banner-icon">&#9432;</div>
        <div class="betterautopip-banner-text">
          <strong>Picture-in-Picture Blocked</strong>
          <p>${message} Click anywhere on this page, then try again.</p>
        </div>
        <button class="betterautopip-banner-close">&times;</button>
      </div>
    `;

    const closeBtn = el.querySelector(".betterautopip-banner-close");
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      hideBanner();
    });

    // Auto-hide after 8 seconds
    const hideTimer = setTimeout(hideBanner, 8000);

    // Hide when user interacts with the page
    const interactionHandler = () => {
      log("User interacted with page - hiding notification banner");
      clearTimeout(hideTimer);
      setTimeout(hideBanner, 2000); // Hide after 2 seconds of interaction

      // Remove listeners
      document.removeEventListener("mousedown", interactionHandler);
      document.removeEventListener("keydown", interactionHandler);
    };

    document.addEventListener("mousedown", interactionHandler, { once: true });
    document.addEventListener("keydown", interactionHandler, { once: true });

    document.documentElement.appendChild(el);
    state.bannerEl = el;
    log("Interaction banner added to page");
  }

  function hideBanner() {
    if (!state.bannerEl) return;
    state.bannerEl.remove();
    state.bannerEl = null;
  }

  function injectStylesOnce() {
    if (document.getElementById("betterautopip-style")) return;
    const style = document.createElement("style");
    style.id = "betterautopip-style";
    style.textContent = `
      .betterautopip-toast{
        position: fixed;
        z-index: 2147483647;
        right: 12px;
        bottom: 12px;
        padding: 10px 12px;
        border-radius: 10px;
        font: 13px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        background: rgba(30,30,30,.92);
        color: #fff;
        box-shadow: 0 8px 24px rgba(0,0,0,.35);
        cursor: pointer;
        user-select: none;
        max-width: 320px;
      }
      .betterautopip-toast:hover{ filter: brightness(1.05); }

      .betterautopip-banner{
        position: fixed;
        z-index: 2147483646;
        top: 0;
        left: 0;
        right: 0;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: #fff;
        box-shadow: 0 4px 12px rgba(0,0,0,.15);
        font: 14px/1.4 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        animation: betterautopip-slide-down 0.3s ease-out;
      }

      @keyframes betterautopip-slide-down {
        from { transform: translateY(-100%); }
        to { transform: translateY(0); }
      }

      .betterautopip-banner-content{
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px 20px;
        max-width: 1200px;
        margin: 0 auto;
      }

      .betterautopip-banner-icon{
        font-size: 24px;
        line-height: 1;
        flex-shrink: 0;
      }

      .betterautopip-banner-text{
        flex: 1;
      }

      .betterautopip-banner-text strong{
        display: block;
        font-size: 15px;
        margin-bottom: 4px;
      }

      .betterautopip-banner-text p{
        margin: 0;
        opacity: 0.95;
        font-size: 13px;
      }

      .betterautopip-banner-close{
        background: rgba(255,255,255,0.2);
        border: none;
        color: #fff;
        font-size: 24px;
        line-height: 1;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        cursor: pointer;
        flex-shrink: 0;
        transition: background 0.2s;
      }

      .betterautopip-banner-close:hover{
        background: rgba(255,255,255,0.3);
      }
    `;
    document.documentElement.appendChild(style);
  }

  async function loadConfig() {
    // If extension was reloaded, just return defaults
    if (!isExtensionValid()) {
      return DEFAULTS;
    }

    try {
      const cfg = await chrome.storage.sync.get(DEFAULTS);
      // Merge defaults with saved settings to ensure new settings persist across updates
      const merged = { ...DEFAULTS, ...cfg };

      // Ensure siteSettings object exists
      if (!merged.siteSettings || typeof merged.siteSettings !== "object") {
        merged.siteSettings = {};
      }

      // Clean up old deprecated settings if they exist
      delete merged.siteEnabled;
      delete merged.enableTabSwitch;
      delete merged.enablePanelCollapse;

      return merged;
    } catch (e) {
      // Extension context invalidated (extension was reloaded)
      log("Extension context invalidated, using defaults");
      return DEFAULTS;
    }
  }

  function isSiteEnabled(cfg, feature) {
    const key = hostKey();
    if (!key) return true;

    const siteSettings = cfg.siteSettings?.[key];
    if (!siteSettings) return true; // Default to enabled if no settings

    if (feature === 'tab') {
      return siteSettings.enableTab !== false;
    } else if (feature === 'panel') {
      return siteSettings.enablePanel !== false;
    }

    return true;
  }

  async function tick() {
    // If extension was reloaded, stop processing events
    if (!isExtensionValid()) return;

    // Panel collapse only works in Vivaldi
    if (!isVivaldi()) {
      return;
    }

    const cfg = await loadConfig();
    if (!cfg.enabled) {
      log("Extension disabled in config");
      return;
    }
    if (!isSiteEnabled(cfg, 'panel')) {
      log("Panel collapse disabled for this site");
      return;
    }

    injectStylesOnce();

    const collapsed = isCollapsed(cfg);

    // Debounce collapse/expand transitions
    clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(async () => {
      // Check again before executing debounced action
      if (!isExtensionValid()) return;

      // If transitioned to collapsed
      if (collapsed && !state.lastCollapsed) {
        log("Transitioned to collapsed state");
        state.lastCollapsed = true;

        // Try PiP; if not armed and blocked, we'll show toast.
        await tryEnterPiP(cfg, "collapse");
      }

      // If transitioned to expanded
      if (!collapsed && state.lastCollapsed) {
        log("Transitioned to expanded state");
        state.lastCollapsed = false;
        hideToast();
        await maybeExitPiP(cfg);
      }
    }, cfg.debounceMs);
  }

  function trackUserInteraction() {
    state.lastUserInteraction = now();
  }

  function hookViewportEvents() {
    // Track user interactions to help with gesture requirements
    const interactionEvents = ['mousedown', 'keydown', 'touchstart', 'click'];
    interactionEvents.forEach(eventType => {
      document.addEventListener(eventType, trackUserInteraction, { passive: true, capture: true });
    });

    // Panel collapse detection is Vivaldi-only
    if (isVivaldi()) {
      // visualViewport resize is best signal for panel collapse/expand
      window.visualViewport?.addEventListener("resize", tick, { passive: true });
      window.addEventListener("resize", tick, { passive: true });

      // Some UIs change layout without resize; these can help
      document.addEventListener("fullscreenchange", tick, { passive: true });

      // Poll for viewport size changes (for panels that don't trigger resize events)
      // This is a fallback for Vivaldi panels
      setInterval(async () => {
        const { w, h } = getViewportSize();
        const key = `${w}x${h}`;
        if (!state.lastViewportKey) {
          state.lastViewportKey = key;
          return;
        }
        if (state.lastViewportKey !== key) {
          const cfg = await loadConfig();
          log(`Viewport changed: ${state.lastViewportKey} → ${key}, collapseThresholds: w<=${cfg.collapseWidthPx}, h<=${cfg.collapseHeightPx}`);
          state.lastViewportKey = key;
          tick();
        }
      }, 500); // Check every 500ms
    }

    // Tab switching works on all browsers
    document.addEventListener("visibilitychange", handleVisibilityChange, { passive: true });

    // Listen for PiP events to track state
    document.addEventListener("enterpictureinpicture", () => {
      state.isInPiP = true;
      log("PiP entered (event)");
    }, { passive: true });

    document.addEventListener("leavepictureinpicture", () => {
      state.isInPiP = false;
      log("PiP left (event)");
    }, { passive: true });
  }

  async function handleVisibilityChange() {
    // If extension was reloaded, stop processing events
    if (!isExtensionValid()) return;

    const cfg = await loadConfig();
    if (!cfg.enabled) return;

    const currentState = document.visibilityState;

    // Tab became hidden (switched away)
    if (currentState === "hidden" && state.lastVisibilityState === "visible") {
      if (isSiteEnabled(cfg, 'tab')) {
        log("Tab hidden - attempting PiP");
        setTimeout(() => tryEnterPiP(cfg, "tabSwitch"), cfg.tabSwitchDelay);
      } else {
        log("Tab switching disabled for this site");
      }
    }

    // Tab became visible again (switched back)
    if (currentState === "visible" && state.lastVisibilityState === "hidden") {
      log("Tab visible again");
      if (cfg.exitOnExpand) {
        await maybeExitPiP(cfg);
      } else {
        log("exitOnExpand is disabled - video will stay in PiP");
      }
    }

    state.lastVisibilityState = currentState;

    // Also run normal tick for panel collapse detection
    tick();
  }

  // Handle messages from background script
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    log("Message received:", message);

    if (message.action === "tryPiP") {
      loadConfig().then(cfg => {
        tryEnterPiP(cfg, message.reason || "background");
      });
      sendResponse({ success: true });
    }

    return false;
  });

  // Watch for video elements being added (for YouTube and other dynamic sites)
  function setupVideoObserver() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1) { // Element node
            if (node.tagName === 'VIDEO' || node.querySelector?.('video')) {
              log("New video element detected");
              // Video was added, re-run tick after a short delay
              setTimeout(tick, 500);
              break;
            }
          }
        }
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    log("Video observer initialized");
  }

  // YouTube-specific initialization
  function initYouTube() {
    if (!location.host.includes("youtube.com")) return;

    log("YouTube detected, adding special handlers");

    // YouTube's player might not be ready immediately
    // Watch for the player to become available
    const checkYouTubePlayer = () => {
      const video = document.querySelector("#movie_player video, .html5-video-player video");
      if (video) {
        log("YouTube player video found");

        // Add event listeners to YouTube video
        video.addEventListener("play", () => {
          log("YouTube video started playing");
        }, { passive: true });

        video.addEventListener("pause", () => {
          log("YouTube video paused");
        }, { passive: true });
      }
    };

    // Check immediately and after delays
    checkYouTubePlayer();
    setTimeout(checkYouTubePlayer, 1000);
    setTimeout(checkYouTubePlayer, 2000);

    // Also watch for YouTube's navigation events
    document.addEventListener("yt-navigate-finish", () => {
      log("YouTube navigation finished");
      setTimeout(tick, 1000);
    }, { passive: true });
  }

  // Initialize
  (async function init() {
    log("Extension initializing...");
    log(`Current URL: ${location.href}`);
    log(`Viewport size: ${JSON.stringify(getViewportSize())}`);

    hookViewportEvents();
    setupVideoObserver();
    initYouTube();

    // initial run
    tick();

    // Run again after a delay for dynamic content
    setTimeout(tick, 2000);
  })();
})();
