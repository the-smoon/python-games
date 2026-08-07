"""
AudioStrike — Flask web server.

Serves the browser game and handles server-side audio analysis via librosa.
"""

import os, uuid, threading, json, tempfile
from flask import Flask, request, jsonify, send_from_directory

from audio_analyzer import analyze, AudioFeatures

app = Flask(__name__, static_folder="static")
app.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024   # 100 MB upload limit

PORT = int(os.environ.get("PORT", 8000))

# In-memory session store  { session_id -> dict }
_sessions: dict[str, dict] = {}
_sessions_lock = threading.Lock()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _feat_to_dict(f: AudioFeatures) -> dict:
    return {
        "duration":     float(f.duration),
        "tempo":        float(f.tempo),
        "beat_times":   f.beat_times.tolist(),
        "frame_times":  f.frame_times.tolist(),
        "rms":          f.rms.tolist(),
        "centroid":     f.centroid.tolist(),
        "flatness":     f.flatness.tolist(),
        "onset":        f.onset.tolist(),
        "low_energy":   f.low.tolist(),
        "mid_energy":   f.mid.tolist(),
        "high_energy":  f.high.tolist(),
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/api/upload", methods=["POST"])
def upload():
    stage_file = request.files.get("stage")
    boss_file  = request.files.get("boss")
    if not stage_file or not boss_file:
        return jsonify({"error": "Both stage and boss files are required"}), 400

    session_id = uuid.uuid4().hex[:10]
    session_dir = os.path.join(tempfile.gettempdir(), "audiostrike", session_id)
    os.makedirs(session_dir, exist_ok=True)

    stage_ext = os.path.splitext(stage_file.filename)[1] or ".mp3"
    boss_ext  = os.path.splitext(boss_file.filename)[1]  or ".mp3"
    stage_path = os.path.join(session_dir, f"stage{stage_ext}")
    boss_path  = os.path.join(session_dir, f"boss{boss_ext}")

    stage_file.save(stage_path)
    boss_file.save(boss_path)

    session = {
        "status":          "analyzing",
        "progress":        0.0,
        "stage_features":  None,
        "boss_features":   None,
        "error":           None,
    }
    with _sessions_lock:
        _sessions[session_id] = session

    def _run():
        try:
            def prog(p: float):
                session["progress"] = float(p)

            session["stage_features"] = analyze(stage_path,
                                                lambda p: prog(p * 0.5))
            session["boss_features"]  = analyze(boss_path,
                                                lambda p: prog(0.5 + p * 0.5))
            session["status"] = "ready"
        except Exception as exc:
            session["status"] = "error"
            session["error"]  = str(exc)

    threading.Thread(target=_run, daemon=True).start()
    return jsonify({"session_id": session_id})


@app.route("/api/status/<session_id>")
def status(session_id):
    with _sessions_lock:
        s = _sessions.get(session_id)
    if s is None:
        return jsonify({"error": "not found"}), 404
    return jsonify({"status": s["status"], "progress": s["progress"]})


@app.route("/api/features/<session_id>")
def features(session_id):
    with _sessions_lock:
        s = _sessions.get(session_id)
    if s is None:
        return jsonify({"error": "not found"}), 404
    if s["status"] != "ready":
        return jsonify({"error": "not ready", "status": s["status"]}), 400
    return jsonify({
        "stage": _feat_to_dict(s["stage_features"]),
        "boss":  _feat_to_dict(s["boss_features"]),
    })


if __name__ == "__main__":
    print(f"[AudioStrike] Starting on http://0.0.0.0:{PORT}")
    app.run(host="0.0.0.0", port=PORT, debug=False, threaded=True)
