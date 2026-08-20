/* Keep the page sign-language video aligned with the ADT read-aloud control. */
(() => {
  // Enable the built-in sign-language panel before the reader runtime starts.
  try { localStorage.setItem("signLanguageMode", "true"); } catch (_) {}

  let narrationStarted = false;
  let pauseTimer = null;

  const signVideo = () => [...document.querySelectorAll("video")].find(video =>
    /content\/i18n\/[^/]+\/video\//.test(video.currentSrc || video.src)
  );

  const pauseVideo = () => {
    const video = signVideo();
    if (video && !video.paused) video.pause();
  };

  const startVideo = () => {
    const video = signVideo();
    if (!video) return;
    if (!narrationStarted) {
      narrationStarted = true;
      try { video.currentTime = 0; } catch (_) {}
    }
    video.play().catch(() => {});
  };

  document.addEventListener("play", event => {
    if (!(event.target instanceof HTMLAudioElement)) return;
    clearTimeout(pauseTimer);
    startVideo();
  }, true);

  document.addEventListener("pause", event => {
    if (!(event.target instanceof HTMLAudioElement)) return;
    // Short gaps occur between individual read-aloud items; do not break video
    // continuity while the next item starts.
    pauseTimer = setTimeout(() => {
      if (![...document.querySelectorAll("audio")].some(audio => !audio.paused)) pauseVideo();
    }, 300);
  }, true);

  // The ADT's narration player uses Web Audio rather than a visible <audio>
  // element. Mirror its own controls as well, so video still starts and pauses
  // at the same moment on every supported browser.
  document.addEventListener("click", event => {
    const control = event.target.closest("button");
    const label = control?.getAttribute("aria-label") || "";
    if (/activate text to speech|^play$/i.test(label)) {
      clearTimeout(pauseTimer);
      setTimeout(startVideo, 0);
    } else if (/^pause$|^stop$|deactivate text to speech/i.test(label)) {
      clearTimeout(pauseTimer);
      pauseVideo();
    }
  }, true);

  new MutationObserver(() => {
    const video = signVideo();
    if (video && !narrationStarted) pauseVideo();
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
