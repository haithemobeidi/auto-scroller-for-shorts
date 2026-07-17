(() => {
  // Prevent duplicate injection - must be first
  if (window.__ytAutoScrollerLoaded) return;
  window.__ytAutoScrollerLoaded = true;

  const LOG = '[AutoScroller]';
  const DEBUG = false;
  const DEFAULTS = { interval: 10, watchFull: true, randomize: false, voiceEnabled: false };

  let settings = { ...DEFAULTS };
  let running = false;   // user intent, persisted in storage
  let engaged = false;   // actively auto-scrolling on a Shorts page

  // Per-video scheduling state
  let ticker = null;
  let deadline = null;       // ms timestamp (interval mode)
  let pausedAt = null;       // ms timestamp when the video was paused/hidden
  let lastTime = null;       // last observed currentTime, for loop detection
  let advancing = false;
  let currentUrl = location.href;
  let watchedVideo = null;
  let preferredStrategy = 0; // index of the last strategy that worked

  // Voice state
  let recognition = null;
  let voiceActive = false;
  let voiceRestartDelay = 300;
  let lastCommandTime = 0;
  const COMMAND_COOLDOWN = 2000;
  const SKIP_WORDS = ['next', 'skip', 'scroll', 'swipe', 'nex', 'neck', 'text', 'mix'];

  let overlay = null;

  const isShortsPage = () => location.pathname.startsWith('/shorts');

  function safeStorageSet(obj) {
    try { chrome.storage.local.set(obj); } catch (_) { /* orphaned script after reload */ }
  }

  // ---------- state / settings sync ----------

  chrome.storage.local.get([...Object.keys(DEFAULTS), 'running'], (data) => {
    for (const key of Object.keys(DEFAULTS)) {
      if (data[key] != null) settings[key] = data[key];
    }
    if (data.running) setRunning(true, false);
    syncVoice();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    let settingsChanged = false;
    for (const key of Object.keys(DEFAULTS)) {
      if (changes[key]) { settings[key] = changes[key].newValue; settingsChanged = true; }
    }
    if (changes.running && changes.running.newValue !== running) {
      setRunning(changes.running.newValue, false);
    }
    if (settingsChanged && engaged && !settings.watchFull) {
      deadline = Date.now() + getIntervalMs();
    }
    syncVoice();
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (_sender.id !== chrome.runtime.id) return;
    if (msg.type === 'PING') {
      sendResponse({ ok: true });
    } else if (msg.type === 'SKIP') {
      advance('popup-skip');
    } else if (msg.type === 'GET_STATE') {
      sendResponse({ running, engaged, onShorts: isShortsPage() });
    }
  });

  function setRunning(next, persist = true) {
    running = next;
    if (persist) safeStorageSet({ running: next });
    if (running && isShortsPage()) engage();
    else disengage();
  }

  // ---------- engage / disengage ----------

  function engage() {
    if (engaged) return;
    engaged = true;
    createOverlay();
    resetForNewVideo();
    ticker = setInterval(tick, 500);
  }

  function disengage() {
    if (!engaged) return;
    engaged = false;
    clearInterval(ticker);
    ticker = null;
    unhookVideo();
    removeOverlay();
  }

  // ---------- SPA navigation ----------

  // YouTube fires this on every internal navigation (home -> shorts, shorts -> shorts, ...)
  document.addEventListener('yt-navigate-finish', onNavigate);

  function onNavigate() {
    currentUrl = location.href;
    if (running && isShortsPage()) {
      if (engaged) resetForNewVideo();
      else engage();
    } else {
      disengage(); // keep `running` so we re-engage when back on Shorts
    }
    syncVoice();
  }

  // ---------- video tracking ----------

  function getCurrentVideo() {
    // The active Short's <video> lives inside the single reel renderer
    // YouTube now keeps in the DOM (verified July 2026).
    const reelVideo = document.querySelector('ytd-reel-video-renderer video[src]');
    if (reelVideo) return reelVideo;
    const videos = [...document.querySelectorAll('video')];
    return (
      videos.find((v) => !v.paused && v.readyState >= 2) ||
      videos.find((v) => v.src) ||
      null
    );
  }

  function hookVideo() {
    const video = getCurrentVideo();
    if (video === watchedVideo) return;
    unhookVideo();
    watchedVideo = video;
    lastTime = null;
    if (video) video.addEventListener('ended', onVideoEnded);
  }

  function unhookVideo() {
    if (!watchedVideo) return;
    watchedVideo.removeEventListener('ended', onVideoEnded);
    watchedVideo.loop = true; // restore YouTube's default looping
    watchedVideo = null;
  }

  function onVideoEnded() {
    if (engaged && settings.watchFull) advance('video-ended');
  }

  function resetForNewVideo() {
    advancing = false;
    pausedAt = null;
    lastTime = null;
    deadline = Date.now() + getIntervalMs();
    hookVideo();
  }

  function getIntervalMs() {
    let seconds = settings.interval;
    if (settings.randomize) {
      const variance = seconds * 0.3;
      seconds = seconds - variance + Math.random() * variance * 2;
    }
    return Math.max(3, seconds) * 1000;
  }

  // ---------- main loop ----------

  function tick() {
    if (!engaged) return;
    if (!isShortsPage()) { disengage(); return; }

    // Fallback SPA-navigation detection in case yt-navigate-finish is missed
    if (location.href !== currentUrl) {
      currentUrl = location.href;
      resetForNewVideo();
      return;
    }

    hookVideo(); // re-hook if YouTube swapped the element
    const video = watchedVideo;

    if (settings.watchFull) {
      if (!video) { updateCountdown(null); return; }
      // YouTube re-asserts loop=true; keep it off so 'ended' fires.
      if (video.loop) video.loop = false;
      // Belt and braces: if the video looped anyway (jumped from near the
      // end back to the start), treat that as "ended".
      if (
        lastTime != null && video.duration && isFinite(video.duration) &&
        lastTime > video.duration - 1.5 && video.currentTime < 0.75
      ) {
        advance('loop-detected');
        return;
      }
      lastTime = video.currentTime;
      updateCountdown(
        video.duration && isFinite(video.duration)
          ? Math.max(0, video.duration - video.currentTime)
          : null
      );
    } else {
      const paused = (video && video.paused) || document.hidden;
      if (paused && !advancing) {
        if (pausedAt == null) pausedAt = Date.now();
        updateCountdown(Math.max(0, deadline - pausedAt) / 1000);
        return;
      }
      if (pausedAt != null) {
        deadline += Date.now() - pausedAt; // freeze the countdown while paused
        pausedAt = null;
      }
      const left = deadline - Date.now();
      updateCountdown(Math.max(0, left) / 1000);
      if (left <= 0) advance('interval');
    }
  }

  // ---------- advancing (multi-strategy, self-verifying) ----------

  const STRATEGIES = [
    ['next-button', () => {
      const btn = document.querySelector(
        '#navigation-button-down button, button[aria-label="Next video"]'
      );
      if (!btn) return false;
      btn.click();
      return true;
    }],
    ['player-api', () => {
      // Handled by content/bridge.js in the MAIN world -> player.nextVideo()
      document.dispatchEvent(new CustomEvent('ytas:next'));
      return true;
    }],
    ['arrow-key', () => {
      const target = document.querySelector('ytd-shorts') || document.body;
      target.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40,
        bubbles: true, cancelable: true,
      }));
      return true;
    }],
    ['scroll-container', () => {
      const container = document.querySelector('#shorts-container');
      if (!container) return false;
      container.scrollBy({ top: container.clientHeight, behavior: 'smooth' });
      return true;
    }],
  ];

  function advance(reason) {
    if (advancing) return;
    advancing = true;

    const startUrl = location.href;
    const startVideo = getCurrentVideo();
    const startSrc = startVideo ? startVideo.src : null;

    // Try the strategy that worked last time first.
    const order = STRATEGIES.map((_, i) => (preferredStrategy + i) % STRATEGIES.length);

    const verified = () => {
      if (location.href !== startUrl) return true;
      const v = getCurrentVideo();
      return !!(v && startSrc && v.src !== startSrc);
    };

    const tryAt = (k) => {
      if (k >= order.length) {
        console.warn(LOG, `could not advance (${reason}); retrying in 3s`);
        advancing = false;
        setTimeout(() => { if (engaged && !advancing) advance('retry'); }, 3000);
        return;
      }
      const [name, fire] = STRATEGIES[order[k]];
      let fired = false;
      try { fired = fire(); } catch (_) { fired = false; }
      if (!fired) { tryAt(k + 1); return; }

      setTimeout(() => {
        if (verified()) {
          preferredStrategy = order[k];
          if (DEBUG) console.log(LOG, `advanced via "${name}" (${reason})`);
          advancing = false;
          if (engaged && location.href !== currentUrl) {
            currentUrl = location.href;
            resetForNewVideo();
          }
        } else {
          tryAt(k + 1);
        }
      }, 800);
    };

    tryAt(0);
  }

  // ---------- keyboard shortcuts: Q toggle, W skip ----------

  document.addEventListener('keydown', (e) => {
    if (!isShortsPage() || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
    const t = e.target;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
    if (e.key === 'q' || e.key === 'Q') {
      e.preventDefault();
      setRunning(!running);
    } else if ((e.key === 'w' || e.key === 'W') && engaged) {
      e.preventDefault();
      advance('hotkey');
    }
  });

  // ---------- overlay UI ----------

  function createOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'yt-autoscroll-overlay';

    const badge = document.createElement('div');
    badge.className = 'yt-as-badge';

    const icon = document.createElement('span');
    icon.className = 'yt-as-icon';
    icon.textContent = '▶';

    const countdown = document.createElement('span');
    countdown.className = 'yt-as-countdown';
    countdown.id = 'yt-as-countdown';

    badge.append(icon, countdown);
    overlay.appendChild(badge);
    overlay.title = 'Auto-scroll is on - click to stop (Q)';
    overlay.addEventListener('click', () => setRunning(false));
    document.body.appendChild(overlay);
  }

  function removeOverlay() {
    if (overlay) { overlay.remove(); overlay = null; }
  }

  function updateCountdown(seconds) {
    const el = document.getElementById('yt-as-countdown');
    if (el) el.textContent = seconds == null ? '…' : Math.ceil(seconds) + 's';
  }

  // ---------- voice control ----------

  function syncVoice() {
    const wanted = settings.voiceEnabled && isShortsPage();
    if (wanted && !voiceActive) startVoice();
    else if (!wanted && voiceActive) stopVoice();
  }

  function startVoice() {
    if (voiceActive) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 3;

    recognition.onstart = () => {
      voiceRestartDelay = 300;
      showVoiceBadge('Listening', false);
    };

    recognition.onresult = (event) => {
      const now = Date.now();
      if (now - lastCommandTime < COMMAND_COOLDOWN) return;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        for (let a = 0; a < result.length; a++) {
          const words = result[a].transcript.trim().toLowerCase().split(/\s+/);
          if (words.some((w) => SKIP_WORDS.includes(w))) {
            lastCommandTime = now;
            flashFeedback('Skip!');
            advance('voice');
            return;
          }
        }
      }
    };

    recognition.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        voiceActive = false;
        showVoiceBadge('Mic blocked', true);
      }
    };

    recognition.onend = () => {
      if (!voiceActive) return;
      // Chrome stops continuous recognition periodically; restart with backoff.
      voiceRestartDelay = Math.min(voiceRestartDelay * 2, 5000);
      setTimeout(() => {
        if (voiceActive) { try { recognition.start(); } catch (_) {} }
      }, voiceRestartDelay);
    };

    try {
      recognition.start();
      voiceActive = true;
    } catch (_) {}
  }

  function stopVoice() {
    voiceActive = false;
    if (recognition) {
      try { recognition.abort(); } catch (_) {}
      recognition = null;
    }
    document.getElementById('yt-as-voice-badge')?.remove();
  }

  function showVoiceBadge(text, isError) {
    let badge = document.getElementById('yt-as-voice-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'yt-as-voice-badge';
      document.body.appendChild(badge);
    }
    badge.textContent = '';
    const icon = document.createElement('span');
    icon.className = 'yt-as-mic-icon';
    icon.textContent = '\u{1F3A4}';
    badge.append(icon, document.createTextNode(' ' + text));
    badge.className = isError ? 'yt-as-voice-error' : 'yt-as-voice-active';
  }

  function flashFeedback(text) {
    let fb = document.getElementById('yt-as-voice-feedback');
    if (!fb) {
      fb = document.createElement('div');
      fb.id = 'yt-as-voice-feedback';
      document.body.appendChild(fb);
    }
    fb.textContent = text;
    fb.classList.remove('yt-as-flash');
    void fb.offsetWidth;
    fb.classList.add('yt-as-flash');
  }
})();
