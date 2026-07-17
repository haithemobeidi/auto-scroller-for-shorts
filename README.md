# Auto Scroller for YouTube Shorts

Chrome extension (Manifest V3) that automatically scrolls through YouTube Shorts.

## Features

- **Auto-scroll** — advance when the video ends, or on a fixed timer (3–60 s, optional ±30% randomization).
- **Hotkeys** — on any Shorts page: `Q` toggles auto-scroll, `W` skips to the next Short.
- **Voice control** — say "skip" or "next" to advance (needs mic permission for youtube.com).
- **On-screen badge** — countdown overlay while running; click it to stop.

## Install (unpacked)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select this folder
4. Open any YouTube Short and press `Q` or use the popup

## How it advances (and why it keeps working)

YouTube changes its Shorts DOM frequently, so the extension tries several
strategies in order and **verifies** after each one that the Short actually
changed (URL or video src), remembering whichever worked:

1. Click the native "Next video" button (`#navigation-button-down`)
2. Call YouTube's internal player API (`player.nextVideo()`) via a MAIN-world bridge
3. Dispatch a synthetic `ArrowDown` key event
4. Scroll the snap container (`#shorts-container`) by one viewport

The content script is injected on all of `youtube.com` (not just `/shorts/*`)
because YouTube is a single-page app — navigating from the homepage to a Short
never triggers a page load, so narrower match patterns miss it. It stays
dormant until you're actually on a Shorts page.

## Files

- `manifest.json` — MV3 manifest
- `content/content.js` — main logic (isolated world)
- `content/bridge.js` — MAIN-world bridge to YouTube's player API
- `content/content.css` — overlay/badge styles
- `popup/` — toolbar popup UI
