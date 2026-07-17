// Runs in the page's MAIN world. YouTube's internal player API (nextVideo etc.)
// is only reachable from here, not from the isolated content-script world.
// The content script requests an advance by dispatching a DOM CustomEvent.
(() => {
  if (window.__ytasBridgeLoaded) return;
  window.__ytasBridgeLoaded = true;

  document.addEventListener('ytas:next', () => {
    try {
      const player =
        document.getElementById('shorts-player') ||
        document.getElementById('movie_player');
      if (player && typeof player.nextVideo === 'function') {
        player.nextVideo();
      }
    } catch (_) {
      // Player not ready or API changed - the content script's verification
      // step will fall through to the next strategy.
    }
  });
})();
