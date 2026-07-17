# Handoff — 2026-07-17 publishing session

Status: **v2.0.0 submitted to the Chrome Web Store for review** (submitted today).
Everything below is context for whoever picks this up next — same session or a new one.

## What changed today

- **Security/review fixes** (from `PUBLISHING.md` §1):
  - `popup/popup.js` — replaced spoofable `url.includes('youtube.com/shorts')` checks
    with a real `URL()` parse (`isShortsUrl()`).
  - `manifest.json` — content script matches tightened to `https://www.youtube.com/*`.
  - Renamed the extension **"Auto Scroller for YouTube Shorts"** (was "YouTube Shorts
    Auto Scroller" — Chrome policy disallows leading with someone else's trademark).
- **Optional hardening** (`PUBLISHING.md` §2): overlay/voice badge now build DOM nodes
  instead of `innerHTML`; added a `DEBUG` flag gating the one `console.log`; added a
  sender check in the `onMessage` listener.
- **New icon** (`icons/icon16.png`, `icon48.png`, `icon128.png`): red gradient circle
  with a double-chevron-down glyph (replaces the old flat triangle). Generator script:
  `scripts/make_icons.py` (needs Pillow — `pip install pillow`, already on this
  machine).
- **Ko-fi support link** in the popup footer: `https://ko-fi.com/seriousbeans`.
- **`PRIVACY.md`** — required because of the optional voice/mic feature. Hosted at
  `https://github.com/haithemobeidi/auto-scroller-for-shorts/blob/main/PRIVACY.md`.
  Contact method is GitHub Issues on that repo (user's choice, not email).
- **New GitHub repo** (public): `https://github.com/haithemobeidi/auto-scroller-for-shorts`,
  pushed via `gh repo create ... --push`. This exists *only* so the privacy policy has
  a public URL — treat it as the canonical remote for this project going forward.
- **Store assets**: `store-assets/screenshot-1-1280x800.png` — composited screenshot
  (video frame + synthesized countdown badge + real popup UI, drop shadows, dark
  canvas), exactly 1280×800, RGB, no alpha. Built by `scripts/make_screenshot.py`.
  It's a composite, not a raw screenshot — see that script if it needs regenerating
  with a different video/state.
- **Chrome Web Store submission**: filled in Store Listing + Privacy Practices tabs
  manually (title, summary, permission justifications, single purpose, "no data
  collected" certification, privacy policy URL) and submitted for review.

## Monetization decision

Discussed charging $1–2 (possibly a free-auto-skip / paid-voice-control split).
**Decision: ship free, with the Ko-fi link as a soft tip jar. No paid gating built.**
Rationale: Chrome Web Store dropped its own payments system in 2021, so any real
paid tier means integrating a third-party processor (ExtensionPay, Stripe) plus a
license check — real engineering for an unproven, niche feature. Revisit only if
there's actual demand once this has real installs/reviews. If it does happen, the
user already has a Stripe account (used for another app) they're fine reusing —
just double-check the Stripe statement descriptor doesn't show the other app's name
on a supporter's card statement.

## Pending change (not yet shipped) — voice false-positive fix (2026-07-17)

After submitting v2.0.0, tightened voice control so the video's own audio stops
tripping a skip (`content/content.js`). The mic physically hears the speakers, so
this can't be eliminated — the fix makes the *matcher* stricter instead:
- Trimmed `SKIP_WORDS` to `['next','skip','scroll','swipe']` (dropped the phonetic
  noise `nex`/`neck`/`text`/`mix` that collides with normal speech).
- Only acts on **short, standalone utterances** (≤2 words; interim guesses must be a
  single word). Video dialogue arrives as full sentences and is now ignored.
- `maxAlternatives` 3 → 1; only the top guess is checked.

Verified with a logic test (scratchpad `match_test.js`): 8/8 sample dialogue lines
that used to false-fire now don't, 4/4 real commands still work. **Not yet tested
live with a real mic + speaker.** This is queued for the next store version — bump
`manifest.json` to **2.0.1**, rebuild the ZIP, and upload once the v2.0.0 review
resolves (don't upload over an in-review item).

## If you need to update the extension later

1. Bump `version` in `manifest.json`.
2. Rebuild the ZIP (PowerShell, from repo root):
   ```powershell
   Compress-Archive -Force -Path manifest.json, icons, content, popup -DestinationPath dist/auto-scroller-for-shorts-<version>.zip
   ```
3. Upload on the Developer Console's **Package** tab, update the store listing if
   needed, resubmit.
4. Commit + push to the GitHub repo (`git push`, remote `origin` already set).

## Environment quirks worth knowing

- **Chrome blocks browser automation entirely on `chrome.google.com/webstore/*`**
  (gallery + dev console) — can't screenshot, click, or type there via the Claude in
  Chrome tools. That whole flow has to be manual; the assistant can only hand over
  copy-paste text and interpret screenshots you send back.
- The dev console also forced a Google re-auth ("Verify it's you") mid-session —
  another manual, password-gated step automation can't do.
- This machine's monitor is ultrawide (3440×1295) and the `resize_window` browser
  tool didn't actually resize it — screenshots taken directly on a live YouTube tab
  come out with the on-page badge tiny/tucked in a corner. That's why the store
  screenshot is a composite built from cropped pieces rather than one raw capture.
- Don't drive browser automation in a tab the user is actively using (e.g. their
  in-progress Store Listing form) — open a fresh tab instead. Came up once this
  session when a resize/click interrupted active work.

## Key links

- Repo: https://github.com/haithemobeidi/auto-scroller-for-shorts
- Privacy policy: https://github.com/haithemobeidi/auto-scroller-for-shorts/blob/main/PRIVACY.md
- Ko-fi: https://ko-fi.com/seriousbeans
- Store screenshot source: `store-assets/screenshot-1-1280x800.png`
