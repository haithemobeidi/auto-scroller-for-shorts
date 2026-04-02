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
  let recognition = null;
  let voiceActive = false;
  let lastVoiceCommandTime = 0;

  // Voice commands mapped to actions
  const VOICE_COMMANDS = {
    skip: ['next', 'skip', 'scroll', 'swipe'],
    start: ['start', 'play', 'go', 'begin'],
    stop: ['stop', 'pause', 'end', 'halt'],
  };

  // Load saved state on injection
  chrome.storage.local.get(['running', 'interval', 'watchFull', 'randomize', 'voiceEnabled'], (data) => {
    if (data.interval != null) settings.interval = data.interval;
    if (data.watchFull != null) settings.watchFull = data.watchFull;
    if (data.randomize != null) settings.randomize = data.randomize;
    if (data.voiceEnabled != null) settings.voiceEnabled = data.voiceEnabled;
    if (data.running) start();
    if (settings.voiceEnabled) startVoice();
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
      if (settings.voiceEnabled && !voiceWasEnabled) startVoice();
      else if (!settings.voiceEnabled && voiceWasEnabled) stopVoice();
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

  // Attach seek/pause/play listeners to the current video
  function watchCurrentVideo() {
    const video = getCurrentVideo();
    if (video === watchedVideo) return;

    // Clean up old listeners
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

  // Periodically check if the video element changed (YT recycles them)
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

    // If the video is paused, wait for it to resume before scheduling
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

  // -- Voice Control --

  function startVoice() {
    if (voiceActive) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('[AutoScroller] SpeechRecognition API not available');
      showVoiceStatus('Not supported');
      return;
    }

    // Request mic permission explicitly first
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then((stream) => {
        // Got permission - stop the stream (SpeechRecognition manages its own)
        stream.getTracks().forEach((t) => t.stop());
        initRecognition(SpeechRecognition);
      })
      .catch((err) => {
        console.warn('[AutoScroller] Mic permission denied:', err);
        showVoiceStatus('Mic denied');
      });
  }

  function initRecognition(SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 3;

    recognition.onstart = () => {
      console.log('[AutoScroller] Voice listening...');
      showVoiceBadge(true);
    };

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        for (let alt = 0; alt < result.length; alt++) {
          const transcript = result[alt].transcript.trim().toLowerCase();
          console.log('[AutoScroller] Heard:', JSON.stringify(transcript), 'confidence:', result[alt].confidence.toFixed(2), result.isFinal ? '(final)' : '(interim)');
          // Show what was heard on the badge
          updateVoiceBadgeText(transcript);
          if (handleVoiceCommand(transcript)) return;
        }
      }
    };

    recognition.onaudiostart = () => {
      console.log('[AutoScroller] Audio capture started');
    };

    recognition.onspeechstart = () => {
      console.log('[AutoScroller] Speech detected');
    };

    recognition.onsoundstart = () => {
      console.log('[AutoScroller] Sound detected');
    };

    // Auto-restart on end (browser kills continuous after ~60s of silence)
    recognition.onend = () => {
      console.log('[AutoScroller] Recognition ended, restarting...');
      if (voiceActive) {
        setTimeout(() => {
          if (voiceActive && recognition) {
            try { recognition.start(); } catch {}
          }
        }, 500);
      }
    };

    recognition.onerror = (e) => {
      console.warn('[AutoScroller] Voice error:', e.error);
      if (e.error === 'not-allowed') {
        showVoiceStatus('Mic blocked');
        stopVoice();
      }
      // 'no-speech' and 'aborted' are normal - onend will restart
    };

    try {
      recognition.start();
      voiceActive = true;
    } catch (err) {
      console.warn('[AutoScroller] Could not start recognition:', err);
      showVoiceStatus('Error');
    }
  }

  function stopVoice() {
    voiceActive = false;
    if (recognition) {
      try { recognition.abort(); } catch {}
      recognition = null;
    }
    showVoiceBadge(false);
  }

  function handleVoiceCommand(transcript) {
    // Debounce - ignore commands within 1.5s of the last one
    const now = Date.now();
    if (now - lastVoiceCommandTime < 1500) return false;

    const words = transcript.split(/\s+/);

    for (const word of words) {
      if (VOICE_COMMANDS.skip.includes(word)) {
        lastVoiceCommandTime = now;
        flashVoiceFeedback('Skip!');
        scrollToNext();
        return true;
      }
      if (VOICE_COMMANDS.start.includes(word)) {
        lastVoiceCommandTime = now;
        flashVoiceFeedback('Starting');
        if (!running) {
          start();
          chrome.storage.local.set({ running: true });
        }
        return true;
      }
      if (VOICE_COMMANDS.stop.includes(word)) {
        lastVoiceCommandTime = now;
        flashVoiceFeedback('Stopping');
        if (running) {
          stop();
          chrome.storage.local.set({ running: false });
        }
        return true;
      }
    }
    return false;
  }

  function showVoiceBadge(active) {
    let badge = document.getElementById('yt-as-voice-badge');
    if (active) {
      if (!badge) {
        badge = document.createElement('div');
        badge.id = 'yt-as-voice-badge';
        document.body.appendChild(badge);
      }
      badge.innerHTML = '<span class="yt-as-mic-icon">&#127908;</span> Listening';
      badge.className = 'yt-as-voice-active';
    } else if (badge) {
      badge.remove();
    }
  }

  function updateVoiceBadgeText(text) {
    const badge = document.getElementById('yt-as-voice-badge');
    if (badge) {
      badge.innerHTML = '<span class="yt-as-mic-icon">&#127908;</span> "' + text + '"';
    }
  }

  function showVoiceStatus(text) {
    let badge = document.getElementById('yt-as-voice-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'yt-as-voice-badge';
      document.body.appendChild(badge);
    }
    badge.innerHTML = '<span class="yt-as-mic-icon">&#127908;</span> ' + text;
    badge.className = 'yt-as-voice-error';
    setTimeout(() => { if (badge) badge.remove(); }, 4000);
  }

  function flashVoiceFeedback(text) {
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
