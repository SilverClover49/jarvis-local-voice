#!/usr/bin/env python3
"""Jarvis setup - one command, any machine.

    python setup.py      (Windows, macOS, Linux)

Works out what this computer is (OS, CPU cores, RAM, whether there is a GPU)
then downloads the right binaries and models for it. Safe to re-run: anything
already present is skipped.

No GPU required. No compiler. One pip package for the voice.
"""
from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent

# ── what we are installing ───────────────────────────────────
MODEL = "models/qwen3.5-0.8b-q4_k_m.gguf"
MODEL_URL = ("https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/"
             "resolve/main/Qwen3.5-0.8B-Q4_K_M.gguf")

EAR = "models/ggml-tiny.en-q5_1.bin"
EAR_URL = ("https://huggingface.co/koboldcpp/whisper/"
           "resolve/main/whisper-tiny.en-q5_1.bin")

VOICES = {
    "en_GB-alba-medium": "Alba - Scottish female",
    "en_GB-northern_english_male-medium": "Northern English - male",
    "en_US-lessac-medium": "Lessac - American female",
    "en_US-ryan-medium": "Ryan - American male",
}
VOICE_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en"

WHISPER_ZIP = ("https://github.com/ggml-org/whisper.cpp/releases/"
               "download/b5454/whisper-bin-x64.zip")
KOBOLD_WIN = ("https://github.com/LostRuins/koboldcpp/releases/"
              "download/v1.124.2/koboldcpp-nocuda.exe")
KOBOLD_MAC = ("https://github.com/LostRuins/koboldcpp/releases/"
              "download/v1.124.2/koboldcpp-mac-arm64")
KOBOLD_LINUX = ("https://github.com/LostRuins/koboldcpp/releases/"
                "download/v1.124.2/koboldcpp-linux-x64-nocuda")


# ── pretty output ────────────────────────────────────────────
def head(t: str) -> None:
    print(f"\n\033[1m{t}\033[0m" if os.name != "nt" else f"\n{t}")


def good(t: str) -> None:
    print(f"   ok    {t}")


def warn(t: str) -> None:
    print(f"   !!    {t}")


def step(t: str) -> None:
    print(f"   ...   {t}")


# ── hardware detection ───────────────────────────────────────
def detect() -> dict:
    system = platform.system()
    machine = platform.machine().lower()

    if system == "Windows":
        os_name = "Windows"
    elif system == "Darwin":
        os_name = "macOS"
    else:
        os_name = "Linux"

    if machine in ("amd64", "x86_64", "x64"):
        arch = "x64"
    elif machine in ("arm64", "aarch64"):
        arch = "arm64"
    else:
        arch = machine

    cores = os.cpu_count() or 4

    ram_gb = 0.0
    try:
        if system == "Windows":
            import ctypes

            class MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]

            stat = MEMORYSTATUSEX()
            stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
            ram_gb = stat.ullTotalPhys / 1e9
        elif system == "Darwin":
            out = subprocess.run(["sysctl", "-n", "hw.memsize"],
                                 capture_output=True, text=True).stdout.strip()
            ram_gb = int(out) / 1e9
        else:
            with open("/proc/meminfo") as f:
                for line in f:
                    if line.startswith("MemTotal:"):
                        ram_gb = int(line.split()[1]) / 1e6
                        break
    except Exception:
        ram_gb = 0.0

    return {
        "os": os_name,
        "arch": arch,
        "cores": cores,
        "ram": round(ram_gb, 1),
        "apple_silicon": system == "Darwin" and arch == "arm64",
    }


def threads_for(hw: dict) -> int:
    """Use roughly half the cores: more is not faster for a small model."""
    return max(2, min(8, hw["cores"] // 2))


# ── download ─────────────────────────────────────────────────
def fetch(url: str, dest: Path, label: str = "") -> bool:
    if dest.exists() and dest.stat().st_size > 1024:
        good(f"{dest.relative_to(HERE)} already here")
        return True

    dest.parent.mkdir(parents=True, exist_ok=True)
    step(f"downloading {label or dest.name}")
    tmp = dest.with_suffix(dest.suffix + ".part")

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "jarvis-setup"})
        with urllib.request.urlopen(req, timeout=60) as r, open(tmp, "wb") as f:
            total = int(r.headers.get("Content-Length") or 0)
            done = 0
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                f.write(chunk)
                done += len(chunk)
                if total:
                    pct = done * 100 // total
                    print(f"\r         {pct:3d}%  {done // 1_000_000} MB", end="", flush=True)
        print()
        tmp.replace(dest)
        good(f"{dest.relative_to(HERE)}  ({dest.stat().st_size // 1_000_000} MB)")
        return True
    except Exception as exc:
        print()
        warn(f"failed: {exc}")
        warn(f"get it manually: {url}")
        warn(f"and save it as: {dest.relative_to(HERE)}")
        tmp.unlink(missing_ok=True)
        return False


# ── the brain binary (platform specific) ─────────────────────
def install_brain(hw: dict) -> None:
    head("1 of 4  The brain (KoboldCpp)")

    exe = "koboldcpp.exe" if hw["os"] == "Windows" else "koboldcpp"
    dest = HERE / "bin" / exe

    if dest.exists():
        good(f"bin/{exe} already here")
        return

    if hw["os"] == "Windows":
        fetch(KOBOLD_WIN, dest, "KoboldCpp for Windows")

    elif hw["os"] == "macOS":
        if hw["apple_silicon"]:
            # there is a prebuilt Apple Silicon binary
            fetch(KOBOLD_MAC, dest, "KoboldCpp for Apple Silicon")
        else:
            warn("No prebuilt binary for Intel Macs.")
            warn("Build it, or use a machine with Apple Silicon:")
            warn("  https://github.com/LostRuins/koboldcpp#macos")

    else:  # Linux
        fetch(KOBOLD_LINUX, dest, "KoboldCpp for Linux")

    if dest.exists() and hw["os"] != "Windows":
        dest.chmod(0o755)
        # macOS quarantines anything downloaded by a script; clear the flag
        if hw["os"] == "macOS":
            subprocess.run(["xattr", "-d", "com.apple.quarantine", str(dest)],
                           capture_output=True)


# ── the ear binary ───────────────────────────────────────────
def install_ear(hw: dict) -> None:
    head("3 of 4  The ear (whisper.cpp)")

    exe = "whisper-server.exe" if hw["os"] == "Windows" else "whisper-server"
    dest = HERE / "bin" / exe

    if dest.exists():
        good(f"bin/{exe} already here")
        return

    if hw["os"] == "Windows" and hw["arch"] == "x64":
        zip_path = HERE / "bin" / "_whisper.zip"
        if fetch(WHISPER_ZIP, zip_path, "whisper.cpp binaries"):
            unpack = HERE / "bin" / "_whisper"
            with zipfile.ZipFile(zip_path) as z:
                z.extractall(unpack)
            # the exe needs its dlls beside it
            for f in unpack.rglob("*"):
                if f.is_file() and f.suffix.lower() in (".exe", ".dll"):
                    shutil.copy2(f, HERE / "bin" / f.name)
            shutil.rmtree(unpack, ignore_errors=True)
            zip_path.unlink(missing_ok=True)
            if dest.exists():
                good(f"bin/{exe} ready")
                return
        warn("whisper-server not extracted")

    elif hw["os"] == "Linux" and hw["arch"] == "x64":
        # whisper.cpp publishes an Ubuntu build; it usually runs on other distros
        tgz = HERE / "bin" / "_whisper.tar.gz"
        url = ("https://github.com/ggml-org/whisper.cpp/releases/"
               "download/b5454/whisper-bin-ubuntu-x64.tar.gz")
        if fetch(url, tgz, "whisper.cpp for Linux"):
            import tarfile

            unpack = HERE / "bin" / "_whisper"
            with tarfile.open(tgz) as t:
                t.extractall(unpack)
            found = list(unpack.rglob("whisper-server"))
            if found:
                shutil.copy2(found[0], dest)
                dest.chmod(0o755)
                good("bin/whisper-server ready")
            shutil.rmtree(unpack, ignore_errors=True)
            tgz.unlink(missing_ok=True)
            if dest.exists():
                return

    elif hw["os"] == "macOS":
        # There is no prebuilt whisper.cpp binary for macOS. Homebrew has one,
        # and it is a single command if the student already uses brew.
        if shutil.which("brew"):
            step("installing whisper-cpp with Homebrew ...")
            r = subprocess.run(["brew", "install", "whisper-cpp"],
                               capture_output=True, text=True)
            server = shutil.which("whisper-server") or shutil.which("whisper-cpp")
            if r.returncode == 0 and server:
                # Homebrew ships whisper-cpp which runs a server with the same flags
                shutil.copy2(server, dest)
                dest.chmod(0o755)
                good("bin/whisper-server ready (via Homebrew)")
                return
            warn("brew install whisper-cpp did not produce a server binary")
        else:
            warn("No prebuilt whisper.cpp for macOS.")
            warn("Either install Homebrew and re-run:")
            warn("  /bin/bash -c \"$(curl -fsSL https://brew.sh)\"")
            warn("  python setup.py")
            warn("or build the server yourself:")
            warn("  git clone https://github.com/ggml-org/whisper.cpp")
            warn("  cd whisper.cpp && make whisper-server")
            warn(f"  cp whisper-server <this folder>/bin/{dest.name}")

    else:
        warn("No prebuilt whisper.cpp for this platform.")
        warn("Build it:")
        warn("  git clone https://github.com/ggml-org/whisper.cpp")
        warn("  cd whisper.cpp && make whisper-server")
        warn(f"  cp whisper-server <this folder>/bin/{dest.name}")

    if not dest.exists():
        warn("Microphone will be off. Typing still works.")


# ── voices ───────────────────────────────────────────────────
def install_voices() -> None:
    head("Voice models (Piper)")

    # path layout differs per voice; en_GB and en_US are the two we ship
    paths = {
        "en_GB-alba-medium": "en/en_GB/alba/medium",
        "en_GB-northern_english_male-medium": "en/en_GB/northern_english_male/medium",
        "en_US-lessac-medium": "en/en_US/lessac/medium",
        "en_US-ryan-medium": "en/en_US/ryan/medium",
    }

    for name, label in VOICES.items():
        stem = paths[name]
        onnx = HERE / "voices" / f"{name}.onnx"
        if onnx.exists():
            good(f"{label}")
            continue
        fetch(f"{VOICE_BASE}/{stem[len('en/'):]}/{name}.onnx", onnx, label)
        fetch(f"{VOICE_BASE}/{stem[len('en/'):]}/{name}.onnx.json",
              HERE / "voices" / f"{name}.onnx.json", "")

    step("installing piper-tts ...")
    try:
        subprocess.run([sys.executable, "-m", "pip", "install", "--quiet",
                        "--disable-pip-version-check", "piper-tts"],
                       check=True, capture_output=True)
        good("piper-tts installed")
    except Exception:
        warn("pip install failed. Run manually:  pip install piper-tts")

    # onnxruntime-gpu and onnxruntime install the same module under different
    # versions. Having both makes Piper take ~7 s to load instead of ~3, and on
    # a machine with no CUDA it can fail outright. Piper only needs the CPU
    # build, so remove the GPU one if it's there.
    have_gpu = subprocess.run(
        [sys.executable, "-m", "pip", "show", "onnxruntime-gpu"],
        capture_output=True).returncode == 0

    if have_gpu:
        step("removing onnxruntime-gpu (it conflicts with piper's onnxruntime) ...")
        subprocess.run([sys.executable, "-m", "pip", "uninstall", "-y", "-q",
                        "onnxruntime-gpu"], capture_output=True)
        good("removed onnxruntime-gpu")


# ── main ─────────────────────────────────────────────────────
def main() -> None:
    hw = detect()

    print("=" * 60)
    print(" Jarvis setup")
    print("=" * 60)
    print(f"  system : {hw['os']} ({hw['arch']})")
    print(f"  cores  : {hw['cores']}   -> using {threads_for(hw)} threads")
    if hw["ram"]:
        print(f"  memory : {hw['ram']} GB")
        if hw["ram"] < 4:
            warn("under 4 GB of RAM - this will be slow")

    for d in ("bin", "models", "voices"):
        (HERE / d).mkdir(exist_ok=True)

    install_brain(hw)

    head("2 of 4  The model (Qwen 3.5 0.8B)")
    fetch(MODEL_URL, HERE / MODEL, "Qwen 3.5 0.8B, 533 MB")

    install_ear(hw)

    head("4 of 4  The voice")
    install_voices()
    fetch(EAR_URL, HERE / EAR, "whisper tiny.en, 32 MB")

    # ── write a config the launcher reads ────────────────────
    cfg = {
        "threads": threads_for(hw),
        "detected": hw,
    }
    (HERE / "config.json").write_text(json.dumps(cfg, indent=2), encoding="utf-8")

    # ── verdict ──────────────────────────────────────────────
    head("Checking everything is here")

    exe_brain = "koboldcpp.exe" if hw["os"] == "Windows" else "koboldcpp"
    exe_ear = "whisper-server.exe" if hw["os"] == "Windows" else "whisper-server"

    checks = [
        ("brain binary", (HERE / "bin" / exe_brain).exists(), True),
        ("brain model", (HERE / MODEL).exists(), True),
        ("voice model", (HERE / "voices" / "en_GB-alba-medium.onnx").exists(), True),
        ("ear model", (HERE / EAR).exists(), True),
        ("ear binary", (HERE / "bin" / exe_ear).exists(), False),
    ]

    ready = True
    for label, present, required in checks:
        if present:
            good(label)
        elif required:
            warn(f"{label} MISSING")
            ready = False
        else:
            warn(f"{label} missing - microphone off, typing still works")

    print()
    if ready:
        print("  Ready. Start it with:")
        print(f"      {'python' if hw['os'] == 'Windows' else 'python3'} start.py")
    else:
        print("  Something is missing. Scroll up for the link, then re-run setup.py")
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nstopped")
        sys.exit(1)
