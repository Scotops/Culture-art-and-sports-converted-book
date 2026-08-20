/* Play a separate, muted sign-video layer alongside the ADT narration. */
(() => {
  const YEAR = 31536000;
  let signClone = null;
  let narrationRequested = false;
  let narrationAudio = null;
  let pauseTimer = null;
  const trackedNarrations = new WeakSet();

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

  // Show the sign panel from the beginning. The learner's first Play click
  // begins both streams; later pages resume from the stored reading session.
  setReaderMode("signLanguageMode");
  setReaderMode("readAloudMode");

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
    if (signClone && !signClone.paused) signClone.pause();
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
    source.style.display = "none";

    const clone = source.cloneNode(true);
    clone.dataset.signLanguageClone = "true";
    clone.defaultMuted = true;
    clone.muted = true;
    clone.volume = 0;
    clone.setAttribute("muted", "");
    clone.removeAttribute("autoplay");
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
    clone.load();
    signClone = clone;
  };

  const scan = root => {
    if (root instanceof HTMLVideoElement) createIndependentVideo(root);
    if (root?.querySelectorAll) root.querySelectorAll("video").forEach(createIndependentVideo);
  };

  const nativePlay = HTMLMediaElement.prototype.play;
  const nativePause = HTMLMediaElement.prototype.pause;
  HTMLMediaElement.prototype.play = function (...args) {
    if (isSourceVideo(this)) {
      createIndependentVideo(this);
      return Promise.resolve();
    }
    const result = nativePlay.apply(this, args);
    if (isNarrationAudio(this)) {
      narrationAudio = this;
      narrationRequested = true;
      if (!trackedNarrations.has(this)) {
        trackedNarrations.add(this);
        this.addEventListener("ended", () => {
          pauseTimer = setTimeout(() => {
            if (narrationAudio === this && this.paused) {
              narrationRequested = false;
              pauseSignVideo();
            }
          }, 1500);
        });
      }
      Promise.resolve(result).then(() => {
        clearTimeout(pauseTimer);
        playSignVideo();
      }).catch(() => {});
    }
    return result;
  };
  HTMLMediaElement.prototype.pause = function (...args) {
    if (isSourceVideo(this)) return;
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
      // This shares the learner's click with the video, avoiding a delayed
      // initial frame. The narration hook above keeps it synchronized after.
      playSignVideo();
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
