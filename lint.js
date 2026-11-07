/**
 * lint.js - catches the damage that actually bit us:
 *   - unclosed CSS comments (one stray closer kills the whole sheet)
 *   - slash-slash comments inside CSS (invalid, silently ignored)
 *   - JS syntax errors
 *   - broken file references
 *   - input ids the script expects but the HTML never defines
 *
 * Run:  node lint.js
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = __dirname;
const pass = [];
const fail = [];

const ok = (m) => pass.push(m);
const bad = (m) => fail.push(m);

// ── CSS ───────────────────────────────────────────────────
const cssPath = path.join(ROOT, "app", "style.css");
if (fs.existsSync(cssPath)) {
  const css = fs.readFileSync(cssPath, "utf8");
  const lines = css.split("\n");

  const opens = (css.match(/\/\*/g) || []).length;
  const closes = (css.match(/\*\//g) || []).length;
  opens === closes
    ? ok(`style.css: comments balanced (${opens})`)
    : bad(`style.css: ${opens} openers vs ${closes} closers - a stray closer kills the sheet`);

  const braces = (css.match(/{/g) || []).length - (css.match(/}/g) || []).length;
  braces === 0 ? ok("style.css: braces balanced") : bad(`style.css: brace imbalance ${braces}`);

  const slashes = lines.map((l, i) => ({ l, i: i + 1 })).filter((x) => /^\s*\/\//.test(x.l));
  slashes.length === 0
    ? ok("style.css: no invalid slashes")
    : bad(`style.css: invalid comment at line ${slashes.map((x) => x.i).join(", ")}`);
}

// ── JS parses ─────────────────────────────────────────────
for (const rel of ["app/app.js", "app/orb.js"]) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) continue;
  try {
    execFileSync(process.execPath, ["--check", p], { stdio: "pipe" });
    ok(`${rel}: parses`);
  } catch (e) {
    bad(`${rel}: ${String(e.stderr || e).split("\n").slice(0, 2).join(" ")}`);
  }
}

// ── HTML refs ─────────────────────────────────────────────
const htmlPath = path.join(ROOT, "app", "index.html");
if (fs.existsSync(htmlPath)) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const refs = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map((m) => m[1]);
  const missing = refs.filter((r) => !fs.existsSync(path.join(ROOT, "app", r)));
  missing.length === 0
    ? ok(`index.html: all ${refs.length} refs resolve`)
    : bad(`index.html: missing ${missing.join(", ")}`);

  const app = fs.readFileSync(path.join(ROOT, "app", "app.js"), "utf8");
  const ids = [...new Set([...app.matchAll(/\$\("([^"]+)"\)/g)].map((m) => m[1]))];
  const have = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const gone = ids.filter((i) => !have.has(i));
  gone.length === 0
    ? ok(`app.js: all ${ids.length} element ids exist in the HTML`)
    : bad(`app.js: needs ids the HTML does not have: ${gone.join(", ")}`);
}

// ── python parses ─────────────────────────────────────────
for (const rel of ["setup.py", "start.py", "voice-server.py"]) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) continue;
  try {
    execFileSync("python", ["-c",
      "import ast,sys;ast.parse(open(sys.argv[1],encoding='utf-8').read())", p],
      { stdio: "pipe" });
    ok(`${rel}: parses`);
  } catch {
    bad(`${rel}: syntax error`);
  }
}

// ── setup and start must name the same model file ─────────
if (fs.existsSync(path.join(ROOT, "setup.py")) && fs.existsSync(path.join(ROOT, "start.py"))) {
  const setup = fs.readFileSync(path.join(ROOT, "setup.py"), "utf8");
  const start = fs.readFileSync(path.join(ROOT, "start.py"), "utf8");
  const m = setup.match(/qwen[\w.\-]+\.gguf/);
  if (m && start.includes(m[0])) ok(`setup and start agree on ${m[0]}`);
  else bad("setup.py and start.py disagree about the model filename");
}

// ── report ────────────────────────────────────────────────
pass.forEach((m) => console.log("ok    " + m));
fail.forEach((m) => console.log("FAIL  " + m));
console.log(`\n${pass.length} ok, ${fail.length} failed`);
process.exitCode = fail.length ? 1 : 0;
