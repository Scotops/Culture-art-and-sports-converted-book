/* Keep the page sign-language video aligned with the ADT read-aloud control. */
(() => {
  // Enable both panels before the reader runtime starts. The reader's own
  // autoplay setting then starts narration without the learner having to
  // reset the sound panel; the actual narration start triggers the matching
  // page video below.
  const enableAtStartup = key => {
    try { localStorage.setItem(key, "true"); } catch (_) {}
    // The reader falls back to cookies if storage is unavailable, so preserve
    // the same startup state in both supported stores.
    try { document.cookie = `${key}=true; path=/; max-age=31536000`; } catch (_) {}
  };
  enableAtStartup("signLanguageMode");
  enableAtStartup("readAloudMode");

  let narrationStarted = false;
  let narrationRequested = false;
  let pauseTimer = null;
  let narrationAudio = null;
  const trackedNarrations = new WeakSet();

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

  // The ADT creates its narration with `new Audio`, which is not attached to
  // the page DOM. Hook the native media methods before the reader runtime is
  // loaded, so the sign video follows the actual narration media rather than
  // merely following a button click.
  const nativePlay = HTMLMediaElement.prototype.play;
  const nativePause = HTMLMediaElement.prototype.pause;
  const isNarrationAudio = media => media instanceof HTMLAudioElement &&
    /\/content\/i18n\/[^/]+\/audio\//.test(media.currentSrc || media.src);

  HTMLMediaElement.prototype.play = function (...args) {
    const result = nativePlay.apply(this, args);
    if (isNarrationAudio(this)) {
      narrationAudio = this;
      narrationRequested = true;
      if (!trackedNarrations.has(this)) {
        trackedNarrations.add(this);
        this.addEventListener("ended", () => {
          // A following item normally begins immediately. Only stop the video
          // when this was the final narration item.
          pauseTimer = setTimeout(() => {
            if (narrationAudio === this && this.paused) {
              narrationRequested = false;
              narrationStarted = false;
              pauseVideo();
            }
          }, 1500);
        });
      }
      Promise.resolve(result).then(() => {
        clearTimeout(pauseTimer);
        // The reader sets its internal mode to "text to speech" immediately
        // after narration begins, and that built-in mode change pauses the
        // sign panel. Start on the next frame after that pause so narration
        // and signing run together instead of cancelling one another.
        setTimeout(startVideo, 80);
      }).catch(() => {});
    }
    return result;
  };

  HTMLMediaElement.prototype.pause = function (...args) {
    // The stock reader tries to pause its sign panel whenever it changes to
    // text-to-speech mode. While narration is genuinely playing, ignore that
    // internal mode pause; an actual narration pause is handled below.
    if (this instanceof HTMLVideoElement && this === signVideo() &&
      (narrationRequested || (narrationAudio && !narrationAudio.paused))) {
      return;
    }
    const result = nativePause.apply(this, args);
    if (isNarrationAudio(this)) {
      pauseTimer = setTimeout(() => {
        if (narrationAudio?.paused) {
          pauseVideo();
          if (narrationAudio.ended) narrationStarted = false;
        }
      // A completed segment is immediately replaced by the next narrated
      // segment. Leave a generous hand-off window so video stays continuous
      // while the next audio file is prepared; a manual pause stops at once.
      }, this.ended ? 1500 : 80);
    }
    return result;
  };

  document.addEventListener("play", event => {
    if (!(event.target instanceof HTMLAudioElement)) return;
    clearTimeout(pauseTimer);
    startVideo();
  }, true);

  // Starting the video from the reader's own Play click gives it the same
  // user gesture as the narration. This prevents an initially visible video
  // from remaining paused until the sign panel is hidden and shown again.
  document.addEventListener("click", event => {
    const button = event.target instanceof Element
      ? event.target.closest("button[aria-label]")
      : null;
    const label = button?.getAttribute("aria-label") || "";
    if (label === "Play" || /Activate text to speech/i.test(label)) {
      narrationRequested = true;
      startVideo();
      setTimeout(startVideo, 100);
    }
    if (label === "Stop" || /Deactivate text to speech/i.test(label)) {
      narrationRequested = false;
      narrationStarted = false;
      pauseVideo();
    }
  }, true);

  document.addEventListener("pause", event => {
    if (!(event.target instanceof HTMLAudioElement)) return;
    // Short gaps occur between individual read-aloud items; do not break video
    // continuity while the next item starts.
    pauseTimer = setTimeout(() => {
      if (![...document.querySelectorAll("audio")].some(audio => !audio.paused)) pauseVideo();
    }, 300);
  }, true);

  new MutationObserver(() => {
    const video = signVideo();
    if (video && !narrationStarted) pauseVideo();
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
