#!/usr/bin/env python3
"""Jarvis voice server - Piper text-to-speech behind a tiny HTTP API.

Piper synthesises roughly 17x faster than real time on a laptop CPU. Kokoro,
which this replaced, runs at about 0.9x - slower than it speaks - which is why
the first version felt laggy. The whole reason this file exists is to wrap
Piper in a URL the browser can call.

Not Flask: Flask's dev server added ~8 seconds per request on this machine
(8.7s via Flask vs 0.31s direct). http.server with threads is enough for one
person talking to one laptop.

    python voice-server.py         listens on 127.0.0.1:5002

    GET  /health      -> {"ok": true, "voices": [...], "default": "..."}
    POST /say         {"text": "...", "voice": "...", "speed": 1.0}
                      -> audio/wav bytes, with an X-Synth-Ms header
"""
from __future__ import annotations

import io
import json
import os
import sys
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

try:
    from piper import PiperVoice
except ImportError:
    print("piper-tts is not installed.  Run:  pip install piper-tts", file=sys.stderr)
    raise SystemExit(1)

HERE = Path(__file__).resolve().parent
VOICE_DIR = HERE / "voices"
PORT = int(os.environ.get("VOICE_PORT", "5002"))
DEFAULT = "en_GB-alba-medium"

_cache: dict[str, PiperVoice] = {}
_lock = threading.Lock()


def available() -> list[str]:
    return sorted(p.stem for p in VOICE_DIR.glob("*.onnx"))


def load(name: str) -> PiperVoice:
    """Load a voice once and keep it in memory (~250 ms, so not per request)."""
    with _lock:
        if name in _cache:
            return _cache[name]
        model = VOICE_DIR / f"{name}.onnx"
        if not model.exists():
            raise FileNotFoundError(f"no voice file {model.name}")
        voice = PiperVoice.load(str(model), config_path=str(model) + ".json")
        _cache[name] = voice
        return voice


def synth(text: str, name: str, speed: float = 1.0) -> tuple[bytes, int, int]:
    """Return (wav bytes, synth milliseconds, sample rate)."""
    voice = load(name)
    t0 = time.perf_counter()

    # Piper's length_scale is inverted speed: 1.2 is slower, 0.8 is faster.
    speed = max(0.5, min(2.0, speed or 1.0))
    length_scale = 1.0 / speed

    buf = io.BytesIO()
    rate = 22050
    with wave.open(buf, "wb") as wav:
        first = True
        for chunk in voice.synthesize(text, length_scale=length_scale):
            if first:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(chunk.sample_rate)
                rate = chunk.sample_rate
                first = False
            wav.writeframes(chunk.audio_int16_bytes)

    return buf.getvalue(), int((time.perf_counter() - t0) * 1000), rate


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Expose-Headers", "X-Synth-Ms")

    def _json(self, code: int, obj: dict):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if self.path.split("?")[0] != "/health":
            self.send_error(404)
            return
        self._json(200, {"ok": True, "voices": available(), "default": DEFAULT})

    def do_POST(self):
        if self.path.split("?")[0] != "/say":
            self.send_error(404)
            return

        length = int(self.headers.get("Content-Length") or 0)
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self._json(400, {"ok": False, "error": "bad json"})
            return

        text = (payload.get("text") or "").strip()
        if not text:
            self._json(400, {"ok": False, "error": "no text"})
            return

        name = payload.get("voice") or DEFAULT
        if name not in available():
            name = DEFAULT

        try:
            speed = float(payload.get("speed") or 1.0)
        except (TypeError, ValueError):
            speed = 1.0

        try:
            data, ms, rate = synth(text, name, speed)
        except Exception as exc:                # noqa: BLE001 - shown to the page
            self._json(500, {"ok": False, "error": str(exc)})
            return

        seconds = max(0.0, (len(data) - 44) / (rate * 2))
        self.log_message("said %d chars -> %.2fs audio in %dms", len(text), seconds, ms)

        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Synth-Ms", str(ms))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    found = available()
    if not found:
        print(f"No voices in {VOICE_DIR}.", file=sys.stderr)
        print("Run:  python setup.py", file=sys.stderr)
        raise SystemExit(1)

    warm = DEFAULT if DEFAULT in found else found[0]
    print(f"loading {warm} ...", end=" ", flush=True)
    load(warm)
    print("ready")

    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Jarvis voice server on http://127.0.0.1:{PORT}")
    print(f"voices: {', '.join(found)}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")
