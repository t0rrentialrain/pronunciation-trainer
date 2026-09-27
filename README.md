# Pronunciation Trainer

A local web app for pronunciation practice from native audio clips. Make a clip
straight from a YouTube video, then drill it two ways:

- **Chorusing** — the clip loops and you speak *in unison* with it (rhythm &
  intonation). Play your take back layered over the native audio with an
  **equal-power crossfader** that slides the mix between "Native" and "You".
- **Listen & Repeat** — the clip plays once, then a proportional silent **gap**
  (×1–2 of the clip length) where your attempt is **auto-recorded**, then it
  repeats. Compare mode plays the clip and your take **back-to-back**, with
  stacked waveforms for visual alignment.

## How it works

A YouTube `<iframe>` is cross-origin, so the browser can't read its audio to
draw a waveform, mix it, or loop it sample-accurately. So clip creation is a
fast, audio-first two-step flow:

1. **Rough-pick** the region in the embedded YouTube player ("Mark start /
   Mark end"), then **Load waveform**. The backend downloads **only the audio**
   for that window (`-f ba -x` — no video, no merge, no keyframe re-encode), so
   it's tiny and quick.
2. **Fine-trim** on a waveform editor (~20s of context around your pick):
   **click-drag** to select, **scroll** to zoom toward the cursor (Shift-scroll
   to pan), drag the red markers or nudge them ±1s / ±0.1s / ±0.01s, optionally
   **Normalize**, then **Save clip**. The waveform is synced to the YouTube
   player: **click** the wave to seek the video and **Space** to play — the
   green playhead tracks the real playback position. The backend trims the
   cached window to the final range.

The UI is themed after the Nintendo Wii Menu (light, glossy sky-blue).

The saved audio is decoded into a Web Audio `AudioBuffer`, the single source of
timing truth for all looping, gapping, and crossfading. During practice the
**video reference is the muted YouTube embed** seeked to the clip region (we
never download video). Your mic take is captured with `MediaRecorder`.

Working dirs for windows you fetch but never save are garbage-collected
automatically.

## Requirements

- Python 3 with Flask (`pip install -r requirements.txt`)
- `yt-dlp` and `ffmpeg` on your PATH (already used elsewhere in this project)
- A Chromium-based browser is recommended (Web Audio decode of `MediaRecorder`
  WebM/Opus output).

## Run

```bash
cd pronunciation-trainer
pip install -r requirements.txt
python app.py
```

Open <http://localhost:5000>. Mic access works because `localhost` is a secure
context — no HTTPS needed.

## Notes

- Clips are saved under `clips/<id>/` (`audio.mp3`, `source.mp3` window for
  re-trimming, `meta.json`) and listed in the **Library** tab.
- Recordings stay in the browser for the session; use **Download take** to keep
  one. They are not stored server-side.
- If you have a `cookies.txt` in the parent folder, it's passed to `yt-dlp` for
  age/region-gated videos.
- Max clip length is 30s (these drills work best on a sentence or two).
