# Privacy Policy — Auto Scroller for YouTube Shorts

_Last updated: 2026-07-17_

**Single purpose:** Auto Scroller for YouTube Shorts automatically advances to
the next YouTube Short — when the current video ends, on a timer, or on a
voice/hotkey command.

## Data collection

This extension collects, stores, or transmits **no personal data of any
kind**. There is no analytics, no remote server, and no network request made
by the extension's code.

Your settings — scroll interval, whether to wait for the video to finish,
randomization, and whether voice control is on — are saved with Chrome's
`storage.local` API. This data stays on your device and is never sent
anywhere. Uninstalling the extension deletes it.

## Voice control and microphone access

Voice control is **off by default**. If you turn it on, the extension uses
your browser's built-in Web Speech API to listen for the words "skip" or
"next" while you're on a YouTube Shorts page. Audio captured this way is
processed by your browser's speech-recognition service (for Chrome, that's
Google's) according to [Google's own privacy policy](https://policies.google.com/privacy) —
this extension itself never records, stores, or transmits any audio. Turning
voice control off stops the microphone from being used.

## Permissions

- **storage** — saves your settings locally, as described above.
- **activeTab** / **scripting** — used only to re-inject the controller into
  a YouTube Shorts tab that was already open when the extension was
  installed or updated, so you don't have to reload it. This never runs on
  any site other than `www.youtube.com`.
- **Host access to youtube.com** — required for the core function: detecting
  when a Short ends and advancing to the next one.

## Changes

If this policy changes, the updated version will be posted at this same URL
with a new "last updated" date.

## Contact

Questions about this policy: open an issue at
https://github.com/haithemobeidi/auto-scroller-for-shorts/issues
