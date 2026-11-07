# The backend is just three HTTP servers

Nothing in this project is tied to the UI. `simple.html` is one client. Anything
that can make an HTTP request can be another — a phone, a Python script, a
Streamlit app, a terminal, a robot.

```
                 ┌─────────────────────────────────────────┐
   any client ──►│  POST :5001/api/v1/generate   (brain)   │  KoboldCpp
                 │  POST :5002/say               (voice)   │  Piper  via voice-server.py
                 │  POST :8081/inference         (ear)     │  whisper.cpp
                 └─────────────────────────────────────────┘
```

All three listen on `127.0.0.1` only. No API key, no account. The contract never
changes, so the front end is disposable.

---

## The three calls

### 1. Brain — text in, text out

```http
POST http://127.0.0.1:5001/api/v1/generate
Content-Type: application/json

{
  "prompt": "<|im_start|>system\nYou are Jarvis...<|im_end|>\n<|im_start|>user\nWho are you?<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n",
  "max_length": 90,
  "stop": ["<|im_end|>", "<|im_start|>"]
}
```

Reply:

```json
{ "results": [ { "text": "I am Jarvis, your butler." } ] }
```

The `<think>\n\n</think>` block is not decoration. Without it the model writes
its reasoning out loud and takes 2–7 seconds instead of 0.4.

### 2. Voice — text in, WAV out

```http
POST http://127.0.0.1:5002/say
Content-Type: application/json

{ "text": "Good evening, sir.", "voice": "en_GB-alba-medium" }
```

Reply: raw `audio/wav` bytes, plus an `X-Synth-Ms` header.

### 3. Ear — WAV in, text out

```http
POST http://127.0.0.1:8081/inference
Content-Type: multipart/form-data

file=@clip.wav            (16 kHz, mono, 16-bit)
response_format=json
```

Reply:

```json
{ "text": "what is seventeen times twenty three" }
```

Whisper only accepts WAV, MP3 or FLAC — **not WebM**, which is what a browser
records by default. That is why `app.js` hand-builds a WAV in `encodeWav()`.

---

## Prove it from the terminal

With `start.bat` running, these work with no browser at all.

**PowerShell:**

```powershell
# brain
$body = '{"prompt":"<|im_start|>system\nYou are terse.<|im_end|>\n<|im_start|>user\nSay hi<|im_end|>\n<|im_start|>assistant\n","max_length":30}'
Invoke-RestMethod -Uri http://127.0.0.1:5001/api/v1/generate -Method Post -Body $body -ContentType application/json

# voice -> a file you can play
Invoke-WebRequest -Uri http://127.0.0.1:5002/say -Method Post `
  -ContentType application/json `
  -Body '{"text":"Good evening sir."}' -OutFile hello.wav
```

**curl (any shell):**

```bash
curl -s -X POST http://127.0.0.1:5001/api/v1/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt":"<|im_start|>system\nBe terse.<|im_end|>\n<|im_start|>user\nhi<|im_end|>\n<|im_start|>assistant\n","max_length":20}'

curl -s -X POST http://127.0.0.1:5002/say \
  -H "Content-Type: application/json" \
  -d '{"text":"Good evening sir."}' -o hello.wav
```

**Python, no libraries:**

```python
import json, urllib.request

body = json.dumps({
    "prompt": "<|im_start|>system\nBe terse.<|im_end|>\n"
              "<|im_start|>user\nhi<|im_end|>\n"
              "<|im_start|>assistant\n",
    "max_length": 30,
}).encode()

req = urllib.request.Request(
    "http://127.0.0.1:5001/api/v1/generate",
    data=body, headers={"Content-Type": "application/json"})

print(json.loads(urllib.request.urlopen(req).read())["results"][0]["text"])
```

---

## Swap the front end, keep the backend

A 30-line terminal client — the whole "app", with no HTML anywhere:

```python
import json, urllib.request

def brain(text):
    prompt = (
        "<|im_start|>system\nYou are Jarvis, a dry British butler. "
        "One short sentence.<|im_end|>\n"
        f"<|im_start|>user\n{text}<|im_end|>\n"
        "<|im_start|>assistant\n<think>\n\n</think>\n\n"
    )
    body = json.dumps({"prompt": prompt, "max_length": 90,
                       "stop": ["<|im_end|>", "<|im_start|>"]}).encode()
    req = urllib.request.Request("http://127.0.0.1:5001/api/v1/generate",
                                 data=body, headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req).read())["results"][0]["text"].strip()

while True:
    q = input("you> ").strip()
    if not q: break
    print("jarvis>", brain(q))
```

Same three servers. Same models. No browser.

---

## Why this matters for the session

It means the UI is a **teaching prop**, not the deliverable. You can:

- demo from the terminal if the browser misbehaves
- let a student build a Streamlit or Tkinter front end and still get a working assistant
- show that "an app" is just something that calls an endpoint

And it means the 90 minutes of UI work and the 90 minutes of model work are
genuinely independent — if one breaks, the other still runs.
