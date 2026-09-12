/* Play a separate, muted sign-video layer alongside the ADT narration. */
(() => {
  const YEAR = 31536000;
  let signClone = null;
  let narrationRequested = false;
  let narrationAudio = null;
  let pauseTimer = null;
  let pendingNarrationStart = null;
  let pendingNarrationTimer = null;
  const trackedNarrations = new WeakSet();

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
      [data-sign-language-host="true"] {
        display: block !important;
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

  // Enable both reader modes before the runtime boots. Its page-open autoplay
  // request is held briefly until the sign video is ready, then both streams
  // are launched from the same call stack.
  setReaderMode("signLanguageMode");
  setReaderMode("readAloudMode");
  installVideoVisibilityRule();

  const isSourceVideo = media => media instanceof HTMLVideoElement &&
    /\/content\/i18n\/[^/]+\/video\/page_\d+\.mp4(?:[?#]|$)/.test(media.currentSrc || media.src || "") &&
    !media.dataset.signLanguageClone;
  const isNarrationAudio = media => media instanceof HTMLAudioElement &&
    /\/content\/i18n\/[^/]+\/audio\//.test(media.currentSrc || media.src || "");

  const playSignVideo = () => {
    if (!signClone) return;
    signClone.play().catch(() => {});
  };
  const pauseSignVideo = () => {
    if (signClone) nativePause.call(signClone);
  };

  const nativePlay = HTMLMediaElement.prototype.play;
  const nativePause = HTMLMediaElement.prototype.pause;

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
    // A page without a mapped sign video must still retain narration.
    pendingNarrationTimer = setTimeout(flushPendingNarration, 2500);
    return promise;
  };

  // The ADT's React component pauses its own sign video when voice mode is
  // selected. Hide that lifecycle video and render an independent clone in a
  // shadow root, just as the reference book does. React cannot pause or
  // receive play events from the clone, while its layout stays unchanged.
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
    // cloneNode copies the hidden source element's inline `display: none`.
    // Restore a normal display value so the actual signer image is visible.
    clone.style.display = "block";
    clone.style.width = "100%";
    clone.style.height = "calc(100% - 1.5rem)";
    clone.style.objectFit = "contain";
    clone.style.background = "black";

    const host = document.createElement("div");
    host.dataset.signLanguageHost = "true";
    host.style.width = "100%";
    host.style.height = "100%";
    source.insertAdjacentElement("afterend", host);
    host.attachShadow({ mode: "open" }).appendChild(clone);
    signClone = clone;
    clone.load();
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
    }
    if (label === "Stop" || /Deactivate text to speech/i.test(label)) {
      narrationRequested = false;
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
