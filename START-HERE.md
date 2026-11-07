# Start here

Two commands. That's the whole install.

---

## 1. Check you have Python

Open a terminal and run:

```
python --version
```

You want **3.9 or newer**. If that command isn't found, try `python3 --version`.

If neither works, install Python from <https://python.org/downloads>. On Windows,
tick **"Add Python to PATH"** during install — it's easy to miss.

---

## 2. Get the files

Download this repository as a ZIP and extract it. It can go anywhere — Desktop,
Documents, a USB stick. Nothing is hard-coded to a location.

---

## 3. Install (once, about 700 MB)

Open a terminal **in that folder** and run:

```
python setup.py
```

It will:

- work out what kind of computer you have
- download the three model files and the right binaries for your OS
- install one Python package for the voice

You'll see progress bars. It takes a few minutes on a decent connection.

> **If it fails part way through:** just run it again. It skips anything it
> already downloaded.

---

## 4. Run it

```
python start.py
```

Three background processes start, the model loads (about 20 seconds), and the
page opens by itself.

**Look at the top right.** Three dots must be green:

| Dot | Means |
|---|---|
| brain | the language model is running |
| voice | Piper is ready |
| ear | Whisper is ready (microphone) |

If **ear** is red you can still type — you just can't speak.

---

## 5. Talk to it

- Type a question, press **Enter**
- Or tap the **microphone** once. It stays listening until you tap it again, and
  sends automatically when you stop talking.

Chats are saved on the left. Click one to reopen it, `✎` to rename, `✕` to delete.
They survive closing the browser.

---

## Before your first question: try the sliders

In the **Mind** panel:

1. Drag **Temperature** to `0.0` and ask the same question twice. You'll get the
   same answer both times. That's what "temperature" means.
2. Drag it to `1.2` and ask again. Now it's creative and frequently wrong.
3. Set it back to `0.4`.

Then try the **Persona** dropdown. Pick *Pirate*, ask "who are you".

**The system prompt is the whole personality.** There is no "Jarvis model" —
there's a generic model and a sentence describing Jarvis.

---

## If something goes wrong

Run the checker:

```
node lint.js
```

(Only if you have Node installed — it's optional.)

| Problem | Fix |
|---|---|
| `python: command not found` | try `python3`, or reinstall Python with PATH ticked |
| `brain` stays red | wait 20 s; if still red run `python setup.py` again |
| `voice` is red | `pip install piper-tts` |
| `ear` is red | whisper binary missing — setup prints the link |
| Page is unstyled | `node lint.js` — a CSS comment is unbalanced |
| Nothing happens on Enter | press F12, look at the Console tab |
| Port already in use | an old copy is running; close it or restart |

Fuller troubleshooting, plus a walkthrough of every file, is in
[`docs/guide.html`](docs/guide.html) — open it in a browser.

---

## What you just built

| Piece | File | Size | Speed |
|---|---|---|---|
| Brain | Qwen 3.5 0.8B | 533 MB | 0.36 – 0.73 s |
| Voice | Piper | 63 MB | ~0.3 s |
| Ear | Whisper tiny.en | 32 MB | ~0.5 s |

End to end: about **1.2 seconds**. All local. No account, no key, no bill.

Unplug your wifi and ask it something. It still answers.
