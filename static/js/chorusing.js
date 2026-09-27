/* Chorusing: loop native audio, speak in unison, then play your take layered
   over the clip with an equal-power crossfader between the two sources. */
const Chorusing = (() => {
  let clipBuf = null;
  let take = null;        // { blob, buffer }
  const rec = Engine.createRecorder();
  let looping = false, recording = false;
  let gainClip, gainRec;

  const $ = (id) => document.getElementById(id);

  const startVideoLoop = (period) => App.videoLoop(period);
  const stopVideoLoop = () => App.videoStop();

  function startClipLoop() {
    Engine.resume();
    Engine.play(clipBuf, Engine.now() + 0.03, Engine.ac().destination, { loop: true });
    startVideoLoop(clipBuf.duration);
    looping = true;
  }
  function stopEverything() {
    Engine.stopAll();
    stopVideoLoop();
    looping = false;
  }

  async function startRecording() {
    take = null;
    await rec.start();
    startClipLoop();
    recording = true;
    $("ch-record").classList.add("live");
    $("ch-stop").disabled = false;
    $("ch-loop").disabled = true;
    $("ch-playback").classList.add("hidden");
    App.status("Recording — shadow the clip out loud…");
  }

  async function stopRecording() {
    if (!recording) return;
    recording = false;
    stopEverything();
    take = await rec.stop();
    $("ch-record").classList.remove("live");
    $("ch-stop").disabled = true;
    $("ch-loop").disabled = false;
    if (take.buffer) {
      $("ch-playback").classList.remove("hidden");
      App.status("Got your take. Play the mix and slide between native & you.");
    } else {
      App.status("Recording saved, but couldn't decode it for mixing (download still works).");
      $("ch-playback").classList.remove("hidden");
    }
  }

  function applyFader() {
    const x = (+$("ch-fader").value) / 100;
    const { clip, rec: r } = Engine.crossfade(x);
    if (gainClip) gainClip.gain.value = clip;
    if (gainRec) gainRec.gain.value = r;
  }

  function playMix() {
    if (!take?.buffer) return;
    Engine.stopAll();
    Engine.resume();
    gainClip = Engine.makeGain();
    gainRec = Engine.makeGain();
    applyFader();
    const t = Engine.now() + 0.05;
    Engine.play(clipBuf, t, gainClip, { loop: true });   // native loops underneath
    Engine.play(take.buffer, t, gainRec, { loop: false }); // your take once
    startVideoLoop(clipBuf.duration);
    App.status("Playing mix — drag the fader.");
  }

  return {
    async load(clip) {
      clipBuf = await Engine.decodeUrl(`/clips/${clip.id}/audio.mp3`);
      take = null;
      $("ch-playback").classList.add("hidden");
    },
    activate() {
      $("ctl-chorusing").classList.remove("hidden");
      App.setHint("Loop the clip and speak at the exact same time — focus on rhythm & intonation.");
    },
    deactivate() {
      stopEverything();
      $("ctl-chorusing").classList.add("hidden");
    },
    init() {
      $("ch-loop").onclick = () => {
        if (looping) { stopEverything(); $("ch-loop").textContent = "▶ Loop & shadow"; }
        else { startClipLoop(); $("ch-loop").textContent = "■ Stop loop"; }
      };
      $("ch-record").onclick = startRecording;
      $("ch-stop").onclick = stopRecording;
      $("ch-play-mix").onclick = playMix;
      $("ch-fader").oninput = applyFader;
      $("ch-download").onclick = () => App.downloadTake(take, "chorusing");
    },
  };
})();
