/* App shell: tab + mode routing, shared clip state, the muted practice video
   (a YouTube embed, since we no longer download video), and helpers used by the
   mode modules. */
const App = (() => {
  let currentClip = null;
  let currentMode = "chorusing";
  let pv = null;          // practice YouTube player
  let vTimer = null;
  const modes = () => ({ "chorusing": Chorusing, "listen-repeat": ListenRepeat });

  const $ = (id) => document.getElementById(id);

  function showTab(name) {
    document.querySelectorAll("#tabs button").forEach((b) =>
      b.classList.toggle("active", b.dataset.tab === name));
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    $("tab-" + name).classList.add("active");
    if (name === "library") Library.refresh();
  }

  const setStatus = (msg) => { $("practice-status").textContent = msg; };
  const setHint = (msg) => { $("mode-hint").textContent = msg; };

  // ---- muted video reference (YouTube embed seeked to the clip region) ----
  function ensurePV() { if (!pv) pv = makeYTPlayer("practice-video"); return pv; }
  function videoLoop(period) {
    const c = currentClip; if (!c) return;
    const p = ensurePV(); p.seek(c.start); p.play();
    clearInterval(vTimer);
    vTimer = setInterval(() => { p.seek(c.start); p.play(); }, period * 1000);
  }
  function videoOnce() { const c = currentClip; if (!c) return; const p = ensurePV(); p.seek(c.start); p.play(); }
  function videoStop() { clearInterval(vTimer); vTimer = null; if (pv) pv.pause(); }

  async function setMode(mode) {
    if (!currentClip) return;
    document.querySelectorAll(".mode-switch button").forEach((b) =>
      b.classList.toggle("active", b.dataset.mode === mode));
    modes()[currentMode].deactivate();
    currentMode = mode;
    setStatus("Loading clip audio…");
    await modes()[mode].load(currentClip);
    modes()[mode].activate();
    setStatus("Ready.");
  }

  async function openPractice(clip) {
    currentClip = clip;
    $("practice-empty").classList.add("hidden");
    $("practice-stage").classList.remove("hidden");
    $("practice-title").textContent = clip.title || "(untitled)";
    $("tabs").querySelector('[data-tab="practice"]').disabled = false;

    const id = parseVideoId(clip.url || "");
    if (id) {
      const p = ensurePV();
      p.load(id);
      p.onReady(() => { p.mute(); p.seek(clip.start); p.pause(); });
    }
    showTab("practice");
    await setMode(currentMode || "chorusing");
  }

  function downloadTake(take, prefix) {
    if (!take?.blob) { alert("No recording yet."); return; }
    const ext = take.blob.type.includes("webm") ? "webm" : "ogg";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(take.blob);
    a.download = `${prefix}-take-${Date.now()}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  function init() {
    document.querySelectorAll("#tabs button").forEach((b) =>
      b.onclick = () => { if (!b.disabled) showTab(b.dataset.tab); });
    document.querySelectorAll(".mode-switch button").forEach((b) =>
      b.onclick = () => setMode(b.dataset.mode));

    Create.init();
    Library.init();
    Chorusing.init();
    ListenRepeat.init();
  }

  return {
    init, openPractice, downloadTake,
    clip: () => currentClip,
    videoLoop, videoOnce, videoStop,
    status: setStatus,
    setHint,
  };
})();

document.addEventListener("DOMContentLoaded", App.init);
