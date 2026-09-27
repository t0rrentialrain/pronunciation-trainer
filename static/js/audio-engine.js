/* Web Audio core shared by both practice modes.
   The decoded clip AudioBuffer is the single source of timing truth; everything
   (loops, gaps, crossfades) is scheduled on the AudioContext clock. */
const Engine = (() => {
  let ctx;
  const live = new Set(); // active nodes we may need to stop

  function ac() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }
  const now = () => ac().currentTime;
  const resume = () => ac().resume();

  async function decodeUrl(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load ${url} (${res.status})`);
    const arr = await res.arrayBuffer();
    return ac().decodeAudioData(arr);
  }

  async function decodeBlob(blob) {
    const arr = await blob.arrayBuffer();
    return ac().decodeAudioData(arr.slice(0));
  }

  function makeGain(value = 1) {
    const g = ac().createGain();
    g.gain.value = value;
    g.connect(ac().destination);
    return g;
  }

  /* Schedule one playback of `buffer` at absolute time `when`, routed to
     `dest` (a GainNode or the destination). Returns the source node. */
  function play(buffer, when, dest, { loop = false } = {}) {
    const src = ac().createBufferSource();
    src.buffer = buffer;
    src.loop = loop;
    src.connect(dest || ac().destination);
    src.start(when);
    live.add(src);
    src.onended = () => live.delete(src);
    return src;
  }

  function stopAll() {
    for (const s of live) {
      try { s.stop(); } catch (_) {}
    }
    live.clear();
  }

  /* Equal-power crossfade. x in [0,1]: 0 = all native clip, 1 = all your voice. */
  function crossfade(x) {
    return {
      clip: Math.cos((x * Math.PI) / 2),
      rec: Math.cos(((1 - x) * Math.PI) / 2),
    };
  }

  /* Mic recorder. start() begins capture; stop() resolves with { blob, buffer }. */
  function createRecorder() {
    let stream, recorder, chunks;
    return {
      async start() {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        chunks = [];
        const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "";
        recorder = mime ? new MediaRecorder(stream, { mimeType: mime })
                        : new MediaRecorder(stream);
        recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        recorder.start();
      },
      stop() {
        return new Promise((resolve, reject) => {
          if (!recorder) return reject(new Error("Recorder not started"));
          recorder.onstop = async () => {
            stream.getTracks().forEach((t) => t.stop());
            const blob = new Blob(chunks, { type: chunks[0]?.type || "audio/webm" });
            try {
              const buffer = await decodeBlob(blob);
              resolve({ blob, buffer });
            } catch (err) {
              resolve({ blob, buffer: null });
            }
          };
          recorder.stop();
        });
      },
    };
  }

  /* Draw one or two buffers as stacked waveforms on a canvas. */
  function drawWaves(canvas, buffers, labels = []) {
    // If the canvas isn't laid out yet (e.g. its tab is still display:none),
    // wait for the next frame so clientWidth is real instead of 0.
    if (!canvas.clientWidth) {
      requestAnimationFrame(() => drawWaves(canvas, buffers, labels));
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const g = canvas.getContext("2d");
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, h);
    const colors = ["#5b8cff", "#ff5b8c"];
    const lanes = buffers.length;
    buffers.forEach((buf, i) => {
      if (!buf) return;
      const laneH = h / lanes;
      const mid = laneH * i + laneH / 2;
      const data = buf.getChannelData(0);
      const step = Math.max(1, Math.floor(data.length / w));
      g.strokeStyle = colors[i % colors.length];
      g.beginPath();
      for (let x = 0; x < w; x++) {
        let min = 1, max = -1;
        for (let j = 0; j < step; j++) {
          const v = data[x * step + j] || 0;
          if (v < min) min = v;
          if (v > max) max = v;
        }
        g.moveTo(x, mid + min * (laneH / 2) * 0.9);
        g.lineTo(x, mid + max * (laneH / 2) * 0.9);
      }
      g.stroke();
      if (labels[i]) {
        g.fillStyle = colors[i % colors.length];
        g.font = "12px system-ui";
        g.fillText(labels[i], 8, laneH * i + 16);
      }
    });
  }

  return {
    ac, now, resume, decodeUrl, decodeBlob,
    makeGain, play, stopAll, crossfade, createRecorder, drawWaves,
  };
})();
