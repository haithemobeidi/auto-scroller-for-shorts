const intervalSlider = document.getElementById('interval');
const intervalValue = document.getElementById('intervalValue');
const watchFullCheckbox = document.getElementById('watchFull');
const randomizeCheckbox = document.getElementById('randomize');
const voiceCheckbox = document.getElementById('voiceEnabled');
const toggleBtn = document.getElementById('toggleBtn');
const skipBtn = document.getElementById('skipBtn');
const statusIndicator = document.getElementById('statusIndicator');
const statusText = document.getElementById('statusText');

// Load saved settings
chrome.storage.local.get(['interval', 'watchFull', 'randomize', 'running', 'voiceEnabled'], (data) => {
  if (data.interval != null) {
    intervalSlider.value = data.interval;
    intervalValue.textContent = data.interval + 's';
  }
  if (data.watchFull != null) watchFullCheckbox.checked = data.watchFull;
  if (data.randomize != null) randomizeCheckbox.checked = data.randomize;
  if (data.voiceEnabled != null) voiceCheckbox.checked = data.voiceEnabled;
  updateUI(data.running || false);
});

// Slider live update
intervalSlider.addEventListener('input', () => {
  intervalValue.textContent = intervalSlider.value + 's';
});

// Save settings on change
function saveSettings() {
  const settings = {
    interval: parseInt(intervalSlider.value),
    watchFull: watchFullCheckbox.checked,
    randomize: randomizeCheckbox.checked,
    voiceEnabled: voiceCheckbox.checked,
  };
  chrome.storage.local.set(settings);
  sendToContent({ type: 'SETTINGS_UPDATE', settings });
}

intervalSlider.addEventListener('change', saveSettings);
watchFullCheckbox.addEventListener('change', saveSettings);
randomizeCheckbox.addEventListener('change', saveSettings);
voiceCheckbox.addEventListener('change', saveSettings);

// Toggle auto-scroll
toggleBtn.addEventListener('click', () => {
  chrome.storage.local.get('running', (data) => {
    const newState = !data.running;
    chrome.storage.local.set({ running: newState });
    updateUI(newState);

    const settings = {
      interval: parseInt(intervalSlider.value),
      watchFull: watchFullCheckbox.checked,
      randomize: randomizeCheckbox.checked,
    };
    sendToContent({
      type: newState ? 'START' : 'STOP',
      settings,
    });
  });
});

// Skip current video
skipBtn.addEventListener('click', () => {
  sendToContent({ type: 'SKIP' });
});

function updateUI(running) {
  if (running) {
    toggleBtn.textContent = 'Stop';
    toggleBtn.classList.add('running');
    statusIndicator.classList.add('active');
    statusText.textContent = 'Running';
  } else {
    toggleBtn.textContent = 'Start';
    toggleBtn.classList.remove('running');
    statusIndicator.classList.remove('active');
    statusText.textContent = 'Inactive';
  }
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'PING' });
  } catch {
    // Content script not loaded — inject it
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/content.js'],
    });
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['content/content.css'],
    });
  }
}

async function sendToContent(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  if (!tab.url?.includes('youtube.com/shorts')) {
    statusText.textContent = 'Not on Shorts';
    return;
  }

  await ensureContentScript(tab.id);
  try {
    await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    // Retry once after a brief delay for script to initialize
    await new Promise((r) => setTimeout(r, 200));
    await chrome.tabs.sendMessage(tab.id, message);
  }
}
