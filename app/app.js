/* Jarvis — all behaviour for simple.html.
   Three servers, three jobs:
     BRAIN  KoboldCpp   text in, reply out
     VOICE  Piper       reply in, speech out   (voice-server.py)
     EAR    whisper     speech in, text out

   Everything is a plain fetch to 127.0.0.1. Nothing leaves the machine. */

const $ = (id) => document.getElementById(id);

const BRAIN = "http://127.0.0.1:5001";
const VOICE = "http://127.0.0.1:5002";
const EAR   = "http://127.0.0.1:8081";

/* ------------------------------------------------------------ */
   // The orb. Two instances: a small avatar in the transcript, and the
   // big one that fills the screen while listening or speaking.
   /* ------------------------------------------------------------ */
const orbBig = new Orb($("orb"));
const STAGE_ON = new Set(["speaking", "hearing"]);

function setState(s) {
  orbBig.setState(s);
  $("stage").classList.toggle("on", STAGE_ON.has(s));
  $("caption").textContent =
    s === "hearing" ? "listening" :
    s === "speaking" ? "speaking" :
    s === "thinking" ? "thinking" : "";
}

/* ------------------------------------------------------------ */
const PERSONAS = {
  jarvis:
    "You are Jarvis, a warm, dry-witted British butler who has looked after this " +
    "household for years. Speak like a real person: react to what was said, then " +
    "answer, and add a small thought of your own. Address the user as 'sir'. " +
    "Stay in character — never say you are a language model or name your maker. " +
    "Two or three sentences. Plain spoken English only: no markdown, no asterisks, " +
    "no bullet points, no LaTeX, no emoji. Numbers as digits.",

  mentor:
    "You are a patient programming mentor who enjoys teaching. React to what the " +
    "person said before you explain, and keep it to two or three spoken sentences. " +
    "Never say you are a language model. " +
    "Plain spoken English only: no markdown, no asterisks, no bullet points, no emoji.",

  pirate:
    "You are a theatrical pirate captain, fond of the person you are talking to. " +
    "React to what they say, then answer, in two or three sentences with nautical " +
    "flavour. Never say you are a language model. " +
    "Plain spoken English only: no markdown, no asterisks, no bullet points, no emoji.",
};

const state = {
  history: [],
  busy: false,
  chunks: [],
};

/* ══════════════════════════════════════════════════════════════
   CHAT HISTORY
   Every conversation is saved in this browser, so closing the tab
   no longer loses it. Each one holds its own messages, title and
   settings snapshot.
   ══════════════════════════════════════════════════════════════ */
const CHATS_KEY = "jarvis.chats";
const ACTIVE_KEY = "jarvis.active";

let chats = [];          // [{ id, title, messages:[{role,text}], at }]
let activeId = null;

function loadChats() {
  try {
    chats = JSON.parse(localStorage.getItem(CHATS_KEY) || "[]");
    activeId = localStorage.getItem(ACTIVE_KEY) || null;
  } catch {
    chats = [];
    activeId = null;
  }
  if (!Array.isArray(chats)) chats = [];
}

function saveChats() {
  try {
    localStorage.setItem(CHATS_KEY, JSON.stringify(chats));
    localStorage.setItem(ACTIVE_KEY, activeId || "");
  } catch { /* storage full or blocked: keep working in memory */ }
}

function newChat(activate = true) {
  const chat = {
    id: "c" + Date.now().toString(36),
    title: "New chat",
    messages: [],
    at: Date.now(),
  };
  chats.unshift(chat);
  if (activate) {
    activeId = chat.id;
    state.history = [];
    $("log").innerHTML = "";
    $("chat-title").textContent = "New chat";
    stat("s-ctx", "0");
    greet();
  }
  saveChats();
  renderChats();
  return chat;
}

function currentChat() {
  return chats.find((c) => c.id === activeId) || null;
}

/* first user message becomes the title, tidied */
function titleFrom(text) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 34 ? t.slice(0, 34) + "…" : t;
}

function openChat(id) {
  activeId = id;
  saveChats();

  const chat = currentChat();
  const messages = chat ? chat.messages : [];

  /* state.history is only what the MODEL sees — system turns like the greeting
     are on screen but are not sent back, so they never enter this array. */
  state.history = messages
    .filter((m) => !m.system)
    .map((m) => ({ role: m.role, text: m.text }));

  $("log").innerHTML = "";
  if (chat) $("chat-title").textContent = chat.title;

  for (const m of messages) {
    if (m.role === "assistant") addTurn("ai", m.text);
    else addTurn("user", m.text);
  }

  /* an empty chat still needs its opening line */
  if (!messages.length) greet();

  stat("s-ctx", String(state.history.reduce((n, t) => n + t.text.split(/\s+/).length, 0)));
  renderChats();
}

function deleteChat(id) {
  chats = chats.filter((c) => c.id !== id);
  if (activeId === id) {
    activeId = chats.length ? chats[0].id : null;
    if (activeId) openChat(activeId);
    else newChat();
  }
  saveChats();
  renderChats();
}

function renameChat(id, title) {
  const c = chats.find((x) => x.id === id);
  if (!c) return;
  c.title = title.trim() || "Untitled";
  saveChats();
  renderChats();
  if (id === activeId) $("chat-title").textContent = c.title;
}

function renderChats() {
  const list = $("chat-list");
  if (!list) return;
  list.innerHTML = "";

  if (!chats.length) {
    const li = document.createElement("li");
    li.className = "hint";
    li.style.padding = "8px 10px";
    li.textContent = "No chats yet";
    list.appendChild(li);
    return;
  }

  for (const c of chats) {
    const li = document.createElement("li");
    li.className = "chat-item" + (c.id === activeId ? " on" : "");
    li.dataset.id = c.id;

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = c.title;
    name.title = c.title;

    const acts = document.createElement("span");
    acts.className = "acts";

    const ren = document.createElement("button");
    ren.textContent = "✎";
    ren.title = "Rename";
    ren.onclick = (e) => {
      e.stopPropagation();
      startRename(li, c);
    };

    const del = document.createElement("button");
    del.className = "del";
    del.textContent = "✕";
    del.title = "Delete";
    del.onclick = (e) => {
      e.stopPropagation();
      deleteChat(c.id);
    };

    acts.append(ren, del);
    li.append(name, acts);
    li.onclick = () => openChat(c.id);
    list.appendChild(li);
  }
}

function startRename(li, chat) {
  li.innerHTML = "";
  const input = document.createElement("input");
  input.className = "rename";
  input.value = chat.title;
  li.appendChild(input);
  input.focus();
  input.select();

  const commit = () => renameChat(chat.id, input.value);
  input.onblur = commit;
  input.onkeydown = (e) => {
    if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    if (e.key === "Escape") { input.onblur = null; renderChats(); }
  };
}

/* remember a finished exchange in the current chat */
function remember(role, text) {
  const chat = currentChat();
  if (!chat) return;
  chat.messages.push({ role, text });
  chat.at = Date.now();
  if (chat.title === "New chat" && role === "user") {
    chat.title = titleFrom(text);
    $("chat-title").textContent = chat.title;
  }
  saveChats();
  renderChats();
}

/* ------------------------------------------------------------ */
function chip(id, status, label) {
  const el = $(id);
  el.className = "chip " + status;
  el.innerHTML = "<i></i>" + (label || el.textContent.replace(/^[^a-z]*/i, "") || id.slice(2));
}

function stat(id, text) { const el = $(id); if (el) el.textContent = text; }

/* ------------------------------------------------------------ */
function addTurn(role, text) {
  const wrap = document.createElement("div");
  wrap.className = "turn " + (role === "user" ? "me" : "ai");

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  const cv = document.createElement("canvas");
  cv.width = cv.height = 44;
  avatar.append(cv);
  drawMini(cv, role);

  const body = document.createElement("div");
  body.className = "body";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  const meta = document.createElement("div");
  meta.className = "meta";

  body.append(bubble, meta);
  wrap.append(avatar, body);
  $("log").append(wrap);
  $("log").scrollTop = $("log").scrollHeight;
  return { bubble, meta };
}

function drawMini(canvas, role) {
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(15, 14, 0, 22, 22, 23);
  if (role === "user") {
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.45, "#7fb8e8");
    g.addColorStop(1, "#2a5c8f");
  } else {
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.4, "#a8e4ff");
    g.addColorStop(1, "#16304d");
  }
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(22, 22, 20, 0, Math.PI * 2);
  ctx.fill();
}

/* ------------------------------------------------------------ */
   // THE BRAIN — Qwen 3.5 0.8B on KoboldCpp
   /* ------------------------------------------------------------ */
/* The system prompt comes from the dropdown, or from the text box when the
   user picks "Write your own…". This one string is the entire personality. */
function currentPersona() {
  const pick = $("persona").value;
  if (pick === "custom") {
    return $("custom-persona").value.trim() ||
      "You are a helpful assistant. Answer briefly. No emoji.";
  }
  return PERSONAS[pick] || PERSONAS.jarvis;
}

function buildPrompt(text) {
  let p = `<|im_start|>system\n${currentPersona()}<|im_end|>\n`;
  const turns = Number($("memory").value) || 0;
  for (const t of turns ? state.history.slice(-turns) : []) {
    p += `<|im_start|>${t.role}\n${t.text}<|im_end|>\n`;
  }
  p += `<|im_start|>user\n${text}<|im_end|>\n`;
  /* Qwen3.5 thinks before answering. Prefilling a closed, empty think block
     skips the monologue: 7.4s -> 0.3s on the same question, and it stops the
     speaker reading out "Okay, the user is asking..." */
  p += `<|im_start|>assistant\n<think>\n\n</think>\n\n`;
  return p;
}

/* Strip the things a voice should never read aloud.
   We ask the model not to use markdown, but a 0.8B model forgets, so this is
   the safety net: asterisks, hashes, bullet glyphs and LaTeX all get removed
   before the text reaches either the screen or the speaker. */
const clean = (t) => t
  .replace(/<\|im_end\|>[\s\S]*$/g, "")
  .replace(/<\/?think>/gi, "")
  .replace(/\*\*(.+?)\*\*/g, "$1")          // **bold** -> bold
  .replace(/\*(.+?)\*/g, "$1")              // *italic* -> italic
  .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")    // `code` -> code
  .replace(/^\s{0,3}#{1,6}\s+/gm, "")       // headings
  .replace(/^\s*[-*+]\s+/gm, "")            // bullet markers
  .replace(/^\s*\d+\.\s+/gm, "")            // numbered list markers
  .replace(/\$([^$]+)\$/g, "$1")            // $inline latex$ -> plain
  .replace(/\\times/g, "times")
  .replace(/\\[a-zA-Z]+/g, "")              // other latex commands
  .replace(/\s{2,}/g, " ")
  .trim()
  /* the model often starts with a lowercase "sir," which reads wrong at the
     start of a sentence. Trim first, then capitalise — otherwise leading
     whitespace means the ^ anchor never matches. */
  .replace(/^([a-z])/, (c) => c.toUpperCase());

/* ── which machine does the thinking ──────────────────────── */
const GROQ_BASE = "https://api.groq.com/openai/v1";
const GROQ = GROQ_BASE + "/chat/completions";
const KEY_STORE = "jarvis.groq.key";
const MODEL_STORE = "jarvis.groq.model";
let backend = "local";                       // "local" | "cloud"

function apiKey() {
  try { return localStorage.getItem(KEY_STORE) || ""; }
  catch { return ""; }
}

function setApiKey(v) {
  try {
    if (v) localStorage.setItem(KEY_STORE, v);
    else localStorage.removeItem(KEY_STORE);
  } catch { /* private mode: keep it in memory only */ }
}

function historyFor(limit) {
  return limit ? state.history.slice(-limit) : [];
}

/* ── the model list ───────────────────────────────────────────
   Groq exposes GET /openai/v1/models. We fetch it with the user's key and
   filter down to the ones that can actually chat — the same endpoint also
   returns speech, vision and guard models, which would fail here. */
let allModels = [];

function looksChatty(id) {
  const bad = ["whisper", "tts", "orpheus", "guard", "embed", "rerank",
               "moderation", "safety", "ocr", "vision-only"];
  return !bad.some((w) => id.toLowerCase().includes(w));
}

async function loadModels() {
  const key = apiKey();
  if (!key) { allModels = []; renderModels(); return; }

  $("model-note").textContent = "loading models…";
  try {
    const res = await fetch(GROQ_BASE + "/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.status === 401) throw new Error("key rejected");
    if (!res.ok) throw new Error("HTTP " + res.status);

    const data = await res.json();
    allModels = (data.data || [])
      .map((m) => m.id)
      .filter(looksChatty)
      .sort();

    $("model-note").textContent = allModels.length
      ? "Pick one. Search narrows the list."
      : "That key has no chat models available.";

    /* keep whatever was selected, else pick a sensible default */
    const keep = $("api-model").value;
    renderModels();
    if (keep && allModels.includes(keep)) $("api-model").value = keep;
  } catch (err) {
    allModels = [];
    $("model-note").textContent = "could not load models — " + err.message;
    renderModels();
  }
}

function renderModels() {
  const q = ($("model-search").value || "").trim().toLowerCase();
  const list = q ? allModels.filter((m) => m.toLowerCase().includes(q)) : allModels;
  const sel = $("api-model");
  const keep = sel.value;

  sel.innerHTML = "";
  if (!list.length) {
    const o = document.createElement("option");
    o.textContent = allModels.length ? "no match" : "no key saved";
    o.disabled = true;
    sel.appendChild(o);
    $("model-count").textContent = "0";
    return;
  }

  for (const id of list) {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = id;
    sel.appendChild(o);
  }
  if (list.includes(keep)) sel.value = keep;
  $("model-count").textContent = String(list.length);
}

$("model-search").addEventListener("input", renderModels);

/* Local: one POST to KoboldCpp with the raw chat-template prompt. */
async function askLocal(text) {
  const t0 = performance.now();
  const res = await fetch(BRAIN + "/api/v1/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: buildPrompt(text),
      max_length: Number($("maxtok").value),
      temperature: Number($("temp").value),
      top_p: 0.9,
      stop: ["<|im_end|>", "<|im_start|>"],
    }),
  });
  if (!res.ok) throw new Error("brain " + res.status);
  const data = await res.json();
  return { text: clean(data.results?.[0]?.text || ""), ms: performance.now() - t0 };
}

/* Cloud: the OpenAI-shaped endpoint. Same idea, different address, and a key.
   Note there is no <think> block here — this model doesn't use one. */
async function askCloud(text) {
  const key = apiKey();
  if (!key) throw new Error("no API key — add one below");

  const model = $("api-model").value;
  if (!model) throw new Error("pick a model first");

  const t0 = performance.now();
  const res = await fetch(GROQ, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: currentPersona() },
        ...historyFor(Number($("memory").value) || 0)
          .map((t) => ({ role: t.role, content: t.text })),
        { role: "user", content: text },
      ],
      max_tokens: Number($("maxtok").value),
      temperature: Number($("temp").value),
    }),
  });

  if (res.status === 401) throw new Error("key rejected — check it and save again");
  if (res.status === 429) throw new Error("rate limited — wait a moment");
  if (!res.ok) throw new Error("cloud " + res.status);

  const data = await res.json();
  return {
    text: clean(data.choices?.[0]?.message?.content || ""),
    ms: performance.now() - t0,
  };
}

async function think(text) {
  return backend === "cloud" ? askCloud(text) : askLocal(text);
}

/* ------------------------------------------------------------ */
/* THE VOICE - Piper over local HTTP. ~17x real time on CPU.     */
/* ------------------------------------------------------------ */
async function speak(text) {
  const t0 = performance.now();
  const res = await fetch(VOICE + "/say", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      voice: $("voice").value,
      speed: Number($("speed").value),
    }),
  });
  if (!res.ok) throw new Error("voice " + res.status);

  const bytes = await res.arrayBuffer();
  const ms = Number(res.headers.get("X-Synth-Ms")) || (performance.now() - t0);
  stat("s-tts", Math.round(ms) + "ms");

  if (!state.audioCtx) state.audioCtx = new AudioContext();
  const ctx = state.audioCtx;
  if (ctx.state === "suspended") await ctx.resume();

  const buffer = await ctx.decodeAudioData(bytes.slice(0));

  const src = ctx.createBufferSource();
  src.buffer = buffer;

  /* Tap the output so the orb follows the actual voice. */
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.62;
  src.connect(analyser);
  analyser.connect(ctx.destination);

  orbBig.attachAnalyser(analyser, new Uint8Array(analyser.fftSize));
  state.source = src;
  setState("speaking");

  await new Promise((done) => {
    src.onended = () => {
      state.source = null;
      orbBig.attachAnalyser(null, null);
      setState(state.listening ? "hearing" : "waiting");
      done();
    };
    src.start();
  });
}

/* ------------------------------------------------------------ */
   // THE EAR — an actual toggle, not a hold-to-talk button.
   // While on, it records continuously and transcribes after a pause.
   /* ------------------------------------------------------------ */
const SILENCE_MS = 1100;     // stop a phrase after this much quiet
const MIN_MS = 350;          // ignore anything shorter

let vadTimer = null;
let speechStarted = 0;
let lastLoud = 0;
let stream = null;
let processor = null;
let sourceNode = null;
let analyserNode = null;
let meterBuf = null;
let sampleRate = 44100;

async function startListening() {
  if (state.listening) return;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    $("note").textContent = "mic blocked: " + err.message;
    return;
  }

  if (!state.audioCtx) state.audioCtx = new AudioContext();
  const ctx = state.audioCtx;
  if (ctx.state === "suspended") await ctx.resume();
  sampleRate = ctx.sampleRate;

  sourceNode = ctx.createMediaStreamSource(stream);

  analyserNode = ctx.createAnalyser();
  analyserNode.fftSize = 512;
  analyserNode.smoothingTimeConstant = 0.55;
  sourceNode.connect(analyserNode);
  meterBuf = new Uint8Array(analyserNode.fftSize);

  processor = ctx.createScriptProcessor(4096, 1, 1);
  state.chunks = [];

  processor.onaudioprocess = (e) => {
    const data = e.inputBuffer.getChannelData(0);
    state.chunks.push(new Float32Array(data));

    /* Simple energy gate. Cheap, and good enough to find phrase ends. */
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    const now = performance.now();

    if (rms > 0.012) {
      if (!speechStarted) speechStarted = now;
      lastLoud = now;
    } else if (speechStarted && now - lastLoud > SILENCE_MS) {
      flipPhrase();
    }

    /* trim the tail so it doesn't grow forever between phrases */
    if (state.chunks.length > 400) state.chunks.splice(0, 200);
  };

  sourceNode.connect(processor);
  processor.connect(ctx.destination);

  orbBig.attachAnalyser(analyserNode, meterBuf);
  state.listening = true;
  $("mic").classList.add("on");
  setState("hearing");
  $("note").textContent = "listening — just talk";

  vadTimer = setInterval(() => {
    if (!state.listening) return;
    const now = performance.now();
    if (speechStarted && now - lastLoud > SILENCE_MS) flipPhrase();
  }, 200);
}

function flipPhrase() {
  if (!speechStarted) return;
  const duration = lastLoud - speechStarted;
  const chunks = state.chunks.slice();
  state.chunks = [];
  speechStarted = 0;

  if (duration < MIN_MS) return;
  if (state.busy) return;

  transcribe(chunks).catch((err) => {
    $("note").textContent = "ear: " + err.message;
    chip("c-ear", "bad");
  });
}

/* ── the ears ─────────────────────────────────────────────────
   Preferred: send the WAV to whisper.cpp on :8081. It is local, private, and
   fast (~0.5 s).

   Fallback: if whisper isn't installed (common on macOS, where whisper.cpp
   ships no prebuilt binary), use the browser's own speech recognition. It
   works, it needs no download — but on Chrome it sends audio to Google, so it
   is a compromise, not the default. The chip tells you which one is in use. */
let earMode = "whisper";      // "whisper" | "browser" | "off"

function browserSTTAvailable() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function listenWithBrowser() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;

  const rec = new SR();
  rec.lang = "en-US";
  rec.interimResults = false;
  rec.continuous = false;
  rec.maxAlternatives = 1;

  const done = (text) => {
    const clean = (text || "").trim();
    $("note").textContent = clean ? "" : "didn't catch that";
    if (clean) send(clean);
    else setState(state.listening ? "hearing" : "waiting");
  };

  rec.onresult = (e) => done(e.results[0][0].transcript);
  rec.onerror = (e) => {
    $("note").textContent = "mic: " + e.error;
    setState(state.listening ? "hearing" : "waiting");
  };
  rec.onend = () => {
    if (state.listening) setState("hearing");
  };

  setState("thinking");
  $("note").textContent = "listening (browser)…";
  rec.start();
}

async function transcribe(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  if (total < sampleRate * 0.2) return;

  if (earMode === "browser") {
    listenWithBrowser();
    return;
  }

  const flat = new Float32Array(total);
  let at = 0;
  for (const c of chunks) { flat.set(c, at); at += c.length; }

  const pcm16 = downsample(flat, sampleRate, 16000);
  const wav = encodeWav(pcm16, 16000);

  setState("thinking");
  $("note").textContent = "hearing you…";

  const t0 = performance.now();
  const fd = new FormData();
  fd.append("file", new Blob([wav], { type: "audio/wav" }), "speech.wav");
  fd.append("response_format", "json");

  const res = await fetch(EAR + "/inference", { method: "POST", body: fd });
  if (!res.ok) throw new Error("ear " + res.status);
  const data = await res.json();
  stat("s-ear", Math.round(performance.now() - t0) + "ms");

  const text = (data.text || "").trim();
  $("note").textContent = text ? "" : "didn't catch that";

  if (text) {
    await send(text);
  } else {
    setState(state.listening ? "hearing" : "waiting");
  }
}

function stopListening() {
  state.listening = false;
  $("mic").classList.remove("on");
  $("note").textContent = "";

  if (vadTimer) { clearInterval(vadTimer); vadTimer = null; }
  if (processor) { processor.onaudioprocess = null; processor.disconnect(); processor = null; }
  if (sourceNode) { sourceNode.disconnect(); sourceNode = null; }
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  state.chunks = [];
  speechStarted = 0;

  orbBig.attachAnalyser(null, null);
  if (!state.source) setState("waiting");
}

function downsample(buffer, from, to) {
  if (to >= from) return buffer;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(buffer.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio), b = Math.floor((i + 1) * ratio);
    let sum = 0, n = 0;
    for (let j = a; j < b && j < buffer.length; j++) { sum += buffer[j]; n++; }
    out[i] = n ? sum / n : 0;
  }
  return out;
}

function encodeWav(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };

  w(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, samples.length * 2, true);

  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

/* ------------------------------------------------------------ */
async function send(text) {
  const box = $("in");
  const question = (text ?? box.value).trim();
  if (!question || state.busy) return;

  box.value = "";
  box.style.height = "50px";
  state.busy = true;
  $("send").disabled = true;
  setState("thinking");

  addTurn("user", question);
  remember("user", question);
  const reply = addTurn("ai", "");
  reply.bubble.innerHTML = '<span style="color:var(--ink-faint)">…</span>';

  try {
    const { text: answer, ms } = await think(question);
    const out = answer || "(no answer)";
    reply.bubble.textContent = out;

    stat("s-lat", Math.round(ms) + "ms");
    const words = out.split(/\s+/).filter(Boolean).length;
    reply.meta.innerHTML =
      `<b>${Math.round(ms)}ms</b><span>${words} words</span>`;

    state.history.push({ role: "user", text: question });
    state.history.push({ role: "assistant", text: out });
    remember("assistant", out);
    stat("s-ctx", String(state.history.reduce((n, t) => n + t.text.split(/\s+/).length, 0)));

    if ($("speak").checked) {
      try {
        await speak(out);
      } catch (err) {
        reply.meta.innerHTML += ` <span style="color:var(--warn)">voice: ${err.message}</span>`;
        chip("c-voice", "bad");
      }
    }
  } catch (err) {
    reply.bubble.textContent = "⚠ " + err.message;
    chip("c-brain", "bad");
  } finally {
    state.busy = false;
    $("send").disabled = false;
    if (!state.source) setState(state.listening ? "hearing" : "waiting");
    box.focus();
  }
}

/* ------------------------------------------------------------ */
/* THE CONTROLS - every knob in the sidebar, wired up            */
/* ------------------------------------------------------------ */

/* persona: show the text box only for "Write your own" */
$("persona").onchange = () => {
  $("custom-persona").style.display = $("persona").value === "custom" ? "block" : "none";
};

/* temperature: label + a plain-English reading of the value */
$("temp").oninput = () => {
  const v = Number($("temp").value);
  $("temp-val").textContent = v.toFixed(2);
  $("temp-hint").textContent =
    v <= 0.3 ? "Very safe. It will repeat itself." :
    v <= 0.7 ? "Balanced. Best for a demo." :
    v <= 1.1 ? "Creative. Starts making things up." :
               "Chaos. Expect nonsense.";
};

$("maxtok").oninput = () => {
  $("maxtok-val").textContent = $("maxtok").value;
};

$("memory").oninput = () => {
  $("memory-val").textContent = $("memory").value;
};

$("speed").oninput = () => {
  $("speed-val").textContent = Number($("speed").value).toFixed(2);
};

/* put everything back the way it shipped */
$("reset").onclick = () => {
  $("persona").value = "jarvis";
  $("custom-persona").style.display = "none";
  $("custom-persona").value = "";
  $("temp").value = 0.4;
  $("maxtok").value = 150;
  $("memory").value = 6;
  $("speed").value = 1;
  $("speak").checked = true;
  $("temp").dispatchEvent(new Event("input"));
  $("maxtok").dispatchEvent(new Event("input"));
  $("memory").dispatchEvent(new Event("input"));
  $("speed").dispatchEvent(new Event("input"));
  $("note").textContent = "settings reset";
  setTimeout(() => { $("note").textContent = ""; }, 1800);
};

/* ── local vs cloud ───────────────────────────────────────── */
function setBackend(which) {
  backend = which;
  $("be-local").classList.toggle("on", which === "local");
  $("be-cloud").classList.toggle("on", which === "cloud");
  $("cloud-setup").style.display = which === "cloud" ? "block" : "none";

  $("backend-note").textContent = which === "cloud"
    ? "Your words leave this laptop and go to Groq. That is the trade."
    : "Nothing leaves this laptop. Unplug the wifi and it still works.";

  $("warn").style.display =
    which === "local" && $("warn").dataset.offline === "1" ? "block" : "none";

  refreshKeyState();
}

function refreshKeyState() {
  const has = !!apiKey();
  $("key-state").textContent = has ? "saved" : "not set";
  $("api-key").value = has ? "••••••••••••" : "";
  $("key-save").disabled = false;
  $("key-delete").disabled = !has;
  loadModels();
}

$("be-local").onclick = () => setBackend("local");
$("be-cloud").onclick = () => setBackend("cloud");

/* remember the chosen model between visits */
$("api-model").addEventListener("change", () => {
  try { localStorage.setItem(MODEL_STORE, $("api-model").value); } catch {}
});

$("key-save").onclick = () => {
  const v = $("api-key").value.trim();
  if (!v || v.startsWith("••")) {
    $("note").textContent = "paste a key first";
    return;
  }
  setApiKey(v);
  refreshKeyState();
  $("note").textContent = "key saved";
  setTimeout(() => { $("note").textContent = ""; }, 1800);
};

$("key-delete").onclick = () => {
  setApiKey("");
  $("api-key").value = "";
  refreshKeyState();
  $("note").textContent = "key deleted";
  setTimeout(() => { $("note").textContent = ""; }, 1800);
};

/* show the key as plain text again as soon as you start typing */
$("api-key").addEventListener("input", () => {
  const el = $("api-key");
  if (el.value.startsWith("••")) el.value = "";
});

$("send").onclick = () => send();

$("in").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
});

$("in").addEventListener("input", () => {
  const el = $("in");
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 150) + "px";
});

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key === "Enter") {
    e.preventDefault();
    state.history = [];
    $("log").innerHTML = "";
    stat("s-ctx", "0");
  }
});

$("mic").onclick = () => {
  if (state.listening) stopListening();
  else startListening();
};

/* ------------------------------------------------------------ */
async function probe() {
  const check = async (url, id) => {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2500) });
      chip(id, r.ok ? "ok" : "bad");
      return r.ok;
    } catch {
      chip(id, "bad");
      return false;
    }
  };

  const brain = await check(BRAIN + "/api/v1/model", "c-brain");
  await check(VOICE + "/health", "c-voice");

  /* the ear has two possible sources: whisper.cpp, or the browser's own
     recognition. Prefer whisper — it's local and private. */
  const whisper = await check(EAR + "/", "c-ear");

  if (whisper) {
    earMode = "whisper";
  } else if (browserSTTAvailable()) {
    earMode = "browser";
    chip("c-ear", "warn");
    $("c-ear").lastChild.textContent = "ear · browser";
  } else {
    earMode = "off";
    chip("c-ear", "bad");
  }

  $("warn").dataset.offline = brain ? "0" : "1";
  $("warn").style.display = brain ? "none" : "block";
}

/* the opening line. Saved with the chat so it survives a reload, but flagged
   `system` so it is never sent to the model as conversation. */
function greet() {
  const text =
    "Good evening, sir. Everything you say stays on this laptop: the model, the " +
    "voice and the ears are all files on this disk. Tap the microphone and simply talk.";
  addTurn("ai", text);

  const chat = currentChat();
  if (chat && !chat.messages.some((m) => m.system)) {
    chat.messages.unshift({ role: "assistant", text, system: true });
    saveChats();
  }
}

async function boot() {
  setState("waiting");

  loadChats();
  if (!chats.length) {
    newChat();
  } else if (activeId && currentChat()) {
    openChat(activeId);
  } else {
    activeId = chats[0].id;
    openChat(activeId);
  }

  $("new-chat").onclick = () => newChat();

  $("export-chats").onclick = () => {
    const blob = new Blob([JSON.stringify(chats, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "jarvis-chats.json";
    a.click();
    URL.revokeObjectURL(a.href);
    $("note").textContent = "exported";
    setTimeout(() => { $("note").textContent = ""; }, 1500);
  };

  setBackend("local");
  await probe();

  $("in").focus();
}

boot();

/* Exposed so you can poke at the running app from the browser console. */
window.__state = state;
window.__send = send;
window.__chats = () => chats;

