/* Listen & Repeat: clip plays once, then a proportional silent gap where your
   attempt is auto-recorded, then it repeats. Comparison plays clip and your
   take back-to-back so you can hear the difference. */
const ListenRepeat = (() => {
  let clipBuf = null;
  let take = null;          // { blob, buffer }
  const rec = Engine.createRecorder();
  let running = false, comparing = false;

  const $ = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const gapFactor = () => (+$("lr-gap").value) / 100;

  function syncVideoOnce() {
    App.videoOnce();
    setTimeout(() => App.videoStop(), clipBuf.duration * 1000);
  }

  function drawWaves() {
    Engine.drawWaves($("lr-waves"), [clipBuf, take?.buffer || null], ["Native", "You"]);
  }

  async function runLoop() {
    while (running) {
      // 1) Listen
      Engine.stopAll();
      Engine.resume();
      Engine.play(clipBuf, Engine.now() + 0.05, Engine.ac().destination);
      syncVideoOnce();
      App.status("Listen…");
      await wait(clipBuf.duration * 1000 + 80);
      if (!running) break;

      // 2) Your turn — record through the gap
      App.status("🎤 Your turn — repeat now!");
      await rec.start();
      await wait(clipBuf.duration * gapFactor() * 1000);
      const t = await rec.stop();
      if (!running) break;
      if (t.buffer) { take = t; drawWaves(); $("lr-playback").classList.remove("hidden"); }
    }
  }

  async function compareLoop() {
    while (comparing && take?.buffer) {
      Engine.stopAll();
      Engine.resume();
      Engine.play(clipBuf, Engine.now() + 0.05, Engine.ac().destination);
      syncVideoOnce();
      App.status("Native…");
      await wait(clipBuf.duration * 1000 + 200);
      if (!comparing) break;
      Engine.play(take.buffer, Engine.now() + 0.05, Engine.ac().destination);
      App.status("You…");
      await wait(take.buffer.duration * 1000 + 400);
    }
  }

  function stopLoop() {
    running = false;
    Engine.stopAll();
    App.videoStop();
    $("lr-start").classList.remove("live");
    $("lr-start").disabled = false;
    $("lr-stop").disabled = true;
  }

  return {
    async load(clip) {
      clipBuf = await Engine.decodeUrl(`/clips/${clip.id}/audio.mp3`);
      take = null;
      $("lr-playback").classList.add("hidden");
      drawWaves();
    },
    activate() {
      $("ctl-listen-repeat").classList.remove("hidden");
      App.setHint("Listen, then repeat in the gap. Compare and refine your vowels & consonants.");
      drawWaves();
    },
    deactivate() {
      stopLoop(); comparing = false;
      $("ctl-listen-repeat").classList.add("hidden");
    },
    init() {
      $("lr-gap").oninput = () => { $("lr-gap-val").textContent = gapFactor().toFixed(1); };
      $("lr-start").onclick = () => {
        if (running) return;
        running = true; comparing = false;
        $("lr-start").classList.add("live");
        $("lr-start").disabled = true;
        $("lr-stop").disabled = false;
        runLoop();
      };
      $("lr-stop").onclick = stopLoop;
      $("lr-compare").onclick = () => {
        if (comparing) { comparing = false; Engine.stopAll(); $("lr-compare").textContent = "▶ Compare (clip ⇄ you)"; return; }
        comparing = true; $("lr-compare").textContent = "■ Stop compare"; compareLoop();
      };
      $("lr-download").onclick = () => App.downloadTake(take, "listen-repeat");
    },
  };
})();
