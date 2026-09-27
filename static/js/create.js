/* Create tab: rough-pick a region in the YouTube player, fetch just that audio,
   fine-trim it on the waveform, then save the clip. */
const Create = (() => {
  let player = null;
  let roughStart = 0, roughEnd = 5;
  let win = null; // { id, windowStart, ... } from /api/fetch-audio

  const $ = (id) => document.getElementById(id);

  function updateRough() {
    if (roughEnd <= roughStart) roughEnd = roughStart + 3;
    $("rough-range").textContent = `${fmtShort(roughStart)} → ${fmtShort(roughEnd)}`;
  }

  async function loadWave() {
    const url = $("yt-url").value.trim();
    $("fetch-status").textContent = "Fetching audio…";
    $("load-wave").disabled = true;
    try {
      const res = await fetch("/api/fetch-audio", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, start: roughStart, end: roughEnd }),
      });
      win = await res.json();
      if (!res.ok) throw new Error(win.error || "Fetch failed");
      const buf = await Engine.decodeUrl(win.audioUrl);
      $("wave-stage").classList.remove("hidden");
      WaveTrimmer.load(buf, {
        name: win.title,
        windowStart: win.windowStart,
        selStartRel: roughStart - win.windowStart,
        selEndRel: roughEnd - win.windowStart,
      });
      $("fetch-status").textContent = "✓ Trim below.";
    } catch (err) {
      $("fetch-status").textContent = "✗ " + err.message;
    } finally {
      $("load-wave").disabled = false;
    }
  }

  async function saveClip(sel) {
    $("save-status").textContent = "Saving…";
    try {
      const res = await fetch("/api/save-clip", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: win.id, start: sel.start, end: sel.end, normalize: sel.normalize }),
      });
      const meta = await res.json();
      if (!res.ok) throw new Error(meta.error || "Save failed");
      $("save-status").textContent = "✓ Saved!";
      await Library.refresh();
      App.openPractice(meta);
    } catch (err) {
      $("save-status").textContent = "✗ " + err.message;
    }
  }

  function init() {
    player = makeYTPlayer("yt-player");
    const urlEl = $("yt-url");

    $("yt-load").onclick = () => {
      const id = parseVideoId(urlEl.value);
      if (!id) { alert("Couldn't find a YouTube video ID in that URL."); return; }
      $("yt-stage").classList.remove("hidden");
      player.load(id);
      player.onReady((d) => { roughStart = 0; roughEnd = Math.min(5, d || 5); updateRough(); });
    };
    urlEl.addEventListener("keydown", (e) => { if (e.key === "Enter") $("yt-load").click(); });

    $("mark-start").onclick = () => { roughStart = player.currentTime(); updateRough(); };
    $("mark-end").onclick = () => { roughEnd = player.currentTime(); updateRough(); };
    $("load-wave").onclick = loadWave;

    WaveTrimmer.init({ onSave: saveClip, player });
  }

  return { init };
})();
