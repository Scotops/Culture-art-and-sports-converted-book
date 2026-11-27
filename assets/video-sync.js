/* Keep narration and the page's muted sign-language interpretation together. */
(() => {
  "use strict";

  const YEAR = 31536000;
  const PLAYER_TOOLBAR_HEIGHT = 24;
  const PLAYER_CONTROLS_HEIGHT = 36;
  const MAX_PLAYER_WIDTH = 360;
  let signClone = null;
  let signRenderer = null;
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
        height: var(--adt-sign-player-height, 263px) !important;
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

  const formatTime = seconds => {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  };

  const createWebGlRenderer = (canvas, video) => {
    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) return null;
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, `
      attribute vec2 position;
      attribute vec2 textureCoordinate;
      varying vec2 texturePosition;
      void main() {
        gl_Position = vec4(position, 0.0, 1.0);
        texturePosition = textureCoordinate;
      }
    `);
    const fragment = compile(gl.FRAGMENT_SHADER, `
      precision mediump float;
      uniform sampler2D frame;
      varying vec2 texturePosition;
      void main() {
        gl_FragColor = texture2D(frame, texturePosition);
      }
    `);
    if (!vertex || !fragment) return null;
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    gl.useProgram(program);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1,
    ]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const textureBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, textureBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      0, 1, 1, 1, 0, 0,
      0, 0, 1, 1, 1, 0,
    ]), gl.STATIC_DRAW);
    const coordinate = gl.getAttribLocation(program, "textureCoordinate");
    gl.enableVertexAttribArray(coordinate);
    gl.vertexAttribPointer(coordinate, 2, gl.FLOAT, false, 0, 0);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.clearColor(0, 0, 0, 0);

    return () => {
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      } catch (_) {}
    };
  };

  const createCanvasRenderer = (canvas, video) => {
    const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
    if (!context) return () => {};
    return () => {
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
    };
  };

  const makeSignRenderer = (canvas, video) => {
    const draw = createWebGlRenderer(canvas, video) || createCanvasRenderer(canvas, video);
    let callback = null;
    const render = () => {
      draw();
      if (!video.paused && !video.ended) {
        callback = video.requestVideoFrameCallback
          ? video.requestVideoFrameCallback(render)
          : requestAnimationFrame(render);
      }
    };
    const start = () => {
      if (callback !== null) return;
      callback = video.requestVideoFrameCallback
        ? video.requestVideoFrameCallback(render)
        : requestAnimationFrame(render);
    };
    const stop = () => {
      if (callback === null) return;
      if (video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(callback);
      else cancelAnimationFrame(callback);
      callback = null;
      draw();
    };
    video.addEventListener("play", start);
    video.addEventListener("pause", stop);
    video.addEventListener("ended", stop);
    video.addEventListener("seeked", draw);
    video.addEventListener("loadeddata", draw);
    return { draw, start, stop };
  };

  const sizePlayer = (source, host, canvas) => {
    const player = source.parentElement;
    if (!player) return;
    const viewportWidth = window.visualViewport?.width || window.innerWidth;
    const width = Math.max(280, Math.min(MAX_PLAYER_WIDTH, viewportWidth - 16));
    const ratio = source.videoWidth && source.videoHeight ? source.videoHeight / source.videoWidth : 9 / 16;
    const videoHeight = Math.round(width * ratio);
    player.style.setProperty("--adt-sign-player-width", `${width}px`);
    player.style.setProperty("--adt-sign-player-height", `${PLAYER_TOOLBAR_HEIGHT + videoHeight + PLAYER_CONTROLS_HEIGHT}px`);
    if (!player.dataset.adtSignPositioned) {
      player.dataset.adtSignPositioned = "true";
      player.style.top = viewportWidth < 768 ? "8px" : "16px";
      player.style.right = viewportWidth < 768 ? "8px" : "16px";
      player.style.bottom = "auto";
      player.style.left = "auto";
    }
    host.style.height = `${videoHeight + PLAYER_CONTROLS_HEIGHT}px`;
    canvas.width = Math.min(source.videoWidth || 640, 640);
    canvas.height = Math.max(1, Math.round(canvas.width * ratio));
    window.dispatchEvent(new Event("resize"));
  };

  const buildAccessiblePlayer = (source, clone, host) => {
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host { display: block; width: 100%; height: 100%; }
      .sign-shell { display: grid; grid-template-rows: minmax(0, 1fr) ${PLAYER_CONTROLS_HEIGHT}px; width: 100%; height: 100%; overflow: hidden; }
      .sign-stage { position: relative; min-height: 0; overflow: hidden; background: radial-gradient(circle at 50% 32%, #475569 0%, #1e293b 62%, #111827 100%); }
      canvas { display: block; width: 100%; height: 100%; object-fit: contain; }
      video { position: absolute; width: 1px; height: 1px; left: -9999px; opacity: 0; pointer-events: none; }
      .controls { display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; align-items: center; gap: 7px; min-width: 0; padding: 3px 8px; color: white; background: rgba(3, 7, 18, 0.96); font: 12px/1.2 system-ui, sans-serif; }
      button { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border: 1px solid rgba(255,255,255,.6); border-radius: 6px; color: white; background: #1f2937; cursor: pointer; }
      button:hover { background: #334155; }
      button:focus-visible, input:focus-visible { outline: 3px solid #facc15; outline-offset: 1px; }
      input[type="range"] { width: 100%; min-width: 60px; height: 28px; accent-color: #facc15; cursor: pointer; }
      output { min-width: 70px; text-align: right; font-variant-numeric: tabular-nums; }
    `;
    const shell = document.createElement("div");
    shell.className = "sign-shell";
    const stage = document.createElement("div");
    stage.className = "sign-stage";
    const canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Tanzanian Sign Language interpretation for this page");
    const controls = document.createElement("div");
    controls.className = "controls";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.textContent = "▶";
    toggle.setAttribute("aria-label", "Play synchronized narration and sign language video");
    const seek = document.createElement("input");
    seek.type = "range";
    seek.min = "0";
    seek.max = "0";
    seek.step = "0.05";
    seek.value = "0";
    seek.setAttribute("aria-label", "Seek sign language video");
    const time = document.createElement("output");
    time.setAttribute("aria-live", "off");
    time.textContent = "0:00 / 0:00";
    controls.append(toggle, seek, time);
    controls.addEventListener("keydown", event => event.stopPropagation());
    controls.addEventListener("keyup", event => event.stopPropagation());
    stage.append(canvas, clone);
    shell.append(stage, controls);
    root.append(style, shell);

    const updateState = () => {
      const playing = !clone.paused && !clone.ended;
      toggle.textContent = playing ? "Ⅱ" : "▶";
      toggle.setAttribute(
        "aria-label",
        playing
          ? "Pause synchronized narration and sign language video"
          : "Play synchronized narration and sign language video"
      );
      if (Number.isFinite(clone.duration)) seek.max = String(clone.duration);
      if (!seek.matches(":active") && Number.isFinite(clone.currentTime)) seek.value = String(clone.currentTime);
      time.textContent = `${formatTime(clone.currentTime)} / ${formatTime(clone.duration)}`;
    };
    toggle.addEventListener("click", () => {
      if (clone.paused || clone.ended) {
        signManuallyPaused = false;
        if (narrationAudio?.paused && !narrationAudio.ended) nativePlay.call(narrationAudio).catch(() => {});
        nativePlay.call(clone).catch(() => {});
      } else {
        signManuallyPaused = true;
        if (narrationAudio && !narrationAudio.paused) nativePause.call(narrationAudio);
        nativePause.call(clone);
      }
      updateState();
    });
    seek.addEventListener("input", () => {
      signManuallyPaused = true;
      if (narrationAudio && !narrationAudio.paused) nativePause.call(narrationAudio);
      if (!clone.paused) nativePause.call(clone);
      if (Number.isFinite(clone.duration)) clone.currentTime = Math.min(Number(seek.value), clone.duration);
      updateState();
    });
    clone.addEventListener("loadedmetadata", () => {
      sizePlayer(source, host, canvas);
      updateState();
      signRenderer?.draw();
    });
    clone.addEventListener("play", updateState);
    clone.addEventListener("pause", updateState);
    clone.addEventListener("ended", updateState);
    clone.addEventListener("timeupdate", updateState);
    signRenderer = makeSignRenderer(canvas, clone);
    return canvas;
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
    clone.removeAttribute("controls");
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
