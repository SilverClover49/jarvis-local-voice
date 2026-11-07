# Where everything lives

A map of the code, file by file, so you can point at things while teaching.

---

## The shape of it

```
setup.py           you run once       downloads ~700 MB
start.py           you run each time  starts 3 servers, opens the page
voice-server.py    runs in background  turns text into speech

app/index.html     the page            structure
app/style.css      the page            looks
app/app.js         the page            behaviour  ← the interesting one
app/orb.js         the page            the glowing blob
```

Everything the browser does is one of three `fetch` calls to `127.0.0.1`.

---

## `app/index.html` — about 160 lines

You never need to touch this unless you're adding a control. It's structure
only: no logic, no styling.

| Around line | What's there |
|---|---|
| 13 | `<div id="stage">` — the full-screen orb, hidden until it listens or speaks |
| 20 | `<nav id="chats">` — the conversation list on the left |
| 40 | `<header>` — logo, title, the three status chips |
| 55 | `<main>` — the transcript |
| 57 | `<aside>` — the whole settings sidebar |
| 60 | **Persona** dropdown + custom textarea |
| 72 | **Mind** — the three sliders (temperature, length, memory) |
| 92 | **Voice** — voice picker, speak toggle, speed |
| 103 | **Where does it think?** — the local/cloud switch, API key, model search |
| 130 | `<footer>` — the input box, mic button, send button |

The ids matter: `app.js` finds everything with `document.getElementById`. If you
rename an id in one file, rename it in the other. `node lint.js` catches that.

---

## `app/style.css` — about 680 lines

Pure presentation. Three things worth knowing:

**1. Colours are all variables.** Top of the file, `:root`:

```css
--blue-900: #0a1628;   /* page background  */
--ink:      #f2f8fd;   /* body text        */
--accent:   #4fc3f7;   /* the cyan         */
```

Change those three and the whole app changes. Nothing else hardcodes a colour.

**2. The layout is a two-column grid.** `.shell` at ~line 38:

```css
.shell { display: grid; grid-template-columns: 210px 1fr; }
```

That's the chat sidebar plus everything else. Change `210px` to hide or widen it.

**3. The orb overlay.** `#stage` at ~line 260 is `position: fixed` with
`opacity: 0`. JavaScript adds `.on` and it fades in. If the orb ever gets stuck
on screen, that's the class not being removed.

---

## `app/app.js` — about 1000 lines, the real code

Read it in this order and it makes sense. The sections are separated by long
comment rules.

### 1. Personas — around line 32

```js
const PERSONAS = {
  jarvis: "You are Jarvis, a warm, dry-witted British butler...",
  mentor: "...",
  pirate: "...",
};
```

**This is the single most important thing in the file.** A system prompt is a
plain sentence telling a generic model who to be. There is no "Jarvis model" —
there is Qwen and a sentence.

It ends with "no markdown, no asterisks, no emoji" because the reply gets spoken
aloud, and a voice reading `**bold**` sounds broken.

### 2. Chat history — around line 57

Every conversation is stored in `localStorage` under `jarvis.chats`. The shape:

```js
[{ id, title, messages: [{ role: "user"|"assistant", text }], at }]
```

Key functions:

| Function | Line | Does |
|---|---|---|
| `loadChats()` | ~69 | reads them back on startup |
| `saveChats()` | ~80 | writes after every change |
| `newChat()` | ~90 | creates one, clears the screen |
| `openChat(id)` | ~121 | loads a chat, redraws every message |
| `deleteChat(id)` | ~150 | removes it, picks another |
| `renameChat(id, title)` | ~162 | changes the title |
| `remember(role, text)` | ~235 | appends a message, auto-titles from the first one |

One subtlety worth teaching: messages have an optional `system: true` flag. The
greeting line uses it — you see it on screen, but it is never sent to the model,
so it can't influence the reply.

### 3. The prompt builder — around line 300

```js
function buildPrompt(text) {
  let p = `<|im_start|>system\n${currentPersona()}<|im_end|>\n`;
  for (const t of turns ? state.history.slice(-turns) : []) { ... }
  p += `<|im_start|>user\n${text}<|im_end|>\n`;
  p += `<|im_start|>assistant\n<think>\n\n</think>\n\n`;
  return p;
}
```

Three things to point at:

- **`<|im_start|>` / `<|im_end|>`** — chat template tokens. The model expects
  text in exactly this shape. It's how it knows who said what.
- **`state.history.slice(-turns)`** — that's all "memory" is. An array you resend.
  The `Remember` slider sets how many turns.
- **`<think>\n\n</think>`** — the empty, already-closed thinking block. Delete
  that line and answers take **7 seconds instead of 0.4**, and the voice reads
  out the model's inner monologue. This one line is the biggest performance
  trick in the project.

### 4. The brain — `askLocal()` around line 340

```js
const res = await fetch(BRAIN + "/api/v1/generate", {
  method: "POST",
  body: JSON.stringify({ prompt, max_length, temperature, stop: [...] }),
});
const data = await res.json();
return data.results[0].text;
```

That's the entire AI integration. One HTTP POST. The same shape as OpenAI,
Anthropic or Groq — only the URL changes.

### 5. The cleaner — `clean()` around line 145

Strips markdown before the text reaches the screen or the speaker: `**bold**`,
headings, bullet markers, LaTeX. It's belt-and-braces — the prompt asks the model
not to use markdown, but a 0.8B model forgets.

### 6. The voice — `speak()` around line 400

```js
const res = await fetch(VOICE + "/say", {
  body: JSON.stringify({ text, voice, speed }),
});
const bytes = await res.arrayBuffer();      // a WAV file
const buffer = await audioCtx.decodeAudioData(bytes);
```

Then it plays the buffer. That's all a voice is: bytes you decode and play.

The analyser tap right after is what makes the orb move — it reads the actual
waveform in real time rather than faking it with a timer.

### 7. The ears — `startListening()` around line 500

This is the most involved part of the file, and the one you should skim when
teaching rather than explain line by line.

```js
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
const ctx = new AudioContext();
const processor = ctx.createScriptProcessor(4096, 1, 1);
processor.onaudioprocess = (e) => { /* collect raw samples */ };
```

Raw PCM samples go into an array. A simple energy check (`rms > 0.012`) decides
when you're speaking and when you've stopped, which is what makes it send
automatically.

Then `transcribe()` (~line 570) does three things:

1. `downsample()` — the mic gives 44–48 kHz, Whisper wants 16 kHz
2. `encodeWav()` — builds a WAV header by hand, because `MediaRecorder` produces
   WebM and Whisper won't take it
3. `POST` the WAV to `:8081/inference`

The WAV encoding is ~30 lines and looks intimidating. It's plumbing. Say so:
"you don't need to understand this bit, just know why it exists."

### 8. The cloud path — `askCloud()` around line 420

Same idea, different address, plus a key:

```js
const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
  headers: { Authorization: `Bearer ${key}` },
  body: JSON.stringify({ model, messages: [...], max_tokens, temperature }),
});
```

Note the difference from local: no `<think>` block, and messages are an array of
objects rather than one big string. That's the OpenAI format, which Groq copies.

`loadModels()` (~line 200) calls `GET /models` with the key to build the picker,
then `looksChatty()` filters out the whisper, TTS and moderation models — they'd
fail on the chat endpoint.

### 9. The send loop — around line 740

Where it all comes together:

```js
addTurn("user", question);
remember("user", question);
const reply = addTurn("ai", "");
const { text: answer, ms } = await think(question);   // local or cloud
reply.bubble.textContent = answer;
remember("assistant", answer);
if (speak) await speak(answer);
```

### 10. Boot — end of file

```js
function boot() {
  loadChats();       // or create the first one
  setBackend("local");
  probe();           // are the three servers alive? -> the chips
}
```

---

## `app/orb.js` — about 180 lines

One class. Draws a wobbling blob on a canvas and reacts to a number called
`level` between 0 and 1.

- `attachAnalyser()` — hooked to real audio, so `level` is the actual loudness
- `setState("waiting" | "thinking" | "speaking" | "hearing")` — changes colour
- `draw()` — the wobble is three sine waves at different frequencies

You don't need to explain this one. Show it and say "this is the fun part".

---

## `voice-server.py` — about 180 lines

The only Python in the running system, and only because Piper is a Python
package.

```python
def synth(text, name, speed):
    voice = load(name)                    # cached after first use
    for chunk in voice.synthesize(text, length_scale=1/speed):
        ...                               # collect audio
    return wav_bytes, milliseconds, sample_rate
```

Two things worth mentioning:

- **`load()` caches the voice.** Loading takes ~250 ms, so doing it per request
  would dominate. Load once, keep it.
- **`http.server`, not Flask.** Flask's dev server added ~8 seconds per request
  here. This version does a sentence in about 0.3 s.

The `Handler` class is just two routes — `GET /health` and `POST /say`.

---

## `setup.py` and `start.py`

**`setup.py`** — detects OS, cores and RAM, downloads the right binaries, writes
`config.json` with a sensible thread count (half your cores, capped at 8).

**`start.py`** — reads `config.json`, starts the three servers, waits for the
brain to answer, then opens the page. Ctrl-C stops everything.

Both are cross-platform. If something fails on a student's machine, the error
message tells you which file is missing and where to put it.

---

## `lint.js`

Not part of the app — a checker. Run `node lint.js` before you present.

It catches the specific things that broke during development:

- unbalanced CSS comments (one stray `*/` kills the entire stylesheet silently)
- `//` comments in CSS (invalid, ignored)
- JavaScript syntax errors
- missing files the HTML references
- element ids the script uses but the page never defines

---

## The five-minute version to say out loud

> There are four parts: an ear, a brain, a voice, and you. Only one of them
> decides how good the conversation is.
>
> The brain is 533 megabytes — a file on this laptop. You talk to it over
> `127.0.0.1`, which means *this computer*.
>
> Every model here is a file, and every call is a `fetch`. That's the whole
> project. The rest is polish.
