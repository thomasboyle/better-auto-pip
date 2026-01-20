(() => {
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
    lastUserInteraction: 0,
    mediaSessionHandlerRegistered: false,
    supportsAutoPiP: false,
    cachedVideos: null,
    cachedVideosTs: 0,
    cachedViewport: null,
    cachedViewportTs: 0,
    cachedConfig: null,
    cachedConfigTs: 0,
    cachedIframeVideos: null,
    cachedIframeVideosTs: 0,
    viewportPollInterval: null,
    cachedHost: null,
    cachedIsVivaldi: null,
    cachedVivaldiData: null
  };

  const CACHE_VIEWPORT_MS = 100;
  const CACHE_VIDEOS_MS = 1000;
  const CACHE_IFRAME_MS = 3000;
  const CACHE_CONFIG_MS = 5000;
  const READY_STATE_HAVE_CURRENT_DATA = 2;
  const READY_STATE_HAVE_METADATA = 1;
  const MIN_ATTEMPT_INTERVAL = 1500;
  const INTERACTION_WINDOW = 5000;
  const INTERACTION_THRESHOLD = 10000;

  function isExtensionValid() {
    try {
      return !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  function isVivaldi() {
    if (state.cachedIsVivaldi !== null) return state.cachedIsVivaldi;
    const ua = navigator.userAgent;
    const vendor = navigator.vendor;
    state.cachedIsVivaldi = !!(window.vivaldi) || ua.includes("Vivaldi") || (vendor && vendor.includes("Vivaldi"));
    return state.cachedIsVivaldi;
  }

  const log = () => { };

  function hostKey() {
    if (state.cachedHost !== null) return state.cachedHost;
    try {
      state.cachedHost = location.host;
      return state.cachedHost;
    } catch {
      state.cachedHost = "";
      return "";
    }
  }

  const now = Date.now;

  function isArmed() {
    return now() < state.armedUntil;
  }

  function arm(minutes) {
    state.armedUntil = now() + minutes * 60000;
    state.tabSwitchFailCount = 0;
  }

  function checkAutoPiPSupport() {
    try {
      if (!navigator.mediaSession) return false;
      try {
        navigator.mediaSession.setActionHandler("enterpictureinpicture", null);
        return true;
      } catch {
        return false;
      }
    } catch {
      return false;
    }
  }

  async function registerMediaSessionHandler() {
    if (state.mediaSessionHandlerRegistered || !state.supportsAutoPiP) return;
    try {
      const cfg = await loadConfig();
      if (!cfg.enabled || !isSiteEnabled(cfg, "tab")) return;

      navigator.mediaSession.setActionHandler("enterpictureinpicture", async () => {
        const currentCfg = await loadConfig();
        if (!currentCfg.enabled || !isSiteEnabled(currentCfg, "tab")) return;

        const video = getBestVideo();
        if (!video || document.pictureInPictureElement) return;

        try {
          await video.requestPictureInPicture();
          state.isInPiP = true;
          state.tabSwitchFailCount = 0;
          hideToast();
          hideBanner();
          if (chrome.runtime?.id) chrome.runtime.sendMessage({ action: "pipEntered", reason: "mediaSession" });
        } catch { }
      });

      state.mediaSessionHandlerRegistered = true;
    } catch { }
  }

  function unregisterMediaSessionHandler() {
    if (!state.mediaSessionHandlerRegistered) return;
    try {
      navigator.mediaSession.setActionHandler("enterpictureinpicture", null);
      state.mediaSessionHandlerRegistered = false;
    } catch { }
  }

  function getViewportSize() {
    const t = now();
    const cacheAge = t - state.cachedViewportTs;
    if (state.cachedViewport && cacheAge < CACHE_VIEWPORT_MS) return state.cachedViewport;
    const vv = window.visualViewport;
    let w = 0, h = 0;
    if (vv) {
      w = vv.width | 0;
      h = vv.height | 0;
    }
    if (!w) w = (window.innerWidth || document.documentElement.clientWidth || 0) | 0;
    if (!h) h = (window.innerHeight || document.documentElement.clientHeight || 0) | 0;
    const viewport = { w, h };
    state.cachedViewport = viewport;
    state.cachedViewportTs = t;
    return viewport;
  }

  function isVivaldiPanel() {
    try {
      const { w, h } = getViewportSize();
      if (window.name && window.name.startsWith('vivaldi-webpanel-')) return true;
      const href = window.location.href;
      if (href.includes('vivaldi://webpanel') || href.includes('vivaldi-webpanel')) return true;
      const screenW = window.screen.width;
      return window === window.top && window.opener === null && w < (screenW * 0.6) && (h / w) > 1.2;
    } catch {
      return false;
    }
  }

  function isCollapsed(cfg) {
    const { w, h } = getViewportSize();
    return (w > 0 && w <= cfg.collapseWidthPx) || (h > 0 && h <= cfg.collapseHeightPx);
  }

  function visibleAreaScore(video) {
    const rect = video.getBoundingClientRect();
    const w = rect.width | 0;
    const h = rect.height | 0;
    if (w <= 0 || h <= 0) return 0;
    const area = w * h;
    const { w: vw, h: vh } = getViewportSize();
    if (rect.bottom > 0 && rect.right > 0 && rect.top < vh && rect.left < vw) return area;
    return area * 0.2;
  }

  function getBestVideo() {
    const t = now();
    const cacheAge = t - state.cachedVideosTs;
    if (state.cachedVideos && cacheAge < CACHE_VIDEOS_MS) {
      let best = null;
      let bestScore = 0;
      const videos = state.cachedVideos;
      const len = videos.length;
      for (let i = 0; i < len; i++) {
        const v = videos[i];
        if (!v.isConnected) continue;
        try {
          if (v.paused || v.ended || v.readyState < READY_STATE_HAVE_CURRENT_DATA) continue;
          const score = visibleAreaScore(v);
          if (score > bestScore) {
            bestScore = score;
            best = v;
          }
        } catch { }
      }
      if (best) return best;
    }

    const videos = [];
    const docVideos = document.querySelectorAll("video");
    const docVideosLen = docVideos.length;
    for (let i = 0; i < docVideosLen; i++) videos.push(docVideos[i]);

    const host = location.host;
    if (host.includes("youtube.com")) {
      const ytVideo = document.querySelector("#movie_player video, .html5-video-player video, ytd-player video");
      if (ytVideo) {
        let found = false;
        const len = videos.length;
        for (let i = 0; i < len; i++) {
          if (videos[i] === ytVideo) {
            found = true;
            break;
          }
        }
        if (!found) videos.unshift(ytVideo);
      }
    }

    try {
      const iframeCacheAge = t - state.cachedIframeVideosTs;
      if (state.cachedIframeVideos && iframeCacheAge < CACHE_IFRAME_MS) {
        const iframeVideos = state.cachedIframeVideos;
        const iframeLen = iframeVideos.length;
        for (let i = 0; i < iframeLen; i++) videos.push(iframeVideos[i]);
      } else {
        const iframes = document.querySelectorAll("iframe");
        const iframeVideos = [];
        const iframesLen = iframes.length;
        const maxIframes = iframesLen < 10 ? iframesLen : 10;
        for (let i = 0; i < maxIframes; i++) {
          try {
            const iframe = iframes[i];
            if (!iframe.isConnected) continue;
            const iframeDoc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
            if (iframeDoc) {
              const iVideos = iframeDoc.querySelectorAll("video");
              const iVideosLen = iVideos.length;
              for (let j = 0; j < iVideosLen; j++) {
                const iv = iVideos[j];
                if (iv.isConnected) {
                  iframeVideos.push(iv);
                  videos.push(iv);
                }
              }
            }
          } catch { }
        }
        state.cachedIframeVideos = iframeVideos;
        state.cachedIframeVideosTs = t;
      }
    } catch { }

    state.cachedVideos = videos;
    state.cachedVideosTs = t;

    let best = null;
    let bestScore = 0;
    let fallback = null;
    let fallbackScore = 0;
    const videosLen = videos.length;

    for (let i = 0; i < videosLen; i++) {
      const v = videos[i];
      try {
        const score = visibleAreaScore(v);
        const rs = v.readyState;
        if (!v.paused && !v.ended && rs >= READY_STATE_HAVE_CURRENT_DATA) {
          if (score > bestScore) {
            bestScore = score;
            best = v;
          }
        } else if (rs >= READY_STATE_HAVE_METADATA) {
          if (score > fallbackScore) {
            fallbackScore = score;
            fallback = v;
          }
        }
      } catch { }
    }
    return best || fallback || (videosLen > 0 ? videos[0] : null);
  }

  async function tryEnterPiP(cfg, reason = "unknown") {
    const t = now();
    const attemptDelta = t - state.lastAttemptTs;
    if (attemptDelta < MIN_ATTEMPT_INTERVAL) return;
    state.lastAttemptTs = t;

    const video = getBestVideo();
    if (!video || document.pictureInPictureElement) return;

    const isArmed = t < state.armedUntil;
    const timeSinceInteraction = t - state.lastUserInteraction;
    const hasRecentInteraction = timeSinceInteraction < INTERACTION_WINDOW;

    if (reason === "tabSwitch" && !isArmed && !hasRecentInteraction && timeSinceInteraction > INTERACTION_THRESHOLD) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    try {
      await video.requestPictureInPicture();
      state.isInPiP = true;
      state.tabSwitchFailCount = 0;
      hideToast();
      hideBanner();
      if (chrome.runtime && chrome.runtime.id) chrome.runtime.sendMessage({ action: "pipEntered", reason });
    } catch (e) {
      const errName = e && e.name;
      const errMsg = e && e.message;
      if (errName === "NotAllowedError" || (errMsg && errMsg.includes("gesture"))) {
        if (reason === "tabSwitch") {
          state.tabSwitchFailCount++;
          if (state.tabSwitchFailCount === 1 && t >= state.armedUntil) {
            if (cfg.showBlockAlerts !== false) {
              showInteractionBanner(cfg, "tab");
            }
          }
        } else {
          if (cfg.showBlockAlerts !== false) {
            showInteractionBanner(cfg, "panel");
          }
        }
      }
    }
  }

  async function maybeExitPiP(cfg) {
    if (!cfg.exitOnExpand) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        state.isInPiP = false;
        if (chrome.runtime && chrome.runtime.id) chrome.runtime.sendMessage({ action: "pipExited" });
      }
    } catch { }
  }

  function showToast(cfg, text) {
    if (state.toastEl) return;
    const el = document.createElement("div");
    el.className = "betterautopip-toast";
    el.textContent = text;
    el.addEventListener("click", async () => {
      if (!isExtensionValid()) return hideToast();
      arm(cfg.armMinutes);
      el.textContent = `Armed for ${cfg.armMinutes} min. Trying PiP...`;
      const video = getBestVideo();
      if (video && !document.pictureInPictureElement) {
        try {
          await video.requestPictureInPicture();
          state.isInPiP = true;
          setTimeout(hideToast, 1000);
          if (chrome.runtime && chrome.runtime.id) chrome.runtime.sendMessage({ action: "pipEntered", reason: "armed" });
        } catch {
          el.textContent = `Armed for ${cfg.armMinutes} min. Collapse to PiP.`;
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
    if (state.bannerEl) return;
    if (cfg.showBlockAlerts === false) return;
    const el = document.createElement("div");
    el.className = "betterautopip-banner";
    const msg = triggerType === "tab" ? "Better Auto PiP needs page interaction to work when switching tabs." : "Better Auto PiP needs page interaction to work when panel collapses.";
    el.innerHTML = `<div class="betterautopip-banner-content"><div class="betterautopip-banner-icon">&#9432;</div><div class="betterautopip-banner-text"><strong>Picture-in-Picture Blocked</strong><p>${msg} Click anywhere on this page, then try again.</p></div><button class="betterautopip-banner-close">&times;</button></div>`;
    el.querySelector(".betterautopip-banner-close").addEventListener("click", (e) => { e.stopPropagation(); hideBanner(); });
    const hideTimer = setTimeout(hideBanner, 8000);
    const interactionHandler = () => {
      clearTimeout(hideTimer);
      setTimeout(hideBanner, 2000);
      document.removeEventListener("mousedown", interactionHandler);
      document.removeEventListener("keydown", interactionHandler);
    };
    document.addEventListener("mousedown", interactionHandler, { once: true });
    document.addEventListener("keydown", interactionHandler, { once: true });
    document.documentElement.appendChild(el);
    state.bannerEl = el;
  }

  function hideBanner() {
    if (!state.bannerEl) return;
    state.bannerEl.remove();
    state.bannerEl = null;
  }

  async function getVivaldiData() {
    if (state.cachedVivaldiData) return state.cachedVivaldiData;
    try {
      state.cachedVivaldiData = await chrome.runtime.sendMessage({ action: "isVivaldi" });
    } catch {
      state.cachedVivaldiData = { isPanel: false };
    }
    return state.cachedVivaldiData || { isPanel: false };
  }

  const STYLES_ID = "betterautopip-style";
  function injectStylesOnce() {
    if (document.getElementById(STYLES_ID)) return;
    const style = document.createElement("style");
    style.id = STYLES_ID;
    style.textContent = `.betterautopip-toast{position:fixed;z-index:2147483647;right:12px;bottom:12px;padding:10px 12px;border-radius:10px;font:13px/1.2 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:rgba(30,30,30,.92);color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.35);cursor:pointer;user-select:none;max-width:320px}.betterautopip-toast:hover{filter:brightness(1.05)}.betterautopip-banner{position:fixed;z-index:2147483646;top:0;left:0;right:0;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#fff;box-shadow:0 4px 12px rgba(0,0,0,.15);font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;animation:betterautopip-slide-down .3s ease-out}@keyframes betterautopip-slide-down{from{transform:translateY(-100%)}to{transform:translateY(0)}}.betterautopip-banner-content{display:flex;align-items:center;gap:12px;padding:14px 20px;max-width:1200px;margin:0 auto}.betterautopip-banner-icon{font-size:24px;line-height:1;flex-shrink:0}.betterautopip-banner-text{flex:1}.betterautopip-banner-text strong{display:block;font-size:15px;margin-bottom:4px}.betterautopip-banner-text p{margin:0;opacity:.95;font-size:13px}.betterautopip-banner-close{background:rgba(255,255,255,.2);border:none;color:#fff;font-size:24px;line-height:1;width:32px;height:32px;border-radius:50%;cursor:pointer;flex-shrink:0;transition:background .2s}.betterautopip-banner-close:hover{background:rgba(255,255,255,.3)}`;
    (document.head || document.documentElement).appendChild(style);
  }

  async function loadConfig() {
    const t = now();
    const cacheAge = t - state.cachedConfigTs;
    if (state.cachedConfig && cacheAge < CACHE_CONFIG_MS) return state.cachedConfig;
    if (!isExtensionValid()) return DEFAULTS;
    try {
      const cfg = await chrome.storage.sync.get(DEFAULTS);
      const m = {};
      for (const k in DEFAULTS) m[k] = k in cfg ? cfg[k] : DEFAULTS[k];
      if (!m.siteSettings || typeof m.siteSettings !== "object") m.siteSettings = {};
      delete m.siteEnabled;
      delete m.enableTabSwitch;
      delete m.enablePanelCollapse;
      state.cachedConfig = m;
      state.cachedConfigTs = t;
      return m;
    } catch {
      return DEFAULTS;
    }
  }

  function isSiteEnabled(cfg, feature) {
    const key = hostKey();
    if (!key) return true;
    const siteSettings = cfg.siteSettings;
    if (!siteSettings) return true;
    const s = siteSettings[key];
    if (!s) return true;
    return feature === 'tab' ? s.enableTab !== false : s.enablePanel !== false;
  }

  async function tick() {
    if (!isExtensionValid()) return;
    if (!isVivaldi()) return;
    const cfg = await loadConfig();
    if (!cfg.enabled || !isSiteEnabled(cfg, 'panel')) return;
    injectStylesOnce();
    const collapsed = isCollapsed(cfg);
    clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(async () => {
      if (!isExtensionValid()) return;
      if (collapsed && !state.lastCollapsed) {
        state.lastCollapsed = true;
        await tryEnterPiP(cfg, "collapse");
      }
      if (!collapsed && state.lastCollapsed) {
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
    const events = ['mousedown', 'keydown', 'touchstart', 'click'];
    const eventsLen = events.length;
    for (let i = 0; i < eventsLen; i++) {
      document.addEventListener(events[i], trackUserInteraction, { passive: true, capture: true });
    }
    if (isVivaldi()) {
      const vv = window.visualViewport;
      if (vv) vv.addEventListener("resize", tick, { passive: true });
      window.addEventListener("resize", tick, { passive: true });
      document.addEventListener("fullscreenchange", tick, { passive: true });
      let lastCheck = now();
      const checkViewport = () => {
        if (document.hidden) {
          state.viewportPollInterval = setTimeout(checkViewport, 2000);
          return;
        }
        const { w, h } = getViewportSize();
        const key = `${w}x${h}`;
        if (state.lastViewportKey !== key) {
          state.lastViewportKey = key;
          tick();
        }
        const delay = now() - lastCheck > 1000 ? 2000 : 1000;
        lastCheck = now();
        state.viewportPollInterval = setTimeout(checkViewport, delay);
      };
      state.viewportPollInterval = setTimeout(checkViewport, 1000);
    }
    document.addEventListener("visibilitychange", handleVisibilityChange, { passive: true });
    document.addEventListener("enterpictureinpicture", () => state.isInPiP = true, { passive: true });
    document.addEventListener("leavepictureinpicture", () => state.isInPiP = false, { passive: true });
  }

  async function handleVisibilityChange() {
    if (!isExtensionValid()) return;
    const cfg = await loadConfig();
    if (!cfg.enabled) return;
    const curr = document.visibilityState;
    if (curr === "hidden" && state.lastVisibilityState === "visible") {
      if (isSiteEnabled(cfg, 'tab')) {
        const d = cfg.tabSwitchDelay;
        if (state.mediaSessionHandlerRegistered) {
          setTimeout(async () => {
            if (!document.pictureInPictureElement && !state.isInPiP) await tryEnterPiP(cfg, "tabSwitch");
          }, d + 200);
        } else {
          setTimeout(() => tryEnterPiP(cfg, "tabSwitch"), d);
        }
      }
    }
    if (curr === "visible" && state.lastVisibilityState === "hidden") {
      if (cfg.exitOnExpand) await maybeExitPiP(cfg);
    }
    state.lastVisibilityState = curr;
    tick();
  }

  chrome.runtime.onMessage.addListener((m, s, r) => {
    if (m.action === "ping") { r({ pong: true }); return false; }
    if (m.action === "tryPiP") {
      loadConfig().then(c => tryEnterPiP(c, m.reason || "background"));
      r({ success: true });
    }
    return false;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      state.cachedConfig = null;
      state.cachedHost = null;
    }
  });

  function setupVideoObserver() {
    let mutationDebounceTimer = null;
    let pendingInvalidation = false;
    const o = new MutationObserver((mutations) => {
      if (pendingInvalidation) return;
      let added = false;
      const mutationsLen = mutations.length;
      const maxMutations = mutationsLen < 50 ? mutationsLen : 50;
      for (let i = 0; i < maxMutations; i++) {
        const nodes = mutations[i].addedNodes;
        const nodesLen = nodes.length;
        const maxNodes = nodesLen < 20 ? nodesLen : 20;
        for (let j = 0; j < maxNodes; j++) {
          const n = nodes[j];
          if (n.nodeType === 1) {
            if (n.tagName === 'VIDEO' || (n.querySelector && n.querySelector('video'))) {
              added = true;
              break;
            }
          }
        }
        if (added) break;
      }
      if (added) {
        pendingInvalidation = true;
        if (mutationDebounceTimer) clearTimeout(mutationDebounceTimer);
        mutationDebounceTimer = setTimeout(() => {
          state.cachedVideosTs = 0;
          state.cachedIframeVideosTs = 0;
          pendingInvalidation = false;
          tick();
          registerMediaSessionHandler();
        }, 300);
      }
    });
    o.observe(document.documentElement, { childList: true, subtree: true });
  }

  function initYouTube() {
    if (!location.host.includes("youtube.com")) return;
    const chk = () => {
      const v = document.querySelector("#movie_player video, .html5-video-player video");
      if (v) { }
    };
    chk(); setTimeout(chk, 1000); setTimeout(chk, 2000);
    document.addEventListener("yt-navigate-finish", () => {
      state.cachedVideosTs = 0;
      state.cachedIframeVideosTs = 0;
      state.cachedHost = null;
      setTimeout(tick, 1000);
    }, { passive: true });
  }

  (async function init() {
    state.supportsAutoPiP = checkAutoPiPSupport();
    hookViewportEvents();
    setupVideoObserver();
    initYouTube();
    tick();
    setTimeout(registerMediaSessionHandler, 1000);
  })();
})();
