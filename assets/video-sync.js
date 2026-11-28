/* Keep narration and the page's muted sign-language interpretation together. */
(() => {
  "use strict";

  const YEAR = 31536000;
  const PLAYER_TOOLBAR_HEIGHT = 24;
  const MAX_PLAYER_WIDTH = 360;
  let signClone = null;
  let narrationRequested = false;
  let narrationAudio = null;
  let pauseTimer = null;
  let pendingNarrationStart = null;
  let pendingNarrationTimer = null;
  let signManuallyPaused = false;
  const trackedNarrations = new WeakSet();

  const nativePlay = HTMLMediaElement.prototype.play;
  const nativePause = HTMLMediaElement.prototype.pause;

  const installVideoVisibilityRule = () => {
    if (document.getElementById("adt-synchronized-sign-video-style")) return;
    const style = document.createElement("style");
    style.id = "adt-synchronized-sign-video-style";
    style.textContent = `
      video[data-sign-language-source="true"]:not([data-sign-language-clone="true"]) {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
      [data-sign-language-player="true"],
      [data-sign-language-player] {
        background: #172033 !important;
        width: var(--adt-sign-player-width, 360px) !important;
        height: var(--adt-sign-player-height, 227px) !important;
      }
      [data-sign-language-host="true"] {
        display: block !important;
        overflow: hidden !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  };

  const setReaderMode = key => {
    try { localStorage.setItem(key, "true"); } catch (_) {}
    try { document.cookie = `${key}=true; path=/; max-age=${YEAR}`; } catch (_) {}
  };
  const sessionHasStarted = () => {
    try { return sessionStorage.getItem("adtNarrationStarted") === "true"; } catch (_) { return false; }
  };
  const markSessionStarted = () => {
    try { sessionStorage.setItem("adtNarrationStarted", "true"); } catch (_) {}
  };

  setReaderMode("signLanguageMode");
  setReaderMode("readAloudMode");
  installVideoVisibilityRule();

  const isSourceVideo = media => media instanceof HTMLVideoElement &&
    /\/content\/i18n\/[^/]+\/video\/page_\d+\.mp4(?:[?#]|$)/.test(media.currentSrc || media.src || "") &&
    !media.dataset.signLanguageClone;
  const isNarrationAudio = media => media instanceof HTMLAudioElement &&
    /\/content\/i18n\/[^/]+\/audio\//.test(media.currentSrc || media.src || "");

  const sizePlayer = (source, host) => {
    const player = source.parentElement;
    if (!player) return;
    const viewportWidth = window.visualViewport?.width || window.innerWidth;
    const width = Math.max(280, Math.min(MAX_PLAYER_WIDTH, viewportWidth - 16));
    const ratio = source.videoWidth && source.videoHeight ? source.videoHeight / source.videoWidth : 9 / 16;
    const videoHeight = Math.round(width * ratio);
    player.style.setProperty("--adt-sign-player-width", `${width}px`);
    player.style.setProperty("--adt-sign-player-height", `${PLAYER_TOOLBAR_HEIGHT + videoHeight}px`);
    if (!player.dataset.adtSignPositioned) {
      player.dataset.adtSignPositioned = "true";
      player.style.top = viewportWidth < 768 ? "8px" : "16px";
      player.style.right = viewportWidth < 768 ? "8px" : "16px";
      player.style.bottom = "auto";
      player.style.left = "auto";
    }
    host.style.height = `${videoHeight}px`;
    window.dispatchEvent(new Event("resize"));
  };

  const buildAccessiblePlayer = (source, clone, host) => {
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host { display: block; width: 100%; height: 100%; }
      video {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: contain;
        background: #000;
      }
    `;
    clone.controls = true;
    clone.setAttribute("controls", "");
    clone.setAttribute("aria-label", "Tanzanian Sign Language interpretation for this page");
    root.append(style, clone);

    clone.addEventListener("loadedmetadata", () => {
      sizePlayer(source, host);
    });
    clone.addEventListener("play", () => {
      signManuallyPaused = false;
      if (narrationAudio?.paused && !narrationAudio.ended) {
        nativePlay.call(narrationAudio).catch(() => {});
      }
    });
    clone.addEventListener("pause", () => {
      if (!clone.ended && narrationAudio && !narrationAudio.paused) {
        signManuallyPaused = true;
        nativePause.call(narrationAudio);
      }
    });
    clone.addEventListener("seeking", () => {
      signManuallyPaused = true;
      if (narrationAudio && !narrationAudio.paused) nativePause.call(narrationAudio);
      if (!clone.paused) nativePause.call(clone);
    });
    sizePlayer(source, host);
    return clone;
  };

  const playSignVideo = () => {
    if (!signClone || signManuallyPaused) return;
    nativePlay.call(signClone).catch(() => {});
  };
  const pauseSignVideo = () => {
    if (signClone) nativePause.call(signClone);
  };

  const trackNarration = audio => {
    narrationAudio = audio;
    narrationRequested = true;
    if (trackedNarrations.has(audio)) return;
    trackedNarrations.add(audio);
    audio.addEventListener("ended", () => {
      pauseTimer = setTimeout(() => {
        if (narrationAudio === audio && audio.paused) {
          narrationRequested = false;
          pauseSignVideo();
        }
      }, 1500);
    });
  };

  const monitorNarrationStart = (audio, result) => {
    Promise.resolve(result).then(() => {
      clearTimeout(pauseTimer);
      playSignVideo();
    }).catch(() => {
      if (narrationAudio === audio) {
        narrationRequested = false;
        pauseSignVideo();
        try { signClone.currentTime = 0; } catch (_) {}
      }
    });
    return result;
  };

  const startNarrationAndVideo = (audio, args) => {
    trackNarration(audio);
    if (signManuallyPaused) return Promise.resolve();
    const result = nativePlay.apply(audio, args);
    playSignVideo();
    return monitorNarrationStart(audio, result);
  };

  const flushPendingNarration = () => {
    if (!pendingNarrationStart) return;
    const pending = pendingNarrationStart;
    pendingNarrationStart = null;
    clearTimeout(pendingNarrationTimer);
    const result = startNarrationAndVideo(pending.audio, pending.args);
    Promise.resolve(result).then(pending.resolve, pending.reject);
  };

  const queueNarrationUntilVideo = (audio, args) => {
    trackNarration(audio);
    if (pendingNarrationStart?.audio === audio) return pendingNarrationStart.promise;
    if (pendingNarrationStart) {
      pendingNarrationStart.reject(new DOMException("Narration changed before playback began.", "AbortError"));
      clearTimeout(pendingNarrationTimer);
    }
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    pendingNarrationStart = { audio, args, promise, resolve, reject };
    pendingNarrationTimer = setTimeout(flushPendingNarration, 2500);
    return promise;
  };

  const createIndependentVideo = source => {
    if (!isSourceVideo(source) || source.dataset.signLanguageSource) return;
    source.dataset.signLanguageSource = "true";
    source.defaultMuted = true;
    source.muted = true;
    source.volume = 0;
    source.pause();
    source.removeAttribute("autoplay");
    source.hidden = true;
    source.setAttribute("aria-hidden", "true");
    source.tabIndex = -1;
    source.style.display = "none";

    const clone = source.cloneNode(true);
    clone.dataset.signLanguageClone = "true";
    clone.defaultMuted = true;
    clone.muted = true;
    clone.volume = 0;
    clone.setAttribute("muted", "");
    clone.hidden = false;
    clone.removeAttribute("aria-hidden");
    clone.removeAttribute("tabindex");
    clone.removeAttribute("autoplay");
    clone.setAttribute("controls", "");
    clone.playsInline = true;
    clone.style.display = "block";

    const host = document.createElement("div");
    host.dataset.signLanguageHost = "true";
    host.style.width = "100%";
    host.setAttribute("aria-label", "Tanzanian Sign Language video player");
    source.insertAdjacentElement("afterend", host);
    signClone = clone;
    buildAccessiblePlayer(source, clone, host);
    clone.load();
    if (document.body?.hasAttribute("data-cover-page")) playSignVideo();
    flushPendingNarration();
  };

  const scan = root => {
    if (root instanceof HTMLVideoElement) createIndependentVideo(root);
    if (root?.querySelectorAll) root.querySelectorAll("video").forEach(createIndependentVideo);
  };

  HTMLMediaElement.prototype.play = function (...args) {
    if (isSourceVideo(this)) {
      createIndependentVideo(this);
      return Promise.resolve();
    }
    if (isNarrationAudio(this)) {
      return signClone
        ? startNarrationAndVideo(this, args)
        : queueNarrationUntilVideo(this, args);
    }
    return nativePlay.apply(this, args);
  };
  HTMLMediaElement.prototype.pause = function (...args) {
    if (isSourceVideo(this)) return;
    if (isNarrationAudio(this) && pendingNarrationStart?.audio === this) {
      const pending = pendingNarrationStart;
      pendingNarrationStart = null;
      clearTimeout(pendingNarrationTimer);
      narrationRequested = false;
      pending.reject(new DOMException("Narration was paused before playback began.", "AbortError"));
    }
    const result = nativePause.apply(this, args);
    if (isNarrationAudio(this)) {
      pauseTimer = setTimeout(() => {
        if (narrationAudio?.paused) pauseSignVideo();
      }, this.ended ? 1500 : 80);
    }
    return result;
  };

  document.addEventListener("click", event => {
    const button = event.target instanceof Element
      ? event.target.closest("button[aria-label]") : null;
    const label = button?.getAttribute("aria-label") || "";
    if (label === "Play" && event.isTrusted) {
      markSessionStarted();
      narrationRequested = true;
      signManuallyPaused = false;
    }
    if (label === "Stop" || /Deactivate text to speech/i.test(label)) {
      narrationRequested = false;
      signManuallyPaused = true;
      pauseSignVideo();
    }
  }, true);

  const resumeFollowingPage = () => {
    if (!sessionHasStarted()) return;
    let tries = 0;
    const resume = () => {
      const play = [...document.querySelectorAll("button[aria-label]")]
        .find(button => button.getAttribute("aria-label") === "Play");
      if (play && !play.disabled) { play.click(); return; }
      if (++tries < 30) setTimeout(resume, 150);
    };
    setTimeout(resume, 100);
  };

  scan(document);
  new MutationObserver(records => {
    records.forEach(record => record.addedNodes.forEach(scan));
  }).observe(document.documentElement, { childList: true, subtree: true });
  resumeFollowingPage();
})();
