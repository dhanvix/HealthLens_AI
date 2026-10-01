require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const crypto = require("crypto");

const app = express();

// Trust proxy so Express sees real client IPs behind Render's load balancer
app.set("trust proxy", 1);

// CORS: allow the production frontend, localhost for dev, and any origin as fallback
const allowedOrigins = [
  process.env.FRONTEND_URL,
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:3000"
].filter(Boolean);
app.use(cors({
  origin: function (origin, cb) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return cb(null, true);
    if (allowedOrigins.some(o => origin.startsWith(o))) return cb(null, true);
    // In production, still allow for now (tighten later if needed)
    cb(null, true);
  }
}));
app.use(express.json({ limit: "1mb" }));

// Simple limit per IP address, so nobody can drain the AI quota or guess passwords
const hits = new Map();
function limit(name, max, windowMs) {
  return (req, res, next) => {
    const k = name + ":" + req.ip, now = Date.now();
    const recent = (hits.get(k) || []).filter(t => now - t < windowMs);
    if (recent.length >= max) return res.status(429).json({ error: "Too many requests. Please wait a few minutes." });
    recent.push(now);
    hits.set(k, recent);
    next();
  };
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // max 10 MB
});

// Text ki har line se test, value, unit, min, max nikalta hai
function parseReport(text) {
  const out = [];
  const num = "(-?\\d+(?:\\.\\d+)?)";
  const both = new RegExp("^(.+?)\\s+" + num + "\\s+(\\S+)\\s+" + num + "\\s*[-\u2013]\\s*" + num + "\\s*$");
  const upper = new RegExp("^(.+?)\\s+" + num + "\\s+(\\S+)\\s+[<\u2264]\\s*" + num + "\\s*$");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    let m;
    if ((m = line.match(both))) {
      out.push({ test: m[1].trim(), value: +m[2], unit: m[3], min: +m[4], max: +m[5] });
    } else if ((m = line.match(upper))) {
      out.push({ test: m[1].trim(), value: +m[2], unit: m[3], min: null, max: +m[4] });
    }
  }
  return out;
}

// =========================================================================
// DATABASE SETUP (SQLite)
// =========================================================================
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = new Database(__dirname + "/healthlens.db");
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

// ---------- Schema: Core tables ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT    UNIQUE NOT NULL,
    pass_hash  TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    last_login TEXT
  );

  CREATE TABLE IF NOT EXISTS profiles (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    dob        TEXT    NOT NULL,
    sex        TEXT    NOT NULL DEFAULT '',
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reports (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    created_at TEXT    NOT NULL,
    file_name  TEXT,
    results    TEXT    NOT NULL
  );
`);

// ---------- Schema: History / Activity tracking tables ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS login_history (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    logged_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    ip_address TEXT,
    user_agent TEXT,
    success    INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS user_activity (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action     TEXT    NOT NULL,
    detail     TEXT,
    page       TEXT,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS voice_queries (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER,
    question   TEXT    NOT NULL,
    answer     TEXT,
    language   TEXT    NOT NULL DEFAULT 'en',
    page       TEXT,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

// Add columns to existing tables if they don't exist yet (safe migration)
try { db.exec("ALTER TABLE users ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'))"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN last_login TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE profiles ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'))"); } catch(e) {}

// Create indexes for faster queries
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_login_history_user   ON login_history(user_id);
  CREATE INDEX IF NOT EXISTS idx_user_activity_user   ON user_activity(user_id);
  CREATE INDEX IF NOT EXISTS idx_voice_queries_user   ON voice_queries(user_id);
  CREATE INDEX IF NOT EXISTS idx_reports_profile      ON reports(profile_id);
  CREATE INDEX IF NOT EXISTS idx_profiles_user        ON profiles(user_id);
`);

console.log("Database ready. Tables: users, profiles, reports, login_history, user_activity, voice_queries");

// ---------- Prepared statements (reusable, faster) ----------
const stmts = {
  insertUser:       db.prepare("INSERT INTO users (email, pass_hash, created_at) VALUES (?, ?, datetime('now'))"),
  findUserByEmail:  db.prepare("SELECT * FROM users WHERE email = ?"),
  findUserById:     db.prepare("SELECT id, email, created_at, last_login FROM users WHERE id = ?"),
  updateLastLogin:  db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?"),
  logLogin:         db.prepare("INSERT INTO login_history (user_id, logged_at, ip_address, user_agent, success) VALUES (?, datetime('now'), ?, ?, ?)"),
  getLoginHistory:  db.prepare("SELECT id, logged_at, ip_address, user_agent, success FROM login_history WHERE user_id = ? ORDER BY id DESC LIMIT ?"),
  logActivity:      db.prepare("INSERT INTO user_activity (user_id, action, detail, page, created_at) VALUES (?, ?, ?, ?, datetime('now'))"),
  getActivity:      db.prepare("SELECT id, action, detail, page, created_at FROM user_activity WHERE user_id = ? ORDER BY id DESC LIMIT ?"),
  logVoiceQuery:    db.prepare("INSERT INTO voice_queries (user_id, question, answer, language, page, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))"),
  getVoiceHistory:  db.prepare("SELECT id, question, answer, language, page, created_at FROM voice_queries WHERE user_id = ? ORDER BY id DESC LIMIT ?"),
  getProfiles:      db.prepare("SELECT id, name, dob, sex, created_at FROM profiles WHERE user_id = ?"),
  insertProfile:    db.prepare("INSERT INTO profiles (user_id, name, dob, sex, created_at) VALUES (?,?,?,?, datetime('now'))"),
  deleteProfile:    db.prepare("DELETE FROM profiles WHERE id = ? AND user_id = ?"),
  ownsProfile:      db.prepare("SELECT 1 FROM profiles WHERE id = ? AND user_id = ?"),
  getReports:       db.prepare("SELECT id, created_at, file_name, results FROM reports WHERE profile_id = ? ORDER BY id DESC"),
  insertReport:     db.prepare("INSERT INTO reports (profile_id, created_at, file_name, results) VALUES (?,?,?,?)"),
  deleteReport:     db.prepare("DELETE FROM reports WHERE id = ? AND profile_id IN (SELECT id FROM profiles WHERE user_id = ?)"),
  userStats:        db.prepare("SELECT (SELECT COUNT(*) FROM profiles WHERE user_id = ?) as profile_count, (SELECT COUNT(*) FROM reports WHERE profile_id IN (SELECT id FROM profiles WHERE user_id = ?)) as report_count, (SELECT COUNT(*) FROM login_history WHERE user_id = ? AND success = 1) as login_count, (SELECT COUNT(*) FROM voice_queries WHERE user_id = ?) as voice_query_count")
};

// =========================================================================
// AUTH (JWT + bcrypt)
// =========================================================================
function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const f = __dirname + "/.jwt-secret";
  try { if (fs.existsSync(f)) return fs.readFileSync(f, "utf8").trim(); } catch (e) {}
  const secret = crypto.randomBytes(32).toString("hex");
  try { fs.writeFileSync(f, secret); } catch (e) {}
  return secret;
}
const SECRET = loadSecret();
const sign = id => jwt.sign({ id }, SECRET, { expiresIn: "7d" });

function auth(req, res, next) {
  try {
    req.uid = jwt.verify((req.headers.authorization || "").replace("Bearer ", ""), SECRET).id;
    next();
  } catch (e) {
    res.status(401).json({ error: "Please log in" });
  }
}

function optionalAuth(req, res, next) {
  try {
    req.uid = jwt.verify((req.headers.authorization || "").replace("Bearer ", ""), SECRET).id;
  } catch (e) {
    req.uid = null;
  }
  next();
}

const cred = b => {
  const email = String(b.email || "").trim().toLowerCase(), password = String(b.password || "");
  return email.includes("@") && password.length >= 6 ? { email, password } : null;
};

// =========================================================================
// AUTH ENDPOINTS
// =========================================================================
app.post("/auth/register", limit("auth", 20, 10 * 60 * 1000), (req, res) => {
  const c = cred(req.body);
  if (!c) return res.status(400).json({ error: "Enter a valid email and a password of at least 6 characters" });
  try {
    const id = stmts.insertUser.run(c.email, bcrypt.hashSync(c.password, 10)).lastInsertRowid;
    const uid = Number(id);
    stmts.updateLastLogin.run(uid);
    stmts.logLogin.run(uid, req.ip, req.headers["user-agent"] || "", 1);
    stmts.logActivity.run(uid, "register", "Account created", null);
    console.log("New user registered:", c.email, "ID:", uid);
    res.json({ token: sign(uid) });
  } catch (e) {
    res.status(400).json({ error: "This email is already registered" });
  }
});

app.post("/auth/login", limit("auth", 20, 10 * 60 * 1000), (req, res) => {
  const c = cred(req.body);
  const u = c && stmts.findUserByEmail.get(c.email);
  if (!u || !bcrypt.compareSync(c.password, u.pass_hash)) {
    if (u) stmts.logLogin.run(u.id, req.ip, req.headers["user-agent"] || "", 0);
    return res.status(401).json({ error: "Wrong email or password" });
  }
  stmts.updateLastLogin.run(u.id);
  stmts.logLogin.run(u.id, req.ip, req.headers["user-agent"] || "", 1);
  stmts.logActivity.run(u.id, "login", "Logged in", null);
  console.log("User logged in:", c.email);
  res.json({ token: sign(u.id) });
});

app.get("/auth/me", auth, (req, res) => {
  const user = stmts.findUserById.get(req.uid);
  if (!user) return res.status(404).json({ error: "User not found" });
  const stats = stmts.userStats.get(req.uid, req.uid, req.uid, req.uid);
  res.json({ ...user, ...stats });
});

// =========================================================================
// HISTORY ENDPOINTS
// =========================================================================
app.get("/history/logins", auth, (req, res) => {
  const lim = Math.min(parseInt(req.query.limit) || 20, 100);
  res.json(stmts.getLoginHistory.all(req.uid, lim));
});

app.get("/history/activity", auth, (req, res) => {
  const lim = Math.min(parseInt(req.query.limit) || 50, 200);
  res.json(stmts.getActivity.all(req.uid, lim));
});

app.get("/history/voice", auth, (req, res) => {
  const lim = Math.min(parseInt(req.query.limit) || 30, 100);
  res.json(stmts.getVoiceHistory.all(req.uid, lim));
});

// =========================================================================
// PROFILES
// =========================================================================
app.get("/profiles", auth, (req, res) => res.json(stmts.getProfiles.all(req.uid)));

app.post("/profiles", auth, (req, res) => {
  const name = String(req.body.name || "").trim().slice(0, 40), dob = String(req.body.dob || "");
  const sex = ["male", "female"].includes(req.body.sex) ? req.body.sex : "";
  if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(dob) || isNaN(new Date(dob))) return res.status(400).json({ error: "Enter a name and a date of birth" });
  const id = stmts.insertProfile.run(req.uid, name, dob, sex).lastInsertRowid;
  stmts.logActivity.run(req.uid, "profile_create", "Created profile: " + name, null);
  res.json({ id: Number(id), name, dob, sex });
});

app.delete("/profiles/:id", auth, (req, res) => {
  stmts.deleteProfile.run(req.params.id, req.uid);
  stmts.logActivity.run(req.uid, "profile_delete", "Deleted profile ID: " + req.params.id, null);
  res.json({ ok: true });
});

// =========================================================================
// REPORTS (with history logging)
// =========================================================================
const owns = (uid, pid) => stmts.ownsProfile.get(pid, uid);

app.get("/reports", auth, (req, res) => {
  if (!owns(req.uid, req.query.profile)) return res.status(404).json({ error: "Profile not found" });
  res.json(stmts.getReports.all(req.query.profile).map(r => ({ ...r, results: JSON.parse(r.results) })));
});

app.post("/reports", auth, (req, res) => {
  const { profile_id, file_name, results } = req.body;
  if (!owns(req.uid, profile_id) || !Array.isArray(results) || !results.length) return res.status(400).json({ error: "Invalid report" });
  const id = stmts.insertReport
    .run(profile_id, new Date().toISOString(), String(file_name || "").slice(0, 100), JSON.stringify(results.slice(0, 100))).lastInsertRowid;
  stmts.logActivity.run(req.uid, "report_upload", "Uploaded report: " + (file_name || "unnamed") + " (" + results.length + " values)", null);
  console.log("Report saved, ID:", Number(id), "values:", results.length);
  res.json({ id: Number(id) });
});

app.delete("/reports/:id", auth, (req, res) => {
  stmts.deleteReport.run(req.params.id, req.uid);
  stmts.logActivity.run(req.uid, "report_delete", "Deleted report ID: " + req.params.id, null);
  res.json({ ok: true });
});

// =========================================================================
// AI EXPLANATION (Gemini / Groq)
// =========================================================================
const SYSTEM = "You help people understand lab report results in simple, calm language.\nRules:\n- You are NOT a doctor. Never diagnose. Never say a person has or does not have a disease, and never say they are healthy.\n- Say things like \"this value is below the range used for this age\".\n- The person's age and sex are given only so you can talk about age-appropriate context.\n- For each flagged test give: \"measures\" (one short sentence on what the test measures), \"reasons\" (2 to 4 common possible reasons a value can be above or below range, written as possibilities such as \"can be linked to\", never as a conclusion about this person) and \"text\" (one calm sentence saying a doctor should interpret it with symptoms, history and other results).\n- Do not recommend medicines, doses or treatments.\n- Questions for the doctor should cover possible explanations, repeat or related tests, and factors like medication, diet or recent illness.\nReply with ONLY valid JSON, no extra text, in this shape:\n{\"explanations\":[{\"test\":\"name\",\"measures\":\"...\",\"reasons\":[\"...\",\"...\"],\"text\":\"...\"}],\"questions\":[\"question 1\",\"question 2\"]}\nGive one explanation per flagged test and 5 to 7 questions.";

const CACHE_FILE = __dirname + "/saved-answers.json";
const cache = new Map();
try {
  if (fs.existsSync(CACHE_FILE)) {
    for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")))) cache.set(k, v);
    console.log("Loaded", cache.size, "saved answer(s)");
  }
} catch (e) { console.error("Could not load saved answers"); }

const wait = ms => new Promise(r => setTimeout(r, ms));
const clean = text => JSON.parse(text.replace(/```json|```/g, "").trim());

async function askGemini(model, lines) {
  const r = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: lines }] }],
        generationConfig: { responseMimeType: "application/json", maxOutputTokens: 3000 }
      })
    }
  );
  const body = await r.json();
  if (!r.ok) { const e = new Error(r.status + " " + JSON.stringify(body.error || body)); e.status = r.status; throw e; }
  return clean(body.candidates[0].content.parts.map(p => p.text || "").join(""));
}

async function askGroq(model, lines) {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + process.env.GROQ_API_KEY },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: 4000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: lines }
      ]
    })
  });
  const body = await r.json();
  if (!r.ok) { const e = new Error(r.status + " " + JSON.stringify(body.error || body)); e.status = r.status; throw e; }
  return clean(body.choices[0].message.content);
}

app.post("/explain", limit("explain", 30, 10 * 60 * 1000), async (req, res) => {
  const flagged = Array.isArray(req.body.flagged) ? req.body.flagged.slice(0, 30) : [];
  if (flagged.length === 0) return res.status(400).json({ error: "Nothing to explain" });

  const p = req.body.profile || {};
  const age = parseInt(p.age, 10);
  const sex = ["male", "female"].includes(p.sex) ? p.sex : "not given";
  if (!(age >= 1 && age <= 120)) return res.status(400).json({ error: "Age is required" });

  const outLang = req.body.language === "hi" ? "Hindi (Devanagari script)" : "English";
  const outLevel = req.body.level === "very-simple"
    ? "very simple: short sentences, everyday words, no medical jargon, explain any needed term in brackets, as if explaining to someone who has never read a lab report"
    : "simple: plain everyday words and short sentences";
  const lines = "Write all explanation and question text in " + outLang + ". Keep test names exactly as written in the report. Reading level: " + outLevel + ".\nPerson: age " + age + ", sex " + sex + ".\nFlagged results from a lab report:\n" + flagged.map(r =>
    String(r.test).slice(0, 60) + ": " + r.value + " " + String(r.unit).slice(0, 20) + " (range used " + (r.min != null ? r.min : "no lower limit") + " to " + (r.max != null ? r.max : "no upper limit") + ", " + r.src + "), " + r.direction + " the range, status " + r.status
  ).join("\n");

  if (cache.has(lines)) return res.json(cache.get(lines));

  const providers = [];
  if (process.env.GROQ_API_KEY) providers.push({ name: "groq", model: process.env.GROQ_MODEL || "openai/gpt-oss-120b", ask: askGroq });
  if (process.env.GEMINI_API_KEY) {
    providers.push({ name: "gemini", model: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite", ask: askGemini });
    if (process.env.GEMINI_FALLBACK_MODEL) providers.push({ name: "gemini", model: process.env.GEMINI_FALLBACK_MODEL, ask: askGemini });
  }

  for (const pr of providers) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const data = await pr.ask(pr.model, lines);
        if (!Array.isArray(data.explanations) || !Array.isArray(data.questions)) throw new SyntaxError("Bad AI shape");
        cache.set(lines, data);
        if (process.env.SAVE_ANSWERS === "true") {
          fs.writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(cache)));
        }
        console.log("AI answer OK from", pr.name, pr.model);
        return res.json(data);
      } catch (err) {
        console.error("AI ERROR (" + pr.name + " " + pr.model + ", try " + attempt + "):", err.message.slice(0, 140));
        if (![429, 500, 503].includes(err.status) && err.name !== "SyntaxError") break;
        await wait(2000);
      }
    }
  }
  res.status(500).json({ error: "AI explanation failed" });
});

// =========================================================================
// VOICE ASSISTANT ENDPOINT (with DB logging)
// =========================================================================
const VOICE_SYSTEM = "You are a friendly health assistant that answers questions about lab reports in simple language.\nRules:\n- You are NOT a doctor. Never diagnose.\n- Keep answers under 3 sentences.\n- If given report context, reference the specific values.\n- Always suggest consulting a doctor for medical decisions.\nReply with JSON: {\"answer\":\"your answer here\"}";

app.post("/voice-ask", optionalAuth, limit("voice", 60, 10 * 60 * 1000), async (req, res) => {
  const question = String(req.body.question || "").trim().slice(0, 500);
  const language = req.body.language === "hi" ? "hi" : "en";
  const reportContext = req.body.report_context;
  const page = String(req.body.page || "").slice(0, 50);

  if (!question) return res.status(400).json({ error: "No question provided" });

  let answer = null;
  const langStr = language === "hi" ? "Hindi (Devanagari script)" : "English";
  const contextStr = reportContext
    ? "\nReport data:\n" + reportContext.map(r => r.test + ": " + r.result + " (range: " + r.range + ", status: " + r.status + ")").join("\n")
    : "";
  const prompt = "Answer in " + langStr + ". Question: \"" + question + "\"" + contextStr;

  const providers = [];
  if (process.env.GROQ_API_KEY) providers.push({ name: "groq", model: process.env.GROQ_MODEL || "openai/gpt-oss-120b" });
  if (process.env.GEMINI_API_KEY) providers.push({ name: "gemini", model: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite" });

  for (const pr of providers) {
    try {
      let data;
      if (pr.name === "groq") {
        const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + process.env.GROQ_API_KEY },
          body: JSON.stringify({
            model: pr.model, temperature: 0.4, max_tokens: 500,
            response_format: { type: "json_object" },
            messages: [{ role: "system", content: VOICE_SYSTEM }, { role: "user", content: prompt }]
          })
        });
        const body = await r.json();
        if (r.ok) data = clean(body.choices[0].message.content);
      } else {
        const keys = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "").split(",")[0].trim();
        const r = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/models/" + pr.model + ":generateContent",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": keys },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: VOICE_SYSTEM }] },
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: { responseMimeType: "application/json", maxOutputTokens: 500 }
            })
          }
        );
        const body = await r.json();
        if (r.ok) data = clean(body.candidates[0].content.parts.map(p => p.text || "").join(""));
      }
      if (data && data.answer) { answer = data.answer; break; }
    } catch (e) {
      console.error("Voice AI error (" + pr.name + "):", e.message.slice(0, 100));
    }
  }

  try {
    stmts.logVoiceQuery.run(req.uid || null, question, answer, language, page);
  } catch (e) { console.error("Failed to log voice query:", e.message); }

  if (answer) {
    if (req.uid) stmts.logActivity.run(req.uid, "voice_ask", question.slice(0, 100), page);
    return res.json({ answer });
  }

  res.status(503).json({ error: "AI unavailable" });
});

// =========================================================================
// FILE EXTRACTION (PDF / Image -> lab values)
// =========================================================================
const visionCache = new Map();

const VISION_PROMPT = 'Read this lab report and list every test that has a numeric result.\nReturn ONLY JSON: {"results":[{"test":"name","value":number,"unit":"unit","min":number or null,"max":number or null}]}\nRules: use the reference range printed on the report (min and max). For a limit like "<200" use min null and max 200; for ">40" use min 40 and max null; if no range is printed use null for both.\nCopy numbers exactly. If a value is unreadable, skip that test; never guess.\nDo NOT include the patient name, age, ID, phone, address, doctor or lab details.';

async function readWithVision(mime, buffer, model, key) {
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ inline_data: { mime_type: mime, data: buffer.toString("base64") } }, { text: VISION_PROMPT }] }],
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: 4000 }
    })
  });
  const body = await r.json();
  if (!r.ok) { const e = new Error(r.status + " " + JSON.stringify(body.error || body)); e.status = r.status; throw e; }
  const data = clean(body.candidates[0].content.parts.map(p => p.text || "").join(""));
  const num = v => (v === null || v === undefined || v === "" || !isFinite(+v)) ? null : +v;
  return (data.results || []).filter(x => x && x.test && num(x.value) !== null).slice(0, 100)
    .map(x => ({ test: String(x.test).slice(0, 60), value: num(x.value), unit: String(x.unit || "").slice(0, 20), min: num(x.min), max: num(x.max) }));
}

app.post("/extract", auth, upload.single("report"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file received" });
  const mime = req.file.mimetype;
  const isPdf = mime === "application/pdf";
  if (!isPdf && !["image/jpeg", "image/png", "image/webp"].includes(mime)) {
    return res.status(400).json({ error: "Please upload a PDF, JPG, PNG or WEBP file" });
  }
  let results = [], source = "text";
  if (isPdf) {
    let parser;
    try {
      const { PDFParse } = require("pdf-parse");
      parser = new PDFParse({ data: req.file.buffer });
      results = parseReport((await parser.getText()).text);
    } catch (e) { console.error("PDF ERROR:", e.message); }
    finally { if (parser) await parser.destroy(); }
  }
  if (results.length < 3) {
    const keys = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "").split(",").map(s => s.trim()).filter(Boolean);
    if (!keys.length) return res.status(400).json({ error: "Reading photos and scanned PDFs needs GEMINI_API_KEY in the .env file" });
    source = "ai";
    const hash = crypto.createHash("sha256").update(req.file.buffer).digest("hex");
    if (visionCache.has(hash)) {
      results = visionCache.get(hash);
      console.log("Extract: from cache,", results.length, "values");
      return res.json({ results, source, name: req.file.originalname });
    }
    const models = (process.env.GEMINI_VISION_MODELS || process.env.GEMINI_VISION_MODEL || "gemini-3.7-flash").split(",").map(s => s.trim()).filter(Boolean);
    let lastErr = null;
    for (let pass = 1; pass <= 2 && !results.length; pass++) {
      for (const model of models) {
        for (const key of keys) {
          try { results = await readWithVision(mime, req.file.buffer, model, key); lastErr = null; break; }
          catch (err) { lastErr = err; console.error("VISION ERROR (" + model + "):", err.message.slice(0, 120)); }
        }
        if (results.length) break;
      }
      if (!results.length && pass === 1) await wait(3000);
    }
    if (results.length) visionCache.set(hash, results);
    else if (lastErr) return res.status(503).json({ error: "The AI reader is busy or its free quota is used up. Wait a minute and try again, or use the demo report." });
  }

  stmts.logActivity.run(req.uid, "report_extract", "Extracted " + results.length + " values via " + source + " from " + (req.file.originalname || "file"), null);
  console.log("Extract:", results.length, "values via", source);
  res.json({ results, source, name: req.file.originalname });
});

// =========================================================================
// START SERVER
// =========================================================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
    console.log(`HealthLens AI Backend Running on port ${PORT}`);
});
