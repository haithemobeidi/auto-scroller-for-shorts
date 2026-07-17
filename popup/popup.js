const intervalSlider = document.getElementById('interval');
const intervalValue = document.getElementById('intervalValue');
const watchFullCheckbox = document.getElementById('watchFull');
const randomizeCheckbox = document.getElementById('randomize');
const voiceCheckbox = document.getElementById('voiceEnabled');
const voiceStatus = document.getElementById('voiceStatus');
const toggleBtn = document.getElementById('toggleBtn');
const skipBtn = document.getElementById('skipBtn');
const statusIndicator = document.getElementById('statusIndicator');
const statusText = document.getElementById('statusText');

init();

function isShortsUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname === 'www.youtube.com' && u.pathname.startsWith('/shorts');
  } catch { return false; }
}

async function init() {
  const data = await chrome.storage.local.get([
    'interval', 'watchFull', 'randomize', 'voiceEnabled', 'running',
  ]);
  if (data.interval != null) {
    intervalSlider.value = data.interval;
    intervalValue.textContent = data.interval + 's';
  }
  if (data.watchFull != null) watchFullCheckbox.checked = data.watchFull;
  if (data.randomize != null) randomizeCheckbox.checked = data.randomize;
  if (data.voiceEnabled != null) voiceCheckbox.checked = data.voiceEnabled;
  voiceStatus.textContent = voiceCheckbox.checked ? 'Listening' : '';
  updateUI(data.running || false);

  // If we're not on a Shorts page, say so.
  const tab = await activeTab();
  if (!isShortsUrl(tab?.url)) {
    statusText.textContent = 'Not on Shorts';
  } else {
    await ensureContentScript(tab.id);
  }
}

// Slider live update
intervalSlider.addEventListener('input', () => {
  intervalValue.textContent = intervalSlider.value + 's';
});

// Settings persist to storage; the content script reacts via storage.onChanged.
function saveSettings() {
  voiceStatus.textContent = voiceCheckbox.checked ? 'Listening' : '';
  chrome.storage.local.set({
    interval: parseInt(intervalSlider.value, 10),
    watchFull: watchFullCheckbox.checked,
    randomize: randomizeCheckbox.checked,
    voiceEnabled: voiceCheckbox.checked,
  });
}

intervalSlider.addEventListener('change', saveSettings);
watchFullCheckbox.addEventListener('change', saveSettings);
randomizeCheckbox.addEventListener('change', saveSettings);
voiceCheckbox.addEventListener('change', saveSettings);

toggleBtn.addEventListener('click', async () => {
  const tab = await activeTab();
  if (!isShortsUrl(tab?.url)) {
    statusText.textContent = 'Not on Shorts';
    return;
  }
  await ensureContentScript(tab.id);
  const { running } = await chrome.storage.local.get('running');
  const newState = !running;
  await chrome.storage.local.set({ running: newState });
  updateUI(newState);
});

skipBtn.addEventListener('click', async () => {
  const tab = await activeTab();
  if (!isShortsUrl(tab?.url)) {
    statusText.textContent = 'Not on Shorts';
    return;
  }
  await ensureContentScript(tab.id);
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'SKIP' });
  } catch {
    // Content script still booting; retry once.
    await new Promise((r) => setTimeout(r, 200));
    await chrome.tabs.sendMessage(tab.id, { type: 'SKIP' });
  }
});

function updateUI(running) {
  if (running) {
    toggleBtn.textContent = 'Stop Auto';
    toggleBtn.classList.add('running');
    statusIndicator.classList.add('active');
    statusText.textContent = 'Running';
  } else {
    toggleBtn.textContent = 'Start Auto';
    toggleBtn.classList.remove('running');
    statusIndicator.classList.remove('active');
    statusText.textContent = 'Off';
  }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'PING' });
  } catch {
    // Content script not loaded (e.g. extension was just installed/reloaded).
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/content.js'],
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/bridge.js'],
      world: 'MAIN',
    });
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['content/content.css'],
    });
  }
}
