# Security Assessment & Chrome Web Store Publishing Plan

Reviewed: 2026-07-17 (v2.0.0, all shipping files). **No code was changed during this
review** — items below are queued for a follow-up pass.

## Verdict

The extension is in good shape to publish. No data leaves the browser, there is no
remote code, no third-party libraries, no analytics, no fetch/XHR at all. The issues
found are small, and none of the fixes touch the scrolling logic that currently works.

---

## 1. Fix before publishing (small, safe, non-behavioral)

### 1.1 Popup URL check is spoofable — `popup/popup.js` (3 places)
`tab.url?.includes('youtube.com/shorts')` is a substring match, so a page like
`https://evil.com/youtube.com/shorts` passes it. Because opening the popup grants
`activeTab`, clicking Start/Skip there would inject our content scripts into that
page. Impact is low (the injected script does nothing sensitive and exposes no data),
but it is the one genuine loophole in the codebase and trivially fixed:

```js
function isShortsUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname === 'www.youtube.com' && u.pathname.startsWith('/shorts');
  } catch { return false; }
}
```
Use it in `init()`, the toggle handler, and the skip handler. No behavior change on
real YouTube pages.

### 1.2 Tighten manifest matches to HTTPS — `manifest.json` (both content_scripts)
`*://www.youtube.com/*` also matches `http:`. YouTube is HTTPS-only, so narrowing to
`https://www.youtube.com/*` loses nothing and reads better in review.

### 1.3 Rename: don't lead with "YouTube" (common store rejection)
Web Store branding policy disallows names that lead with someone else's trademark.
"YouTube Shorts Auto Scroller" risks a metadata rejection. Safe forms:
- **"Auto Scroller for YouTube Shorts"** (recommended — "for X" phrasing is accepted)
- "Shorts Auto Scroller"

Change `name` in manifest.json + the store listing title.

### 1.4 Package only shipping files
The ZIP must not contain `.git/`, `.claude/`, `PUBLISHING.md`, or `README.md`
(README is harmless but is dead weight). From the project root (PowerShell):

```powershell
New-Item -ItemType Directory -Force dist
Compress-Archive -Force -Path manifest.json, icons, content, popup -DestinationPath dist/auto-scroller-for-shorts-2.0.0.zip
```

`manifest.json` must sit at the ZIP root (the command above does that — do NOT zip
the parent folder).

---

## 2. Optional hardening (nice-to-have, not blocking)

- **innerHTML → DOM building** (`content.js`: overlay, voice badge). Every current
  assignment is a static string — no user or page data flows in — so there is no
  actual XSS path today. Swapping to `createElement`/`textContent` is purely for
  review optics and future-proofing.
- **Quiet the console.** `advance()` logs one line per scroll and a warn on failure.
  Consider `const DEBUG = false` gating the logs (keep the `console.warn`).
- **Sender check in onMessage.** By default only our own popup can message the
  content script (no `externally_connectable` declared), so this is redundant —
  but `if (_sender.id !== chrome.runtime.id) return;` is one line.
- **Leaner permissions (decision needed).** `scripting` + `activeTab` exist only so
  the popup can inject into YouTube tabs that were already open when the extension
  was installed/updated. Dropping both would shrink the permission warning and speed
  review; the cost is "reload your YouTube tab after installing" support questions.
  **Recommendation: keep them** and justify in the listing (text provided below).

## 3. Accepted / by design (reviewed, no action)

- **`ytas:next` bridge event is page-callable.** Any script on youtube.com could
  dispatch it to advance the reel — which the page can already do itself. It grants
  no privilege and exposes no data. Fine.
- **Voice audio goes to Chrome's speech service.** The Web Speech API sends audio to
  Google's recognizer — that's a browser behavior, not our code, but it must be
  *disclosed* (see privacy section below).
- **Voice can mis-trigger from video audio** (2 s cooldown limits it). Product quirk,
  not security.
- **Storage holds 5 primitive settings** (`interval`, `watchFull`, `randomize`,
  `voiceEnabled`, `running`). Nothing sensitive; `storage.local` only.
- Popup HTML has no inline scripts (MV3 CSP-clean); `.claude/settings.local.json`
  contains no secrets (excluded from ZIP anyway); icons are plain PNGs.

---

## 4. Chrome Web Store — step by step

1. **Developer account**: https://chrome.google.com/webstore/devconsole — sign in
   (haithem.obeidi@gmail.com or a dedicated publisher account) and pay the **one-time
   $5 registration fee**.
2. **Apply section 1 fixes**, bump nothing (2.0.0 is fine), build the ZIP (§1.4).
3. **New item** → upload the ZIP.
4. **Store listing tab**:
   - Title: "Auto Scroller for YouTube Shorts"
   - Summary (≤132 chars): e.g. "Hands-free YouTube Shorts: auto-advance when a video
     ends or on a timer, with hotkeys and voice control."
   - Description: features + hotkeys (Q/W) + how strategies work is not needed; keep
     it user-facing.
   - Category: Productivity (or Entertainment). Language: English.
   - **Screenshots: at least one, 1280×800 or 640×400** — grab the popup over a
     Shorts page. Small promo tile (440×280) recommended.
5. **Privacy practices tab** (this is what actually gates approval):
   - *Single purpose*: "Automatically advances to the next YouTube Short."
   - *Permission justifications*:
     - `storage` — "Saves the user's timing/voice settings locally."
     - `activeTab` + `scripting` — "Re-injects the controller into YouTube tabs that
       were already open when the extension was installed or updated, so the user
       doesn't have to reload them. Injection is limited to www.youtube.com Shorts
       pages."
     - Host (content script on www.youtube.com) — "Core function: detects when a
       Short ends and advances to the next one."
   - *Data collection*: declare **no user data collected/transmitted**.
   - *Microphone/voice disclosure*: state that the optional voice feature uses the
     browser's built-in Web Speech API (audio is processed by the browser's speech
     service, e.g. Google's); the extension itself never records, stores, or
     transmits audio, and the feature is off by default.
   - **Privacy policy URL — required** because of the mic feature. A one-paragraph
     policy hosted anywhere public works (GitHub repo README anchor, GitHub Pages,
     or a gist): what's above, plus "settings are stored locally and never leave
     the device."
6. **Distribution tab**: Public — or **Unlisted** if this is really just for you and
   friends (installable via link only, lighter scrutiny, can flip to Public later).
7. **Submit for review.** Typical wait is 1–3 days; mic-using extensions sometimes
   take longer. Rejections come with a reason and you just resubmit.

### For later updates
Bump `version` in manifest.json, re-zip, upload on the item's Package tab, resubmit.

---

## 5. Suggested order of work (next session)

1. Apply 1.1–1.3 (≈15 min, no functional risk) and re-test on a few Shorts.
2. Decide on §2 items (recommend: innerHTML swap + DEBUG flag; keep permissions).
3. Write the privacy policy paragraph, host it, note the URL.
4. Build ZIP, register, upload, fill listing + privacy tabs, submit.
