(() => {
  // Prevent duplicate injection - must be first
  if (window.__ytAutoScrollerLoaded) return;
  window.__ytAutoScrollerLoaded = true;

  let scrollTimer = null;
  let running = false;
  let settings = { interval: 10, watchFull: true, randomize: false, voiceEnabled: false };
  let overlay = null;
  let countdownInterval = null;
  let countdownSeconds = 0;

  // Sound detection state
  let audioContext = null;
  let micStream = null;
  let analyser = null;
  let soundDetectorRunning = false;
  let lastTriggerTime = 0;
  const TRIGGER_COOLDOWN = 1500; // ms between triggers
  const VOLUME_THRESHOLD = 0.4; // 0-1, how loud the snap/clap needs to be

  // Load saved state on injection
  chrome.storage.local.get(['running', 'interval', 'watchFull', 'randomize', 'voiceEnabled'], (data) => {
    if (data.interval != null) settings.interval = data.interval;
    if (data.watchFull != null) settings.watchFull = data.watchFull;
    if (data.randomize != null) settings.randomize = data.randomize;
    if (data.voiceEnabled != null) settings.voiceEnabled = data.voiceEnabled;
    if (data.running) start();
    if (settings.voiceEnabled) startSoundDetector();
  });

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'PING') {
      sendResponse({ ok: true });
      return;
    } else if (msg.type === 'START') {
      settings = { ...settings, ...msg.settings };
      start();
    } else if (msg.type === 'STOP') {
      stop();
    } else if (msg.type === 'SKIP') {
      scrollToNext();
    } else if (msg.type === 'SETTINGS_UPDATE') {
      const voiceWasEnabled = settings.voiceEnabled;
      settings = { ...settings, ...msg.settings };
      if (running) {
        clearScheduledScroll();
        scheduleNextScroll();
      }
      if (settings.voiceEnabled && !voiceWasEnabled) startSoundDetector();
      else if (!settings.voiceEnabled && voiceWasEnabled) stopSoundDetector();
    }
  });

  // Watch for manual navigation and video seek
  let lastUrl = location.href;
  let watchedVideo = null;

  const urlObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (running) {
        clearScheduledScroll();
        setTimeout(() => {
          watchCurrentVideo();
          scheduleNextScroll();
        }, 500);
      }
    }
  });
  urlObserver.observe(document.body, { childList: true, subtree: true });

  function watchCurrentVideo() {
    const video = getCurrentVideo();
    if (video === watchedVideo) return;

    if (watchedVideo) {
      watchedVideo.removeEventListener('seeked', onVideoSeeked);
      watchedVideo.removeEventListener('pause', onVideoPaused);
      watchedVideo.removeEventListener('play', onVideoResumed);
    }

    watchedVideo = video;
    if (!video) return;

    video.addEventListener('seeked', onVideoSeeked);
    video.addEventListener('pause', onVideoPaused);
    video.addEventListener('play', onVideoResumed);
  }

  function onVideoSeeked() {
    if (running) {
      clearScheduledScroll();
      scheduleNextScroll();
    }
  }

  function onVideoPaused() {
    if (running) {
      clearScheduledScroll();
    }
  }

  function onVideoResumed() {
    if (running) {
      scheduleNextScroll();
    }
  }

  setInterval(() => {
    if (running) watchCurrentVideo();
  }, 2000);

  // Keyboard shortcuts: Q to toggle auto-scroll, W to skip
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

    if (e.key === 'q' || e.key === 'Q') {
      e.preventDefault();
      if (running) stop(); else start();
      chrome.storage.local.set({ running });
    } else if (e.key === 'w' || e.key === 'W') {
      if (running) {
        e.preventDefault();
        scrollToNext();
      }
    }
  });

  function start() {
    running = true;
    createOverlay();
    scheduleNextScroll();
  }

  function stop() {
    running = false;
    clearScheduledScroll();
    removeOverlay();
  }

  function getInterval() {
    let interval = settings.interval;
    if (settings.randomize) {
      const variance = interval * 0.3;
      interval = interval - variance + Math.random() * variance * 2;
    }
    return Math.max(3, Math.round(interval));
  }

  function scheduleNextScroll() {
    clearScheduledScroll();

    const video = getCurrentVideo();

    if (video && video.paused) {
      const onPlay = () => {
        video.removeEventListener('play', onPlay);
        if (running) scheduleNextScroll();
      };
      video.addEventListener('play', onPlay);
      stopCountdown();
      return;
    }

    if (settings.watchFull) {
      if (video && video.duration && isFinite(video.duration)) {
        const remaining = video.duration - video.currentTime;
        if (remaining > 0.5) {
          const waitTime = (remaining + 0.5) * 1000;
          startCountdown(Math.ceil(remaining));
          scrollTimer = setTimeout(() => scrollToNext(), waitTime);
          return;
        }
      }
    }

    const interval = getInterval();
    startCountdown(interval);
    scrollTimer = setTimeout(() => scrollToNext(), interval * 1000);
  }

  function clearScheduledScroll() {
    if (scrollTimer) {
      clearTimeout(scrollTimer);
      scrollTimer = null;
    }
    stopCountdown();
  }

  function scrollToNext() {
    const nextButton = document.querySelector(
      '#navigation-button-down button, ' +
      'button[aria-label="Next video"], ' +
      '[id="navigation-button-down"] button'
    );

    if (nextButton) {
      nextButton.click();
    } else {
      const shortsContainer = document.querySelector(
        'ytd-shorts, #shorts-container, ytd-reel-video-renderer'
      );
      if (shortsContainer) {
        shortsContainer.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
      } else {
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'ArrowDown',
          code: 'ArrowDown',
          keyCode: 40,
          bubbles: true,
        }));
      }
    }

    if (running) {
      setTimeout(() => scheduleNextScroll(), 500);
    }
  }

  function getCurrentVideo() {
    const videos = document.querySelectorAll('video');
    for (const video of videos) {
      if (!video.paused && video.readyState >= 2) return video;
    }
    return videos[0] || null;
  }

  // -- Overlay UI --

  function createOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'yt-autoscroll-overlay';
    overlay.innerHTML = `
      <div class="yt-as-badge">
        <span class="yt-as-icon">&#9654;</span>
        <span class="yt-as-countdown" id="yt-as-countdown"></span>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', () => {
      stop();
      chrome.storage.local.set({ running: false });
    });
  }

  function removeOverlay() {
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
  }

  function startCountdown(seconds) {
    stopCountdown();
    countdownSeconds = seconds;
    updateCountdownDisplay();
    countdownInterval = setInterval(() => {
      countdownSeconds--;
      if (countdownSeconds <= 0) {
        stopCountdown();
      } else {
        updateCountdownDisplay();
      }
    }, 1000);
  }

  function stopCountdown() {
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
  }

  function updateCountdownDisplay() {
    const el = document.getElementById('yt-as-countdown');
    if (el) el.textContent = countdownSeconds + 's';
  }

  // -- Sound Detector (Clap/Snap) --

  async function startSoundDetector() {
    if (soundDetectorRunning) return;

    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.warn('[AutoScroller] Mic permission denied:', err);
      showSoundBadge('Mic denied', true);
      return;
    }

    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(micStream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.3;
    source.connect(analyser);

    soundDetectorRunning = true;
    showSoundBadge('Listening', false);

    startDetectLoop();
  }

  function stopSoundDetector() {
    soundDetectorRunning = false;

    if (detectInterval) {
      clearInterval(detectInterval);
      detectInterval = null;
    }
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      micStream = null;
    }
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
    analyser = null;

    const badge = document.getElementById('yt-as-voice-badge');
    if (badge) badge.remove();
  }

  let detectInterval = null;

  function startDetectLoop() {
    if (detectInterval) return;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    // Poll at ~10 times per second - plenty fast for claps, minimal CPU
    detectInterval = setInterval(() => {
      if (!soundDetectorRunning || !analyser) {
        clearInterval(detectInterval);
        detectInterval = null;
        return;
      }

      analyser.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const v = dataArray[i] / 255;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / dataArray.length);

      const now = Date.now();
      if (rms > VOLUME_THRESHOLD && (now - lastTriggerTime > TRIGGER_COOLDOWN)) {
        lastTriggerTime = now;
        flashFeedback('Skip!');
        scrollToNext();
      }
    }, 100);
  }

  function showSoundBadge(text, isError) {
    let badge = document.getElementById('yt-as-voice-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'yt-as-voice-badge';
      document.body.appendChild(badge);
    }
    badge.innerHTML = '<span class="yt-as-mic-icon">&#127908;</span> ' + text;
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
