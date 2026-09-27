/* Audio-editor-style waveform trimmer, synced to the YouTube player.
   The waveform is a *view of the video*: playing the video (via the Play button,
   Space, or the player's own controls) moves the green playhead across the wave,
   and clicking the wave seeks the video. The decoded buffer is only used to draw
   the waveform; playback is the real player so what you see == what you hear.
   Times in the readout/markers are seconds relative to the fetched window. */
const WaveTrimmer = (() => {
  let buf = null, dur = 0, sr = 44100;
  let selStart = 0, selEnd = 0;
  let viewStart = 0, viewEnd = 0;
  let playheadT = 0;
  let windowStart = 0;      // absolute video time of window sample 0
  let player = null;        // { seek(abs), play(), pause(), isReady() }
  let playing = false;
  let onSave = null;

  const $ = (id) => document.getElementById(id);
  let wrap, canvas, mStart, mEnd, playEl;

  const MIN_VIEW = 0.08, MIN_SEL = 0.03;
  const W = () => wrap.clientWidth;
  const H = () => wrap.clientHeight;
  const secToX = (t) => ((t - viewStart) / (viewEnd - viewStart)) * W();
  const xToSec = (x) => viewStart + (x / W()) * (viewEnd - viewStart);
  const clampT = (t) => Math.max(0, Math.min(dur, t));
  const absOf = (t) => windowStart + t;

  function clampView() {
    let w = Math.min(viewEnd - viewStart, dur);
    w = Math.max(w, MIN_VIEW);
    if (viewStart < 0) viewStart = 0;
    viewEnd = viewStart + w;
    if (viewEnd > dur) { viewEnd = dur; viewStart = Math.max(0, dur - w); }
  }

  // ---------------- drawing ----------------
  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const w = W(), h = H();
    if (!w) { requestAnimationFrame(draw); return; }
    canvas.width = w * dpr; canvas.height = h * dpr;
    const g = canvas.getContext("2d");
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, h);

    const sx = secToX(selStart), ex = secToX(selEnd);
    g.fillStyle = "rgba(31,159,224,0.16)";
    g.fillRect(Math.max(0, sx), 0, Math.min(w, ex) - Math.max(0, sx), h);

    g.fillStyle = "#9aa7b3";
    g.font = "11px system-ui";
    for (let i = 0; i <= 4; i++) {
      const t = viewStart + ((viewEnd - viewStart) * i) / 4;
      const x = (w * i) / 4;
      g.fillRect(x === 0 ? 0 : x - 0.5, h - 6, 1, 6);
      g.fillText(fmtTime(t), Math.min(w - 52, Math.max(2, x + 3)), h - 9);
    }

    const data = buf.getChannelData(0);
    const mid = h / 2;
    const startSample = Math.floor(viewStart * sr);
    const spp = Math.max(1, ((viewEnd - viewStart) * sr) / w);
    g.strokeStyle = "#2a93d8";
    g.beginPath();
    for (let x = 0; x < w; x++) {
      let min = 1, max = -1;
      const base = startSample + Math.floor(x * spp);
      for (let j = 0; j < spp; j++) {
        const v = data[base + j] || 0;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      g.moveTo(x, mid + min * mid * 0.9);
      g.lineTo(x, mid + max * mid * 0.9);
    }
    g.stroke();

    placeOverlays();
    updateReadout();
  }

  const clampX = (x) => Math.max(-20, Math.min(W() + 20, x));
  function placeOverlays() {
    mStart.style.left = clampX(secToX(selStart)) + "px";
    mEnd.style.left = clampX(secToX(selEnd)) + "px";
    playEl.style.left = clampX(secToX(playheadT)) + "px";
  }
  function placePlayhead() { playEl.style.left = clampX(secToX(playheadT)) + "px"; }
  function updateReadout() {
    $("r-start").textContent = fmtTime(selStart);
    $("r-end").textContent = fmtTime(selEnd);
    $("r-sel").textContent = (selEnd - selStart).toFixed(3) + "s";
  }
  function ensureMinSel() {
    selStart = clampT(selStart); selEnd = clampT(selEnd);
    if (selEnd < selStart + MIN_SEL) selEnd = Math.min(dur, selStart + MIN_SEL);
  }

  // ---------------- zoom / pan ----------------
  function zoomAt(clientX, factor) {
    const rect = wrap.getBoundingClientRect();
    const x = clientX - rect.left;
    const tc = xToSec(x);
    let w = Math.max(MIN_VIEW, Math.min(dur, (viewEnd - viewStart) * factor));
    const frac = x / W();
    viewStart = tc - frac * w; viewEnd = viewStart + w;
    clampView(); draw();
  }
  function panBy(dt) { viewStart += dt; viewEnd += dt; clampView(); draw(); }
  function centerOn(t) {
    const w = viewEnd - viewStart;
    viewStart = t - w / 2; viewEnd = viewStart + w; clampView(); draw();
  }

  // ---------------- playback (drives the YouTube player) ----------------
  function setPlayLabel() { $("wave-play").textContent = playing ? "⏸ Stop (Space)" : "▶ Play (Space)"; }
  function startPlay() {
    if (!player || !player.isReady()) return;
    player.seek(absOf(selStart)); player.play();
    playing = true; setPlayLabel();
  }
  function stopPlay() { if (player) player.pause(); playing = false; setPlayLabel(); }
  function togglePlay() { playing ? stopPlay() : startPlay(); }

  // Called ~12x/sec with the player's absolute time. Keeps the marker on the
  // real playback position and loops the selection while playing.
  function onPlayerTick(abs) {
    if (!buf) return;
    const t = abs - windowStart;
    if (t < -0.15 || t > dur + 0.15) return;     // player is outside this window
    playheadT = clampT(t);
    if (playing && abs >= absOf(selEnd) - 0.02) { player.seek(absOf(selStart)); return; }
    if (playing && (playheadT < viewStart || playheadT > viewEnd)) centerOn(playheadT);
    else placePlayhead();
  }

  // ---------------- pointer interaction ----------------
  function onMarkerDown(which, e) {
    e.preventDefault(); e.stopPropagation();
    const rect = wrap.getBoundingClientRect();
    const move = (ev) => {
      const x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
      const t = clampT(xToSec(x));
      if (which === "start") selStart = Math.min(t, selEnd - MIN_SEL);
      else selEnd = Math.max(t, selStart + MIN_SEL);
      ensureMinSel(); draw();
    };
    const up = () => {
      document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up);
      document.removeEventListener("touchmove", move); document.removeEventListener("touchend", up);
    };
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
    document.addEventListener("touchmove", move, { passive: false }); document.addEventListener("touchend", up);
  }

  function onWrapDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    const rect = wrap.getBoundingClientRect();
    const downX = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const downT = clampT(xToSec(downX));
    let moved = false;
    const move = (ev) => {
      const x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
      if (Math.abs(x - downX) > 4) moved = true;
      if (moved) {
        const t = clampT(xToSec(x));
        selStart = Math.min(downT, t); selEnd = Math.max(downT, t);
        ensureMinSel(); draw();
      }
    };
    const up = () => {
      document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up);
      document.removeEventListener("touchmove", move); document.removeEventListener("touchend", up);
      if (!moved) { playheadT = downT; }      // plain click → move playhead…
      else { playheadT = selStart; }
      if (player && player.isReady()) player.seek(absOf(playheadT)); // …and seek the video
      draw();
    };
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
    document.addEventListener("touchmove", move, { passive: false }); document.addEventListener("touchend", up);
  }

  function setMarker(which, t) {
    if (which === "start") selStart = Math.min(t, selEnd - MIN_SEL);
    else selEnd = Math.max(t, selStart + MIN_SEL);
    ensureMinSel(); draw();
  }

  function init(opts = {}) {
    onSave = opts.onSave;
    player = opts.player;
    wrap = $("wave-wrap"); canvas = $("wave-canvas");
    mStart = wrap.querySelector(".wmarker-start");
    mEnd = wrap.querySelector(".wmarker-end");
    playEl = wrap.querySelector(".wplayhead");

    mStart.addEventListener("mousedown", (e) => onMarkerDown("start", e));
    mEnd.addEventListener("mousedown", (e) => onMarkerDown("end", e));
    mStart.addEventListener("touchstart", (e) => onMarkerDown("start", e), { passive: false });
    mEnd.addEventListener("touchstart", (e) => onMarkerDown("end", e), { passive: false });
    wrap.addEventListener("mousedown", onWrapDown);
    wrap.addEventListener("touchstart", onWrapDown, { passive: false });

    wrap.addEventListener("wheel", (e) => {
      e.preventDefault();
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY))
        panBy((e.deltaY + e.deltaX) * 0.0012 * (viewEnd - viewStart));
      else zoomAt(e.clientX, e.deltaY > 0 ? 1.2 : 0.83);
    }, { passive: false });

    document.querySelectorAll(".nudge button").forEach((b) => {
      b.onclick = () => setMarker(b.dataset.m,
        (b.dataset.m === "start" ? selStart : selEnd) + parseFloat(b.dataset.d));
    });

    $("wave-zoom-in").onclick = () => zoomAt(wrap.getBoundingClientRect().left + W() / 2, 0.6);
    $("wave-zoom-out").onclick = () => zoomAt(wrap.getBoundingClientRect().left + W() / 2, 1.7);
    $("wave-zoom-fit").onclick = () => { viewStart = 0; viewEnd = dur; draw(); };
    $("wave-play").onclick = togglePlay;
    $("wave-cancel").onclick = () => { stopPlay(); $("wave-stage").classList.add("hidden"); };
    $("wave-save").onclick = () => {
      stopPlay();
      onSave && onSave({ start: selStart, end: selEnd, normalize: $("r-normalize").checked });
    };

    if (player) player.onTick((abs) => onPlayerTick(abs));

    document.addEventListener("keydown", (e) => {
      if ($("wave-stage").classList.contains("hidden") || e.target.tagName === "INPUT") return;
      if (e.code === "Space") { e.preventDefault(); togglePlay(); }
    });
    window.addEventListener("resize", () => { if (buf) draw(); });
  }

  function load(buffer, opts) {
    stopPlay();
    buf = buffer; dur = buffer.duration; sr = buffer.sampleRate;
    windowStart = opts.windowStart || 0;
    selStart = clampT(opts.selStartRel); selEnd = clampT(opts.selEndRel);
    ensureMinSel();
    viewStart = 0; viewEnd = dur; playheadT = selStart;
    $("wave-name").textContent = opts.name || "clip";
    $("wave-dur").textContent = fmtTime(dur);
    $("r-normalize").checked = false;
    setPlayLabel();
    requestAnimationFrame(draw);
  }

  return { init, load };
})();
