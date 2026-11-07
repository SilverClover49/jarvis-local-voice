# Jarvis — simulating Jarvis with local AI

A voice assistant that runs entirely on your laptop. No account, no API key,
no monthly bill. Unplug the wifi and it still answers.

Works on **Windows, macOS and Linux**, from any folder.

```
you speak  →  👂  →  🧠  →  🗣️  →  you hear
```

| Part | Model | Size | Speed |
|---|---|---|---|
| 👂 Ear | Whisper tiny.en | 32 MB | ~0.5 s |
| 🧠 Brain | Qwen 3.5 0.8B | 533 MB | 0.36–0.73 s |
| 🗣️ Voice | Piper | 63 MB | ~0.3 s |

End to end: about **1.2 seconds**. All local. Nothing leaves the machine.

---

## Two commands

```bash
python setup.py     # once — downloads about 700 MB
python start.py     # every time — starts everything and opens the page
```

On macOS or Linux you may need `python3` instead of `python`.

`setup.py` detects your OS, CPU cores and RAM, then downloads the right binaries
and picks a sensible thread count. Re-running it is safe; it skips what's there.

### Platform support — read this before you promise it to anyone

| | Windows x64 | macOS (Apple Silicon) | macOS (Intel) | Linux x64 |
|---|---|---|---|---|
| Brain | **auto** | **auto** | build it | **auto** |
| Voice | **auto** | **auto** | **auto** | **auto** |
| Ear | **auto** | Homebrew, or build | Homebrew, or build | **auto** |

"auto" means setup downloads it. Everything else means one manual step, and
setup prints the exact command when it gets there.

**Why the gaps exist.** KoboldCpp publishes a prebuilt `koboldcpp-mac-arm64` but
nothing for Intel Macs. whisper.cpp publishes Windows and Ubuntu builds but
**no macOS binary at all** — so on a Mac the ear needs either Homebrew
(`brew install whisper-cpp`, which setup will run for you if brew is present) or
a local build.

**If the ear is missing, the mic still works.** The page falls back to the
browser's own speech recognition and the ear chip shows `ear · browser`. There's
one honest caveat: on Chrome that fallback sends your audio to Google, so it
breaks the "nothing leaves the machine" promise. Typing always stays local.


---

## Using it

Open the page `start.py` launches. Three dots top-right must be green.

- **Type** a question and press Enter
- **Or tap the mic** once. It stays on until you tap again, and sends when you
  stop talking.
- **Chats** are saved on the left. Click to reopen, `✎` to rename, `✕` to delete.
  They survive closing the browser.

### The knobs worth playing with

Everything in the **Mind** panel is live — move a slider, the next reply changes.

| Control | What it does |
|---|---|
| **Temperature** | 0 = safe and repetitive. 0.4 = balanced. 1.2 = creative and often wrong. |
| **Reply length** | Tokens. 40 is a line, 400 a paragraph. |
| **Remember** | How many past turns it re-reads. 0 = instant amnesia. |
| **Persona** | Three presets, or write your own system prompt. |
| **Voice** | Four Piper voices. |
| **Where does it think?** | Local, or a cloud API. See below. |

---

## Local vs cloud

The **Where does it think?** switch flips between the laptop and a hosted API.
Same page, same prompt, same sliders.

1. Flip to **Cloud API**
2. Paste a [Groq](https://console.groq.com) key — free tier is plenty
3. Press **Save** — the model list fills in from the API
4. Search and pick one
5. Flip back any time. **Delete** removes the key.

The key is stored in your browser only. Nothing is sent anywhere except Groq.

Putting the two side by side is the fastest way to feel what 533 MB buys you
and what it doesn't.

---

## What each file is

```
setup.py            downloads everything for this machine
start.py            launches the three servers and opens the app
voice-server.py     wraps Piper in an HTTP endpoint
lint.js             checks the project isn't broken
config.json         written by setup.py (threads, detected hardware)

app/index.html      the page
app/style.css       all styling
app/app.js          all behaviour
app/orb.js          the glowing orb animation

bin/                koboldcpp + whisper binaries   (downloaded)
models/             qwen + whisper model files     (downloaded)
voices/             piper voices                   (downloaded)
```

Three HTTP servers on `127.0.0.1` — *this computer*:

```
POST :5001/api/v1/generate   brain
POST :5002/say               voice
POST :8081/inference         ear
```

The browser is only one client. Anything that can make an HTTP request can use
them — a script, a phone, a robot. See `docs/BACKEND.md`.

---

## If something breaks

```
node lint.js
```

Catches broken CSS, JavaScript syntax errors, missing files and element ids the
script expects but the page never defines.

| Symptom | Fix |
|---|---|
| Page unstyled | a stray comment closer in `style.css` — run `node lint.js` |
| `brain` red | still loading (wait 20 s), or run `python setup.py` |
| `voice` red | `pip install piper-tts` |
| `ear` red | whisper binary missing — see the table above |
| Refuses everything | press **Reset to defaults** |
| Very slow | close other apps; threads live in `config.json` |

---

## Honest about the limits

800 million parameters is small.

**Good at** short answers, summarising, rewriting, staying private, working
offline, costing nothing.

**Bad at** multi-step reasoning, real code, recent facts, big arithmetic, and
knowing when it's wrong.

It states false things with total confidence. That isn't a bug you can patch —
it's what this kind of model does. Knowing that is the point.

---

## Licence and credits

- [Qwen 3.5 0.8B](https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF) — Apache 2.0
- [KoboldCpp](https://github.com/LostRuins/koboldcpp) — AGPL 3.0
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp) — MIT
- [Piper](https://github.com/rhasspy/piper) — GPL 3.0, voices under their own terms

Model files are not included in this repo. `setup.py` downloads them.
