"""Pronunciation Trainer — local Flask server.

Clip creation is a two-step, audio-first flow:
  1. /api/fetch-audio  — download ONLY the audio for a padded window around the
     user's rough selection (fast: no video, no merge, no keyframe re-encode).
     The frontend renders a waveform and fine-trims it.
  2. /api/save-clip    — trim that cached window to the final marker range with
     optional loudness normalization, and finalize the clip.

Video in practice comes from the YouTube embed (we never download video), so
clips stay tiny and fast to make.

Run:  pip install -r requirements.txt  &&  python app.py
Then: http://localhost:5000
"""
import json
import os
import shutil
import subprocess
import uuid

from flask import Flask, abort, jsonify, request, send_from_directory

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
CLIPS_DIR = os.path.join(BASE_DIR, "clips")
# Reuse the project's cookies.txt (one level up) if present, so age/region-gated
# videos still download.
COOKIES = os.path.join(os.path.dirname(BASE_DIR), "cookies.txt")

os.makedirs(CLIPS_DIR, exist_ok=True)

app = Flask(__name__, static_folder=None)


def _check_tool(name):
    if shutil.which(name) is None:
        raise RuntimeError(f"Required tool '{name}' not found on PATH.")


def _fmt_ts(seconds):
    """Seconds (float) -> ffmpeg/yt-dlp timestamp HH:MM:SS.mmm."""
    seconds = max(0.0, float(seconds))
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"


def _run(cmd):
    """Run a subprocess, raising with captured output on failure."""
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout or "")[-1500:]
        raise RuntimeError(f"Command failed ({proc.returncode}): {' '.join(cmd)}\n{tail}")
    return proc


def _audio_duration(path):
    try:
        proc = _run([
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", path,
        ])
        return float(proc.stdout.strip())
    except (RuntimeError, ValueError):
        return 0.0


def _now_iso():
    import datetime
    return datetime.datetime.now().isoformat(timespec="seconds")


def _gc_orphans(max_age_s=7200):
    """Remove working dirs that were fetched but never saved (no meta.json) and
    are older than max_age_s, plus any empty dirs. Saved clips are untouched."""
    import time
    now = time.time()
    for cid in os.listdir(CLIPS_DIR):
        d = os.path.join(CLIPS_DIR, cid)
        if not os.path.isdir(d):
            continue
        if os.path.isfile(os.path.join(d, "meta.json")):
            continue  # a finalized clip — keep
        try:
            entries = os.listdir(d)
            if not entries or (now - os.path.getmtime(d)) > max_age_s:
                shutil.rmtree(d, ignore_errors=True)
        except OSError:
            pass


# --------------------------------------------------------------------------- #
# Static frontend
# --------------------------------------------------------------------------- #
@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/static/<path:path>")
def static_files(path):
    return send_from_directory(STATIC_DIR, path)


@app.route("/clips/<clip_id>/<path:filename>")
def clip_files(clip_id, filename):
    folder = os.path.join(CLIPS_DIR, clip_id)
    if not os.path.isdir(folder):
        abort(404)
    return send_from_directory(folder, filename, conditional=True)


# --------------------------------------------------------------------------- #
# API
# --------------------------------------------------------------------------- #
@app.route("/api/clips", methods=["GET"])
def list_clips():
    clips = []
    for cid in os.listdir(CLIPS_DIR):
        meta_path = os.path.join(CLIPS_DIR, cid, "meta.json")
        if os.path.isfile(meta_path):
            try:
                with open(meta_path, encoding="utf-8") as f:
                    clips.append(json.load(f))
            except (OSError, ValueError):
                continue
    clips.sort(key=lambda c: c.get("created", ""), reverse=True)
    return jsonify(clips)


@app.route("/api/clips/<clip_id>", methods=["DELETE"])
def delete_clip(clip_id):
    folder = os.path.join(CLIPS_DIR, clip_id)
    if not os.path.isdir(folder):
        abort(404)
    shutil.rmtree(folder)
    return jsonify({"ok": True})


@app.route("/api/fetch-audio", methods=["POST"])
def fetch_audio():
    """Step 1: grab only the audio for a padded window around a rough selection."""
    data = request.get_json(force=True, silent=True) or {}
    url = (data.get("url") or "").strip()
    try:
        rough_start = float(data.get("start"))
        rough_end = float(data.get("end"))
    except (TypeError, ValueError):
        return jsonify({"error": "start and end must be numbers (seconds)."}), 400

    if not url:
        return jsonify({"error": "Missing YouTube URL."}), 400
    if rough_end <= rough_start:
        rough_end = rough_start + 3.0
    if rough_end - rough_start > 30:
        return jsonify({"error": "Rough selection too long (max 30s)."}), 400

    try:
        _check_tool("yt-dlp")
        _check_tool("ffmpeg")
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500

    _gc_orphans()  # tidy abandoned working dirs from earlier sessions

    pad = 10.0  # generous context on each side so you can see/scroll the waveform
    win_start = max(0.0, rough_start - pad)
    win_end = rough_end + pad
    section = f"*{_fmt_ts(win_start)}-{_fmt_ts(win_end)}"

    clip_id = uuid.uuid4().hex[:12]
    out_dir = os.path.join(CLIPS_DIR, clip_id)
    os.makedirs(out_dir, exist_ok=True)
    title = "clip"
    try:
        dl_cmd = [
            "yt-dlp", "--no-playlist",
            "--download-sections", section,
            "-f", "ba[ext=m4a]/ba/bestaudio",  # audio-only: small + fast
            "-x", "--audio-format", "mp3", "--audio-quality", "0",
            "-o", os.path.join(out_dir, "source.%(ext)s"),
            "--print-to-file", "%(title)s", os.path.join(out_dir, "title.txt"),
            "--no-warnings",
        ]
        if os.path.isfile(COOKIES):
            dl_cmd += ["--cookies", COOKIES]
        dl_cmd.append(url)
        _run(dl_cmd)

        src = os.path.join(out_dir, "source.mp3")
        if not os.path.isfile(src):
            raise RuntimeError("yt-dlp did not produce audio for that selection.")

        title_path = os.path.join(out_dir, "title.txt")
        if os.path.isfile(title_path):
            with open(title_path, encoding="utf-8") as f:
                title = (f.read().strip() or "clip").splitlines()[0]
            os.remove(title_path)

        win_dur = _audio_duration(src)
        window = {
            "id": clip_id, "url": url, "title": title,
            "windowStart": round(win_start, 3), "windowDur": round(win_dur, 3),
            "roughStart": rough_start, "roughEnd": rough_end,
        }
        with open(os.path.join(out_dir, "window.json"), "w", encoding="utf-8") as f:
            json.dump(window, f, ensure_ascii=False)

        return jsonify({**window, "audioUrl": f"/clips/{clip_id}/source.mp3"})
    except RuntimeError as e:
        shutil.rmtree(out_dir, ignore_errors=True)
        return jsonify({"error": str(e)}), 500


@app.route("/api/save-clip", methods=["POST"])
def save_clip():
    """Step 2: trim the cached window audio to the final range and finalize."""
    data = request.get_json(force=True, silent=True) or {}
    clip_id = (data.get("id") or "").strip()
    try:
        sel_start = float(data.get("start"))  # relative to the window, seconds
        sel_end = float(data.get("end"))
    except (TypeError, ValueError):
        return jsonify({"error": "start and end must be numbers."}), 400
    normalize = bool(data.get("normalize", False))

    out_dir = os.path.join(CLIPS_DIR, clip_id)
    win_path = os.path.join(out_dir, "window.json")
    src = os.path.join(out_dir, "source.mp3")
    if not (clip_id and os.path.isfile(win_path) and os.path.isfile(src)):
        return jsonify({"error": "Unknown or expired working clip; re-fetch the audio."}), 400
    if sel_end <= sel_start:
        return jsonify({"error": "End must be after start."}), 400

    with open(win_path, encoding="utf-8") as f:
        window = json.load(f)

    af = "loudnorm=I=-16:TP=-1.5:LRA=11" if normalize else "aresample=44100"
    try:
        _run([
            "ffmpeg", "-y", "-ss", _fmt_ts(sel_start), "-to", _fmt_ts(sel_end),
            "-i", src, "-ac", "1", "-ar", "44100", "-af", af, "-b:a", "192k",
            os.path.join(out_dir, "audio.mp3"),
        ])
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500

    meta = {
        "id": clip_id,
        "title": window.get("title", "clip"),
        "url": window.get("url", ""),
        "start": round(window["windowStart"] + sel_start, 3),  # absolute, for the embed
        "end": round(window["windowStart"] + sel_end, 3),
        "duration": round(sel_end - sel_start, 3),
        "normalized": normalize,
        "hasVideo": True,  # video reference comes from the YouTube embed
        "created": _now_iso(),
    }
    with open(os.path.join(out_dir, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    return jsonify(meta)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    print(f"Pronunciation Trainer running at http://localhost:{port}")
    app.run(host="127.0.0.1", port=port, debug=True)
