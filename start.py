#!/usr/bin/env python3
"""Jarvis launcher - starts all three servers, any OS.

    python start.py        (Windows, macOS, Linux)

Reads config.json (written by setup.py) to know how many threads to use.
Press Ctrl-C to stop everything.
"""
from __future__ import annotations

import json
import os
import platform
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
IS_WIN = platform.system() == "Windows"

BRAIN_PORT = 5001
VOICE_PORT = 5002
EAR_PORT = 8081

children: list[subprocess.Popen] = []


def say(m: str = "") -> None:
    print(m, flush=True)


def ok(m: str) -> None:
    say(f"   ok    {m}")


def warn(m: str) -> None:
    say(f"   !!    {m}")


def config() -> dict:
    p = HERE / "config.json"
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"threads": 4}


def answers(port: int, path: str = "/") -> bool:
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=2)
        return True
    except urllib.error.HTTPError:
        return True
    except Exception:
        return False


def port_free(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.35)
        return s.connect_ex(("127.0.0.1", port)) != 0


def binary(name_win: str, name_nix: str) -> Path | None:
    for n in (name_win, name_nix):
        p = HERE / "bin" / n
        if p.exists():
            return p
    return None


def launch(label: str, cmd: list[str]) -> subprocess.Popen | None:
    kwargs: dict = {"cwd": str(HERE),
                    "stdout": subprocess.DEVNULL,
                    "stderr": subprocess.DEVNULL}
    if IS_WIN:
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
    try:
        p = subprocess.Popen(cmd, **kwargs)
        children.append(p)
        ok(f"{label} started (pid {p.pid})")
        return p
    except Exception as exc:
        warn(f"{label} failed: {exc}")
        return None


def open_page() -> None:
    url = (HERE / "app" / "index.html").as_uri()
    try:
        if IS_WIN:
            os.startfile(url)                              # noqa: S606
        elif platform.system() == "Darwin":
            subprocess.run(["open", url], check=False)
        else:
            subprocess.run(["xdg-open", url], check=False)
    except Exception:
        say(f"\n   Open this yourself:  {url}")


def stop(*_a) -> None:
    say("\nstopping ...")
    for p in children:
        try:
            p.terminate()
        except Exception:
            pass
    time.sleep(0.5)
    for p in children:
        try:
            if p.poll() is None:
                p.kill()
        except Exception:
            pass
    if IS_WIN:
        for n in ("koboldcpp.exe", "whisper-server.exe"):
            subprocess.run(["taskkill", "/F", "/IM", n],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    say("stopped.")
    sys.exit(0)


def main() -> None:
    cfg = config()
    threads = cfg.get("threads", 4)

    say("=" * 60)
    say(" Jarvis")
    say("=" * 60)

    brain = binary("koboldcpp.exe", "koboldcpp")
    model = HERE / "models" / "qwen3.5-0.8b-q4_k_m.gguf"
    voice = HERE / "voices" / "en_GB-alba-medium.onnx"
    ear = binary("whisper-server.exe", "whisper-server")
    earmodel = HERE / "models" / "ggml-tiny.en-q5_1.bin"

    if not brain or not model:
        warn("not set up yet - run:  python setup.py")
        sys.exit(1)

    for port, name in ((BRAIN_PORT, "brain"), (VOICE_PORT, "voice"), (EAR_PORT, "ear")):
        if not port_free(port):
            warn(f"port {port} ({name}) already in use - another copy running?")

    say(f"\n 1  brain   Qwen 3.5 0.8B, {threads} threads")
    launch("brain", [
        str(brain), "--model", str(model), "--usecpu",
        "--port", str(BRAIN_PORT), "--contextsize", "4096",
        "--threads", str(threads), "--quiet", "--skiplauncher",
    ])

    if ear and earmodel.exists():
        say(" 2  ear     whisper tiny.en")
        launch("ear", [
            str(ear), "-m", str(earmodel),
            "--host", "127.0.0.1", "--port", str(EAR_PORT), "-t", str(threads),
        ])
    else:
        warn("ear missing - you can type but not speak")

    if voice.exists():
        say(" 3  voice   Piper")
        launch("voice", [sys.executable, str(HERE / "voice-server.py")])
    else:
        warn("voice model missing - replies will be text only")

    say("\n waiting for the model (about 20 seconds) ...")
    for i in range(45):
        if answers(BRAIN_PORT, "/api/v1/model"):
            ok("brain is up")
            break
        time.sleep(1.5)
    else:
        warn("brain did not start in 70s")
        warn("try running it by hand:")
        warn(f'  "{brain}" --model "{model}" --usecpu --port 5001')
        return

    say("\n ready - opening the page ...")
    open_page()

    say("\n press Ctrl-C here to stop everything")
    try:
        while True:
            time.sleep(1)
            if children and all(p.poll() is not None for p in children):
                say("all servers exited")
                break
    except KeyboardInterrupt:
        stop()


if __name__ == "__main__":
    stop_signal = None
    try:
        main()
    except KeyboardInterrupt:
        stop()
