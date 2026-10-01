// ---------- Demo data ----------
const DEMO = [
  { test: "Hemoglobin", value: 11.2, unit: "g/dL", min: 12, max: 16 },
  { test: "WBC count", value: 7.2, unit: "10^3/uL", min: 4, max: 11 },
  { test: "Platelets", value: 250, unit: "10^3/uL", min: 150, max: 450 },
  { test: "RBC count", value: 4.6, unit: "10^6/uL", min: 4.2, max: 5.4 },
  { test: "Fasting glucose", value: 108, unit: "mg/dL", min: 70, max: 99 },
  { test: "Total cholesterol", value: 232, unit: "mg/dL", min: null, max: 200 },
  { test: "Creatinine", value: 0.9, unit: "mg/dL", min: 0.6, max: 1.2 },
  { test: "TSH", value: 2.1, unit: "mIU/L", min: 0.4, max: 4.0 },
  { test: "Vitamin D", value: 28, unit: "ng/mL", min: 30, max: 100 },
  { test: "ALT", value: 24, unit: "U/L", min: 7, max: 56 },
  { test: "Sodium", value: 139, unit: "mmol/L", min: 135, max: 145 },
  { test: "Potassium", value: 4.2, unit: "mmol/L", min: 3.5, max: 5.1 }
];
const DEMO_PREV = {
  "Hemoglobin": 10.4, "WBC count": 6.8, "Platelets": 240, "RBC count": 4.4,
  "Fasting glucose": 102, "Total cholesterol": 245, "Creatinine": 0.9, "TSH": 2.4,
  "Vitamin D": 22, "ALT": 30, "Sodium": 138, "Potassium": 4.3
};
const DEMO_PROFILE = { name: "Demo user", age: 35, sex: "female" };

// ---------- Account helpers ----------
const API = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
  ? "http://localhost:3000"
  : "https://healthlens-ai-backend.onrender.com";
const token = () => localStorage.getItem("healthlens_token");
const esc = t => String(t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
async function api(path, method, body) {
  const res = await fetch(API + path, {
    method: method || "GET",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token() },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { localStorage.removeItem("healthlens_token"); location.href = "login.html"; throw new Error("Please log in"); }
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
}
const ageFrom = dob => {
  const d = new Date(dob), n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n < new Date(n.getFullYear(), d.getMonth(), d.getDate())) a--;
  return a;
};
const needLogin = () => { if (!token()) { location.href = "login.html"; return true; } return false; };

// ---------- Accessibility preferences (saved in this browser) ----------
const PREF_KEY = "healthlens_prefs";
const prefs = Object.assign({ contrast: false, dyslexia: false, senior: false, lang: "en", level: "simple" },
  (() => { try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch (e) { return {}; } })());
const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) {} };

// ---------- Dyslexia reading ruler & toast helpers ----------
let rulerEl = null;
let toastEl = null;
let rulerHandler = null;

function ensureRuler() {
  if (!rulerEl) {
    rulerEl = document.createElement("div");
    rulerEl.id = "dyslexia-ruler";
    rulerEl.setAttribute("aria-hidden", "true");
    document.body.appendChild(rulerEl);
  }
}

function ensureToast() {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "dyslexia-toast";
    toastEl.setAttribute("role", "status");
    toastEl.setAttribute("aria-live", "polite");
    document.body.appendChild(toastEl);
  }
}

function showToast(message) {
  ensureToast();
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastEl._timer);
  toastEl._timer = setTimeout(() => toastEl.classList.remove("show"), 2400);
}

function applyPrefs() {
  const c = document.documentElement.classList;
  c.toggle("contrast", prefs.contrast);
  c.toggle("dyslexia", prefs.dyslexia);
  c.toggle("senior", prefs.senior);

  // Manage reading ruler
  ensureRuler();
  if (prefs.dyslexia) {
    if (!rulerHandler) {
      rulerHandler = function (e) {
        rulerEl.style.top = (e.clientY - 24) + "px";
      };
      document.addEventListener("mousemove", rulerHandler, { passive: true });
    }
  } else {
    if (rulerHandler) {
      document.removeEventListener("mousemove", rulerHandler);
      rulerHandler = null;
    }
  }
}

// Text used for the spoken summary and status messages
const T = {
  en: {
    intro: (n, a) => "Report for " + n + ", " + a + " years old.",
    stats: (t, o, w, b) => t + " values analysed. " + o + " normal, " + w + " need attention, " + b + " outside the range.",
    none: "All values are inside the ranges used here.",
    note: "This is not medical advice. Please discuss the results with a doctor.",
    loading: "Preparing a simple explanation..."
  },
  hi: {
    intro: (n, a) => "रिपोर्ट: " + n + ", उम्र " + a + " साल।",
    stats: (t, o, w, b) => t + " जांचों का विश्लेषण हुआ। " + o + " सामान्य हैं, " + w + " पर ध्यान देना चाहिए, और " + b + " सामान्य सीमा से बाहर हैं।",
    none: "सभी मान इस्तेमाल की गई सीमा के अंदर हैं।",
    note: "यह चिकित्सा सलाह नहीं है। कृपया नतीजे डॉक्टर से ज़रूर समझें।",
    loading: "आसान भाषा में समझाया जा रहा है..."
  }
};

// Read text aloud in the chosen language (split into sentences so long text does not cut off)
function speak(text) {
  if (!("speechSynthesis" in window)) { alert("Read aloud is not supported in this browser."); return; }
  const synth = window.speechSynthesis;
  synth.cancel();
  const code = prefs.lang === "hi" ? "hi-IN" : "en-IN";
  const voice = synth.getVoices().find(v => v.lang.replace("_", "-").toLowerCase().startsWith(code.slice(0, 2)));
  if (!voice && prefs.lang === "hi" && synth.getVoices().length) {
    alert("No Hindi voice found on this device. Try Chrome, or install a Hindi voice in your system settings.");
  }
  text.split(/(?<=[.!?।])\s+/).filter(Boolean).forEach(s => {
    const u = new SpeechSynthesisUtterance(s);
    u.lang = code;
    u.rate = 0.9;
    if (voice) u.voice = voice;
    synth.speak(u);
  });
}

// Gather readable text from the current page (for global TTS)
function getPageText() {
  const parts = [];
  // Page title
  const h1 = document.querySelector("main h1, .hero h1, h1");
  if (h1) parts.push(h1.innerText);
  // Subtitle / description
  const sub = document.querySelector(".sub, .hero p");
  if (sub) parts.push(sub.innerText);
  // Cards
  document.querySelectorAll(".card h3, .card p, .steps .card").forEach(el => {
    const t = el.innerText.trim();
    if (t && !parts.includes(t)) parts.push(t);
  });
  // Table rows (simplified)
  const tbody = document.getElementById("tbody");
  if (tbody) {
    const rows = tbody.querySelectorAll("tr");
    rows.forEach(tr => {
      const cells = tr.querySelectorAll("td");
      if (cells.length >= 2) parts.push(cells[0].innerText + ": " + cells[1].innerText + ". Status: " + (cells[3] ? cells[3].innerText : ""));
    });
  }
  // Explanations
  const explain = document.getElementById("explain");
  if (explain && explain.innerText.trim()) parts.push("Explanation. " + explain.innerText);
  // Note / footer
  const note = document.querySelector(".note");
  if (note) parts.push(note.innerText);
  const footer = document.querySelector("footer");
  if (footer) parts.push(footer.innerText);
  return parts.filter(Boolean).join(". ");
}

// Toolbar at the top of every page
function initToolbar() {
  const isReport = !!document.getElementById("tbody");
  const bar = document.createElement("div");
  bar.className = "a11y-bar";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Accessibility options");
  bar.innerHTML =
    '<button type="button" data-k="contrast" aria-pressed="false">High contrast</button>' +
    '<button type="button" data-k="dyslexia" aria-pressed="false">Dyslexic font</button>' +
    '<button type="button" data-k="senior" aria-pressed="false">👵 Senior Mode</button>' +
    (token() ? '<a href="history.html" style="color:#fff">My reports</a><button type="button" id="logoutBtn">Log out</button>' : "") +
    (isReport
      ? '<label>Language <select id="langSel"><option value="en">English</option><option value="hi">हिन्दी</option></select></label>' +
        '<label>Reading level <select id="levelSel"><option value="simple">Simple</option><option value="very-simple">Very simple</option></select></label>'
      : "") +
    // Global TTS buttons — available on EVERY page for visually impaired users
    '<span class="tts-group">' +
      '<button type="button" id="readPageBtn" aria-label="Read this page aloud">🔊 Read Page</button>' +
      '<button type="button" id="stopTtsBtn" aria-label="Stop reading">■ Stop</button>' +
    '</span>';
  document.body.insertBefore(bar, document.body.firstChild);
  const lo = document.getElementById("logoutBtn");
  if (lo) lo.onclick = () => { localStorage.removeItem("healthlens_token"); sessionStorage.clear(); location.href = "login.html"; };

  bar.querySelectorAll("button[data-k]").forEach(b => {
    b.setAttribute("aria-pressed", String(!!prefs[b.dataset.k]));
    b.onclick = () => {
      prefs[b.dataset.k] = !prefs[b.dataset.k];
      b.setAttribute("aria-pressed", String(prefs[b.dataset.k]));
      savePrefs();
      applyPrefs();

      // Show toast for dyslexia mode toggle
      if (b.dataset.k === "dyslexia") {
        showToast(prefs.dyslexia
          ? "✓ Dyslexia-friendly mode ON — OpenDyslexic font, warm background, reading ruler active"
          : "Dyslexia-friendly mode OFF");
      }
    };
  });
  if (isReport) {
    const langSel = document.getElementById("langSel"), levelSel = document.getElementById("levelSel");
    langSel.value = prefs.lang;
    levelSel.value = prefs.level;
    langSel.onchange = () => { prefs.lang = langSel.value; savePrefs(); location.reload(); };
    levelSel.onchange = () => { prefs.level = levelSel.value; savePrefs(); location.reload(); };
  }

  // Global TTS: Read Page button
  const readPageBtn = document.getElementById("readPageBtn");
  const stopTtsBtn = document.getElementById("stopTtsBtn");
  readPageBtn.onclick = () => {
    const text = getPageText();
    if (!text) { alert("No readable content found on this page."); return; }
    readPageBtn.classList.add("speaking");
    speak(text);
    // Remove the speaking class once speech finishes
    const check = setInterval(() => {
      if (!window.speechSynthesis || !window.speechSynthesis.speaking) {
        readPageBtn.classList.remove("speaking");
        clearInterval(check);
      }
    }, 500);
  };
  stopTtsBtn.onclick = () => {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    readPageBtn.classList.remove("speaking");
  };
}
applyPrefs();
initToolbar();

// ---------- Age / sex based reference ranges (approximate, general adult and child values) ----------
// r(age, sex) returns [min, max] or null (null = use the range printed on the report)
const REF = [
  { re: /hemoglobin|haemoglobin|^hb$/i, unit: "g/dl", r: (a, s) => a < 12 ? [11.5, 15.5] : a < 18 ? (s === "male" ? [13, 16] : [12, 16]) : s === "male" ? [13.5, 17.5] : s === "female" ? [12, 15.5] : [12, 17.5] },
  { re: /wbc|white blood/i, unit: "10^3/ul", r: a => a < 6 ? [5.5, 15.5] : a < 12 ? [4.5, 13.5] : [4, 11] },
  { re: /platelet/i, unit: "10^3/ul", r: () => [150, 450] },
  { re: /rbc|red blood/i, unit: "10^6/ul", r: (a, s) => a < 12 ? [3.9, 5.3] : s === "male" ? [4.5, 5.9] : s === "female" ? [4.1, 5.1] : [4.1, 5.9] },
  { re: /fasting.*glucose|glucose.*fasting|^fbs$/i, unit: "mg/dl", r: a => a < 18 ? [60, 100] : [70, 99] },
  { re: /^total cholesterol$|^cholesterol$/i, unit: "mg/dl", r: a => a < 18 ? [null, 170] : [null, 200] },
  { re: /creatinine/i, unit: "mg/dl", r: (a, s) => a < 12 ? [0.3, 0.7] : a < 18 ? [0.5, 1.0] : s === "male" ? [0.7, 1.3] : s === "female" ? [0.6, 1.1] : [0.6, 1.3] },
  { re: /^tsh$|thyroid stimulating/i, unit: "miu/l", r: a => a >= 18 ? [0.4, 4.0] : null },
  { re: /vitamin d/i, unit: "ng/ml", r: () => [30, 100] },
  { re: /^alt$|sgpt|alanine/i, unit: "u/l", r: (a, s) => a >= 18 ? (s === "female" ? [7, 45] : [7, 55]) : null },
  { re: /sodium/i, unit: "mmol/l", r: () => [135, 145] },
  { re: /potassium/i, unit: "mmol/l", r: a => a >= 18 ? [3.5, 5.1] : null }
];
// Each person's old reports are stored under their own name, so people never mix
const pk = (p, kind) => "healthlens_" + kind + ":" + String(p.name).trim().toLowerCase();
const normUnit = u => String(u).toLowerCase().replace(/[\sx×]/g, "").replace(/[µμ]/g, "u");

// Use the age/sex range when we have one for this test and the unit matches, else the range from the report
function withRange(item, p) {
  const ref = REF.find(x => x.re.test(String(item.test).trim()));
  const rng = ref && normUnit(item.unit) === ref.unit ? ref.r(p.age, p.sex) : null;
  if (rng) return { ...item, min: rng[0], max: rng[1], src: "age-adjusted" };
  return { ...item, src: "from report" };
}

// ---------- Rule engine ----------
// Inside range -> normal. Outside by 10% or less -> attention. >30% -> critical. Else -> outside.
function analyze(item) {
  const { value, min, max } = item;
  let direction = null, limit = null;
  if (min !== null && value < min) { direction = "below"; limit = min; }
  else if (max !== null && value > max) { direction = "above"; limit = max; }
  if (!direction) return { ...item, status: "normal", direction: null };
  
  const gap = limit ? Math.abs(value - limit) / limit : 1;
  
  let status = "outside";
  if (gap <= 0.1) status = "attention";
  else if (gap >= 0.3) status = "critical"; // 30% ya zyada hone par red alert
  
  return { ...item, status, direction };
}

function rangeText(i) {
  if (i.min === null) return "below " + i.max + " " + i.unit;
  if (i.max === null) return "above " + i.min + " " + i.unit;
  return i.min + " - " + i.max + " " + i.unit;
}

const LABEL = { 
  normal: "Normal", 
  attention: "Attention", 
  outside: "Outside range", 
  critical: "🔴 Critical Alert" 
};
// ---------- Dashboard page: choose a profile, then upload ----------
const chooseBtn = document.getElementById("chooseBtn");
if (chooseBtn && !needLogin()) {
  const input = document.getElementById("fileInput"), sel = document.getElementById("profileSel");
  let profiles = [];
  const draw = () => {
    sel.innerHTML = profiles.map(p => '<option value="' + p.id + '">' + esc(p.name) + " (" + ageFrom(p.dob) + " yrs)</option>").join("")
      || '<option value="">No profile yet - add one below</option>';
  };
  const current = () => profiles.find(p => String(p.id) === sel.value);
  const asProfile = p => ({ id: p.id, name: p.name, age: ageFrom(p.dob), sex: p.sex });
  api("/profiles").then(p => { profiles = p; draw(); }).catch(() => {});

  document.getElementById("addProfile").onclick = async () => {
    try {
      const p = await api("/profiles", "POST", {
        name: document.getElementById("pName").value,
        dob: document.getElementById("pDob").value,
        sex: document.getElementById("pSex").value
      });
      profiles.push(p); draw(); sel.value = p.id;
      document.getElementById("pName").value = "";
    } catch (e) { alert(e.message); }
  };

  chooseBtn.onclick = () => input.click();
  input.onchange = () => { document.getElementById("fileName").textContent = input.files[0] ? input.files[0].name : ""; };

  document.getElementById("analyzeBtn").onclick = async () => {
    const p = current();
    if (!p) { alert("Please add or choose a profile first."); return; }
    if (!input.files[0]) { alert("Please choose a report file first, or use the demo report."); return; }
    const form = new FormData();
    form.append("report", input.files[0]);
    try {
      const res = await fetch(API + "/extract", { method: "POST", headers: { Authorization: "Bearer " + token() }, body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (!data.results || data.results.length === 0) {
        alert("Could not read any test values. Try a clearer photo, another file, or the demo report.");
        return;
      }
      sessionStorage.setItem("healthlens_profile", JSON.stringify(asProfile(p)));
      sessionStorage.setItem("healthlens_extracted", JSON.stringify(data.results));
      sessionStorage.setItem("healthlens_source", data.source);
      sessionStorage.setItem("healthlens_file", input.files[0].name);
      location.href = "review.html";
    } catch (err) { alert("Upload failed. " + err.message); }
  };

  document.getElementById("demoBtn").onclick = () => {
    const p = current();
    sessionStorage.setItem("healthlens_profile", JSON.stringify(p ? asProfile(p) : DEMO_PROFILE));
    sessionStorage.removeItem("healthlens_results");
    location.href = "report.html";
  };
}

// ---------- Report page ----------
const tbody = document.getElementById("tbody");
if (tbody) {
  const esc = t => String(t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const saved = sessionStorage.getItem("healthlens_results");
  let profile = DEMO_PROFILE;
  try { profile = JSON.parse(sessionStorage.getItem("healthlens_profile")) || DEMO_PROFILE; } catch (e) {}
  const source = saved ? JSON.parse(saved) : DEMO;
  const results = source.map(i => analyze(withRange(i, profile)));
  const count = s => results.filter(r => r.status === s).length;

  const subEl = document.querySelector(".sub");
  if (subEl) subEl.textContent = "Report for " + profile.name + ", " + profile.age + " years. Ranges are adjusted for age" +
    (profile.sex ? " and sex" : "") + " where available; otherwise the range printed on the report is used.";

  document.getElementById("stats").innerHTML =
    '<div class="stat"><b>' + results.length + '</b>values analyzed</div>' +
    '<div class="stat ok"><b>' + count("normal") + '</b>normal</div>' +
    '<div class="stat warn"><b>' + count("attention") + '</b>need attention</div>' +
    '<div class="stat bad"><b>' + count("outside") + '</b>outside range</div>';

  tbody.innerHTML = results.map(r =>
    "<tr><td>" + esc(r.test) + "</td><td>" + r.value + " " + esc(r.unit) + "</td><td>" + esc(rangeText(r)) +
    "<br><small>" + r.src + '</small></td><td><span class="badge ' + r.status + '">' + LABEL[r.status] + "</span></td></tr>"
  ).join("");

  const flagged = results.filter(r => r.status !== "normal");

  // Backup text (shown if the AI is not available, so the demo never breaks)
  const fallbackExplain = flagged.map(r =>
    "<li><b>" + esc(r.test) + ":</b> " + r.value + " " + esc(r.unit) + " is " + r.direction +
    " the range used here (" + esc(rangeText(r)) + "). This can have several explanations and is best discussed with a doctor.</li>"
  ).join("");
  const fallbackQs = [
    "Could any of my medicines, supplements or recent illness explain these results?",
    "Should I repeat any of these tests, and when?",
    "Are there related tests that would give a clearer picture?",
    "Could my diet, sleep or activity level affect these values?"
  ];
  flagged.forEach(r => fallbackQs.push("What could explain my " + r.test + " being " + r.direction + " the reference range?"));
  const qHtml = list => list.map(q => "<li>" + esc(q) + "</li>").join("");

  const explainEl = document.getElementById("explain");
  const questionsEl = document.getElementById("questions");
  const tx = T[prefs.lang] || T.en;
  explainEl.setAttribute("aria-live", "polite");
  explainEl.innerHTML = flagged.length ? fallbackExplain : "<li>" + tx.none + "</li>";
  questionsEl.innerHTML = qHtml(fallbackQs);

  if (flagged.length > 0) {
    explainEl.innerHTML = "<li>" + tx.loading + "</li>";
    explainEl.setAttribute("aria-busy", "true");
    fetch(API + "/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flagged, profile: { age: profile.age, sex: profile.sex }, language: prefs.lang, level: prefs.level }) // name is never sent
    })
      .then(res => { if (!res.ok) throw new Error("AI request failed"); return res.json(); })
      .then(data => {
        explainEl.innerHTML = data.explanations.map(e =>
          "<li><b>" + esc(e.test) + "</b>" +
          (e.measures ? "<br>" + esc(e.measures) : "") +
          (e.text ? "<br>" + esc(e.text) : "") +
          (Array.isArray(e.reasons) && e.reasons.length
            ? "<br><i>Possible reasons (we cannot tell which applies to you):</i><ul>" + e.reasons.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul>"
            : "") + "</li>"
        ).join("");
        questionsEl.innerHTML = qHtml(data.questions);
        questionsEl.lang = explainEl.lang = prefs.lang;
        explainEl.removeAttribute("aria-busy");
      })
      .catch(() => { explainEl.innerHTML = fallbackExplain; explainEl.removeAttribute("aria-busy"); });
  }

  document.getElementById("qBtn").onclick = () => {
    document.getElementById("qPanel").classList.toggle("hidden");
  };


  // ---------- Comparison with previous report ----------
  const key = t => String(t).trim().toLowerCase();
  const distance = (v, min, max) =>
    (min !== null && v < min) ? min - v : (max !== null && v > max) ? v - max : 0;

  function trendSvg(prev, cur, min, max) {
    const vals = [prev, cur];
    if (min !== null) vals.push(min);
    if (max !== null) vals.push(max);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo) * 0.15 || 1;
    const a = lo - pad, b = hi + pad;
    const x = v => ((v - a) / (b - a)) * 120 + 4;
    const x1 = min !== null ? x(min) : 4, x2 = max !== null ? x(max) : 124;
    return '<svg width="128" height="24" viewBox="0 0 128 24" role="img" aria-label="Previous and latest value against the range">' +
      '<rect x="' + x1 + '" y="8" width="' + (x2 - x1) + '" height="8" rx="4" fill="#cfe8d8"/>' +
      '<line x1="' + x(prev) + '" y1="12" x2="' + x(cur) + '" y2="12" stroke="#5b7278" stroke-width="2"/>' +
      '<circle cx="' + x(prev) + '" cy="12" r="5" fill="#fff" stroke="#5b7278" stroke-width="2"/>' +
      '<circle cx="' + x(cur) + '" cy="12" r="5" fill="#1f7a7a"/></svg>';
  }

  const cmpInfo = document.getElementById("compareInfo");
  const renderCompare = (prevMap, prevLabel) => {
    if (!prevMap) {
      cmpInfo.textContent = "Upload an older report first, then a newer one, to see how values changed.";
      document.getElementById("cmpWrap").classList.add("hidden");
      return;
    }
    document.getElementById("cmpWrap").classList.remove("hidden");
    cmpInfo.textContent = prevLabel;
    document.getElementById("cmpBody").innerHTML = results
      .filter(r => prevMap[key(r.test)] !== undefined)
      .map(r => {
        const p = prevMap[key(r.test)];
        const diff = +(r.value - p).toFixed(2);
        const arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "–";
        const dp = distance(p, r.min, r.max), dc = distance(r.value, r.min, r.max);
        const note = (dp === 0 && dc === 0) ? "Within range in both"
          : dc < dp ? "Closer to range" : dc > dp ? "Further from range" : "Same distance from range";
        return "<tr><td>" + esc(r.test) + "</td><td>" + p + " " + esc(r.unit) + "</td><td>" + r.value + " " + esc(r.unit) +
          "</td><td>" + arrow + " " + Math.abs(diff) + "<br><small>" + note + "</small></td><td>" +
          trendSvg(p, r.value, r.min, r.max) + "</td></tr>";
      }).join("");
  };
  if (!saved) {
    const m = {};
    Object.entries(DEMO_PREV).forEach(([t, v]) => m[key(t)] = v);
    renderCompare(m, "Demo: a sample earlier report compared with the sample latest report.");
  } else {
    renderCompare(null);
    const rid = +sessionStorage.getItem("healthlens_report_id");
    if (token() && profile.id) {
      api("/reports?profile=" + profile.id).then(list => {
        const i = list.findIndex(r => r.id === rid);
        const older = i >= 0 ? list[i + 1] : null; // the report saved just before this one
        if (older) {
          const m = {};
          older.results.forEach(r => m[key(r.test)] = r.value);
          renderCompare(m, "Compared with your report from " + older.created_at.slice(0, 10) + ".");
        }
      }).catch(() => {});
    }
  }
}

// ---------- Review page: check and fix the values that were read ----------
const reviewBody = document.getElementById("reviewBody");
if (reviewBody) {
  const esc = t => String(t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let rows = [];
  try { rows = JSON.parse(sessionStorage.getItem("healthlens_extracted")) || []; } catch (e) {}
  document.getElementById("reviewSrc").textContent = sessionStorage.getItem("healthlens_source") === "ai"
    ? "Read from your file using AI. Photos can be misread, so please compare every row with your report."
    : "Read from the PDF text. Please still compare the rows with your report.";

  const st = 'style="width:100%;min-width:70px;padding:6px;border:1px solid var(--line);border-radius:6px;font:inherit"';
  const cell = (k, v, type, label) => '<td><input ' + st + ' data-k="' + k + '" type="' + type + '" step="any" aria-label="' + label +
    '" value="' + (v === null || v === undefined ? "" : esc(v)) + '"></td>';
  const collect = () => [...reviewBody.querySelectorAll("tr")].map(tr => {
    const g = k => tr.querySelector('[data-k="' + k + '"]').value.trim();
    const n = k => g(k) === "" || isNaN(+g(k)) ? null : +g(k);
    return { test: g("test"), value: n("value"), unit: g("unit"), min: n("min"), max: n("max") };
  });
  const draw = () => {
    reviewBody.innerHTML = rows.map((r, i) => "<tr>" + cell("test", r.test, "text", "Test name") + cell("value", r.value, "number", "Value") +
      cell("unit", r.unit, "text", "Unit") + cell("min", r.min, "number", "Lowest normal value") + cell("max", r.max, "number", "Highest normal value") +
      '<td><button type="button" class="btn ghost" data-del="' + i + '" aria-label="Remove this row">✕</button></td></tr>').join("");
    reviewBody.querySelectorAll("[data-del]").forEach(b => b.onclick = () => { rows = collect(); rows.splice(+b.dataset.del, 1); draw(); });
  };
  draw();

  document.getElementById("addRow").onclick = () => { rows = collect(); rows.push({ test: "", value: null, unit: "", min: null, max: null }); draw(); };

  document.getElementById("confirmBtn").onclick = async () => {
    const final = collect().filter(r => r.test);
    if (!final.length || final.some(r => r.value === null)) { alert("Every row needs a test name and a numeric value."); return; }
    let profile = DEMO_PROFILE;
    try { profile = JSON.parse(sessionStorage.getItem("healthlens_profile")) || DEMO_PROFILE; } catch (e) {}
    try {
      const r = await api("/reports", "POST", { profile_id: profile.id, file_name: sessionStorage.getItem("healthlens_file") || "", results: final });
      sessionStorage.setItem("healthlens_report_id", r.id);
    } catch (e) { alert("Could not save this report: " + e.message); return; }
    sessionStorage.setItem("healthlens_results", JSON.stringify(final));
    location.href = "report.html";
  };
}

// ---------- History page: saved reports with search ----------
const histList = document.getElementById("histList");
if (histList && !needLogin()) {
  const sel = document.getElementById("profileSel"), q = document.getElementById("search");
  let profiles = [], reports = [];
  const cur = () => profiles.find(p => String(p.id) === sel.value);
  const load = async () => { reports = sel.value ? await api("/reports?profile=" + sel.value) : []; show(); };
  function show() {
    const t = q.value.trim().toLowerCase();
    const shown = reports.filter(r => !t || r.created_at.slice(0, 10).includes(t) || r.results.some(x => x.test.toLowerCase().includes(t)));
    histList.innerHTML = shown.map(r => {
      const hits = t ? r.results.filter(x => x.test.toLowerCase().includes(t)).map(x => esc(x.test) + ": " + x.value + " " + esc(x.unit)).join(", ") : "";
      return '<div class="card" style="margin-bottom:12px"><b>' + r.created_at.slice(0, 10) + "</b> · " + esc(r.file_name || "report") +
        " · " + r.results.length + " values" + (hits ? "<br><small>" + hits + "</small>" : "") +
        '<div style="margin-top:8px"><button class="btn" data-view="' + r.id + '">View</button> <button class="btn ghost" data-del="' + r.id + '">Delete</button></div></div>';
    }).join("") || "<p>No reports found.</p>";
    histList.querySelectorAll("[data-view]").forEach(b => b.onclick = () => {
      const r = reports.find(x => x.id === +b.dataset.view), p = cur();
      sessionStorage.setItem("healthlens_profile", JSON.stringify({ id: p.id, name: p.name, age: ageFrom(p.dob), sex: p.sex }));
      sessionStorage.setItem("healthlens_results", JSON.stringify(r.results));
      sessionStorage.setItem("healthlens_report_id", r.id);
      location.href = "report.html";
    });
    histList.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
      if (!confirm("Delete this report permanently?")) return;
      await api("/reports/" + b.dataset.del, "DELETE");
      load();
    });
  }
  api("/profiles").then(p => {
    profiles = p;
    sel.innerHTML = p.map(x => '<option value="' + x.id + '">' + esc(x.name) + "</option>").join("");
    load();
  });
  sel.onchange = load;
  q.oninput = show;
}

// ---------- Login page ----------
const loginBtn = document.getElementById("loginBtn");
if (loginBtn) {
  const go = async path => {
    try {
      const r = await fetch(API + path, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: document.getElementById("email").value, password: document.getElementById("password").value })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      localStorage.setItem("healthlens_token", j.token);
      location.href = "dashboard.html";
    } catch (e) { document.getElementById("msg").textContent = e.message; }
  };
  loginBtn.onclick = () => go("/auth/login");
  document.getElementById("registerBtn").onclick = () => go("/auth/register");
}

// =========================================================================
// GLOBAL FLOATING AI VOICE ASSISTANT
// Available on every page — FAB button bottom-right
// =========================================================================
(function initVoiceAssistant() {
  // ---------- Build DOM ----------
  const fab = document.createElement("button");
  fab.className = "voice-fab";
  fab.id = "voiceFab";
  fab.setAttribute("aria-label", "Open AI Voice Assistant");
  fab.innerHTML = "🎙️";
  document.body.appendChild(fab);

  const panel = document.createElement("div");
  panel.className = "voice-panel";
  panel.id = "voicePanel";
  panel.innerHTML =
    '<div class="voice-panel-head">' +
      '<div><h3>🩺 HealthLens Voice Assistant</h3>' +
      '<small>Ask any health question by voice</small></div>' +
      '<div class="voice-lang-toggle">' +
        '<button type="button" data-vlang="en" class="active">EN</button>' +
        '<button type="button" data-vlang="hi">हिं</button>' +
      '</div>' +
    '</div>' +
    '<div class="voice-panel-body" id="voiceChatBody">' +
      '<div class="voice-bubble system">Tap the mic and ask me anything about your health report.</div>' +
    '</div>' +
    '<div class="voice-panel-foot">' +
      '<button type="button" class="voice-mic-btn" id="voiceMicBtn" aria-label="Start listening">🎤</button>' +
      '<div class="voice-status-text" id="voiceStatusText">Tap mic to speak</div>' +
    '</div>';
  document.body.appendChild(panel);

  // ---------- State ----------
  let isOpen = false;
  let isListening = false;
  let voiceLang = prefs.lang || "en";
  const chatBody = document.getElementById("voiceChatBody");
  const micBtn = document.getElementById("voiceMicBtn");
  const statusText = document.getElementById("voiceStatusText");

  // ---------- Toggle panel ----------
  fab.onclick = () => {
    isOpen = !isOpen;
    panel.classList.toggle("open", isOpen);
    fab.classList.toggle("panel-open", isOpen);
    fab.setAttribute("aria-label", isOpen ? "Close AI Voice Assistant" : "Open AI Voice Assistant");
    if (isOpen) chatBody.scrollTop = chatBody.scrollHeight;
  };

  // ---------- Language toggle ----------
  panel.querySelectorAll("[data-vlang]").forEach(btn => {
    if (btn.dataset.vlang === voiceLang) btn.classList.add("active");
    btn.onclick = () => {
      voiceLang = btn.dataset.vlang;
      panel.querySelectorAll("[data-vlang]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      statusText.textContent = voiceLang === "hi" ? "माइक दबाकर बोलें" : "Tap mic to speak";
    };
  });

  // ---------- Add chat bubble ----------
  function addBubble(text, type) {
    const div = document.createElement("div");
    div.className = "voice-bubble " + type;
    div.textContent = text;
    chatBody.appendChild(div);
    chatBody.scrollTop = chatBody.scrollHeight;
    return div;
  }

  function addWave() {
    const div = document.createElement("div");
    div.className = "voice-bubble system";
    div.innerHTML = '<div class="voice-wave"><span></span><span></span><span></span><span></span><span></span></div>';
    chatBody.appendChild(div);
    chatBody.scrollTop = chatBody.scrollHeight;
    return div;
  }

  // ---------- Get page context for smart answers ----------
  function getReportContext() {
    const tbodyEl = document.getElementById("tbody");
    if (!tbodyEl) return null;
    const rows = [];
    tbodyEl.querySelectorAll("tr").forEach(tr => {
      const cells = tr.querySelectorAll("td");
      if (cells.length >= 4) {
        rows.push({
          test: cells[0].innerText.trim(),
          result: cells[1].innerText.trim(),
          range: cells[2].innerText.trim(),
          status: cells[3].innerText.trim()
        });
      }
    });
    return rows.length ? rows : null;
  }

  // ---------- Smart local response (when backend is unavailable) ----------
  function getLocalAnswer(question, lang) {
    const q = question.toLowerCase();
    const reportData = getReportContext();
    const isHi = lang === "hi";

    // Report-specific answers
    if (reportData) {
      const flagged = reportData.filter(r => r.status !== "Normal");
      const normal = reportData.filter(r => r.status === "Normal");

      if (q.match(/how many|kitne|कितने|total|count/i)) {
        return isHi
          ? `आपकी रिपोर्ट में कुल ${reportData.length} टेस्ट हैं। ${normal.length} सामान्य हैं और ${flagged.length} पर ध्यान देना चाहिए।`
          : `Your report has ${reportData.length} tests. ${normal.length} are normal and ${flagged.length} need attention.`;
      }

      if (q.match(/which.*abnormal|which.*outside|कौन.*बाहर|कौन.*abnormal|problem|issue|dikkat|दिक्कत/i)) {
        if (flagged.length === 0) {
          return isHi ? "आपके सभी टेस्ट सामान्य सीमा में हैं।" : "All your test values are within normal range.";
        }
        const names = flagged.map(r => r.test).join(", ");
        return isHi
          ? `ये टेस्ट सामान्य सीमा से बाहर हैं: ${names}। कृपया डॉक्टर से बात करें।`
          : `These tests are outside normal range: ${names}. Please discuss with your doctor.`;
      }

      if (q.match(/hemoglobin|hb|हीमोग्लोबिन/i)) {
        const hb = reportData.find(r => r.test.toLowerCase().includes("hemoglobin"));
        if (hb) {
          return isHi
            ? `आपका हीमोग्लोबिन ${hb.result} है। सामान्य सीमा ${hb.range} है। स्टेटस: ${hb.status}। कम हीमोग्लोबिन एनीमिया का संकेत हो सकता है। आयरन युक्त खाना और विटामिन C लें।`
            : `Your Hemoglobin is ${hb.result}. Normal range is ${hb.range}. Status: ${hb.status}. Low hemoglobin may indicate anemia. Consider iron-rich foods and Vitamin C.`;
        }
      }

      if (q.match(/glucose|sugar|शुगर|ग्लूकोज/i)) {
        const gl = reportData.find(r => r.test.toLowerCase().includes("glucose"));
        if (gl) {
          return isHi
            ? `आपका ग्लूकोज ${gl.result} है। सामान्य सीमा ${gl.range} है। स्टेटस: ${gl.status}। ज़्यादा शुगर प्री-डायबिटीज़ का संकेत हो सकती है।`
            : `Your Glucose is ${gl.result}. Normal range is ${gl.range}. Status: ${gl.status}. Elevated glucose may indicate pre-diabetes.`;
        }
      }

      if (q.match(/cholesterol|कोलेस्ट्रॉल/i)) {
        const ch = reportData.find(r => r.test.toLowerCase().includes("cholesterol"));
        if (ch) {
          return isHi
            ? `आपका कोलेस्ट्रॉल ${ch.result} है। सामान्य सीमा ${ch.range} है। स्टेटस: ${ch.status}। ज़्यादा कोलेस्ट्रॉल दिल की बीमारी का खतरा बढ़ा सकता है।`
            : `Your Cholesterol is ${ch.result}. Normal range is ${ch.range}. Status: ${ch.status}. High cholesterol may increase heart disease risk.`;
        }
      }

      if (q.match(/vitamin d|विटामिन डी/i)) {
        const vd = reportData.find(r => r.test.toLowerCase().includes("vitamin d"));
        if (vd) {
          return isHi
            ? `आपका विटामिन D ${vd.result} है। सामान्य सीमा ${vd.range} है। स्टेटस: ${vd.status}। कम विटामिन D हड्डियों की कमज़ोरी और थकान का कारण हो सकता है।`
            : `Your Vitamin D is ${vd.result}. Normal range is ${vd.range}. Status: ${vd.status}. Low Vitamin D can cause bone weakness and fatigue.`;
        }
      }

      // Generic report question
      if (q.match(/report|रिपोर्ट|summary|सारांश|explain|samjhao|समझाओ/i)) {
        const summary = reportData.map(r => `${r.test}: ${r.result} (${r.status})`).join(". ");
        return isHi
          ? `आपकी रिपोर्ट का सारांश: ${summary}। कृपया किसी भी असामान्य वैल्यू के बारे में डॉक्टर से बात करें।`
          : `Your report summary: ${summary}. Please discuss any abnormal values with your doctor.`;
      }
    }

    // General health questions (any page)
    if (q.match(/what.*healthlens|kya hai.*healthlens|healthlens kya/i)) {
      return isHi
        ? "HealthLens AI आपकी लैब रिपोर्ट को समझने में मदद करता है। रिपोर्ट अपलोड करें और आसान भाषा में जानें कि कौन से टेस्ट सामान्य हैं और कौन से नहीं।"
        : "HealthLens AI helps you understand your lab reports. Upload a report and see which values are normal and which need attention, explained in simple language.";
    }

    if (q.match(/upload|अपलोड|report कैसे|how to/i)) {
      return isHi
        ? "रिपोर्ट अपलोड करने के लिए 'Upload report' पर क्लिक करें, अपनी प्रोफाइल चुनें, और PDF या फोटो अपलोड करें।"
        : "To upload a report, click 'Upload report', select your profile, and upload a PDF or photo of your lab report.";
    }

    // Fallback
    return isHi
      ? "मैं अभी इस सवाल का पूरा जवाब नहीं दे सकता। कृपया अपनी रिपोर्ट पेज पर जाकर किसी specific टेस्ट के बारे में पूछें, या अपने डॉक्टर से बात करें।"
      : "I can't fully answer that question right now. Please go to your report page and ask about a specific test, or consult your doctor for detailed advice.";
  }

  // ---------- Try backend, fallback to local ----------
  async function getAIResponse(question) {
    // Try the backend endpoint first
    try {
      const res = await fetch(API + "/voice-ask", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + (token() || "") },
        body: JSON.stringify({
          question: question,
          language: voiceLang,
          report_context: getReportContext()
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.answer) return data.answer;
      }
    } catch (e) { /* backend unavailable, use local */ }

    // Smart local fallback
    return getLocalAnswer(question, voiceLang);
  }

  // ---------- Speech Recognition ----------
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    statusText.textContent = "Speech recognition not supported in this browser.";
    micBtn.style.opacity = "0.5";
    micBtn.disabled = true;
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = false;

  micBtn.onclick = () => {
    if (isListening) {
      recognition.stop();
      return;
    }
    recognition.lang = voiceLang === "hi" ? "hi-IN" : "en-US";
    try {
      recognition.start();
      isListening = true;
      micBtn.classList.add("listening");
      micBtn.innerHTML = "⏹";
      statusText.textContent = voiceLang === "hi" ? "सुन रहा हूँ... बोलिए" : "Listening... speak now";
    } catch (e) {
      statusText.textContent = "Could not start microphone. Please try again.";
    }
  };

  recognition.onresult = async (event) => {
    isListening = false;
    micBtn.classList.remove("listening");
    micBtn.innerHTML = "🎤";

    const transcript = event.results[0][0].transcript;
    addBubble(transcript, "user");
    statusText.textContent = voiceLang === "hi" ? "सोच रहा हूँ..." : "Thinking...";
    const waveEl = addWave();

    const answer = await getAIResponse(transcript);

    // Remove waveform, add AI response
    waveEl.remove();
    addBubble(answer, "ai");
    statusText.textContent = voiceLang === "hi" ? "माइक दबाकर बोलें" : "Tap mic to speak";

    // Speak the answer aloud
    const origLang = prefs.lang;
    prefs.lang = voiceLang;
    speak(answer);
    prefs.lang = origLang;
  };

  recognition.onerror = (event) => {
    isListening = false;
    micBtn.classList.remove("listening");
    micBtn.innerHTML = "🎤";
    const msg = event.error === "no-speech"
      ? (voiceLang === "hi" ? "कोई आवाज़ नहीं सुनाई दी। फिर कोशिश करें।" : "No speech detected. Try again.")
      : (voiceLang === "hi" ? "माइक्रोफ़ोन में दिक्कत आई। फिर कोशिश करें।" : "Microphone error. Please try again.");
    statusText.textContent = msg;
  };

  recognition.onend = () => {
    isListening = false;
    micBtn.classList.remove("listening");
    micBtn.innerHTML = "🎤";
  };
})();

// =========================================================================
// ANIMATED WAVE BACKGROUND — soft white/blue abstract wave in upper area
// =========================================================================
(function initWaveBackground() {
  const waveBg = document.createElement("div");
  waveBg.className = "wave-bg";
  waveBg.setAttribute("aria-hidden", "true");

  // Three layered SVG waves with slightly different shapes
  waveBg.innerHTML =
    '<svg class="wave-1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2880 420" preserveAspectRatio="none">' +
      '<path d="M0,280 C360,180 720,350 1080,260 C1440,170 1800,320 2160,240 C2520,160 2700,300 2880,280 L2880,0 L0,0 Z" fill="rgba(255,255,255,0.55)"/>' +
    '</svg>' +
    '<svg class="wave-2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2880 420" preserveAspectRatio="none">' +
      '<path d="M0,200 C480,310 960,150 1440,250 C1920,350 2400,180 2880,220 L2880,0 L0,0 Z" fill="rgba(255,255,255,0.45)"/>' +
    '</svg>' +
    '<svg class="wave-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2880 420" preserveAspectRatio="none">' +
      '<path d="M0,320 C400,220 800,380 1200,300 C1600,220 2000,360 2400,280 C2640,230 2760,310 2880,320 L2880,0 L0,0 Z" fill="rgba(255,255,255,0.35)"/>' +
    '</svg>';

  document.body.insertBefore(waveBg, document.body.firstChild);
})();

// =========================================================================
// SCROLL-TRIGGERED FADE-UP ANIMATIONS
// Observes elements with .fade-up and adds .visible when they enter viewport
// =========================================================================
(function initScrollAnimations() {
  const elements = document.querySelectorAll(".fade-up");
  if (!elements.length) return;

  // Add staggered delays to step cards
  document.querySelectorAll(".steps .card.fade-up").forEach((card, i) => {
    card.style.transitionDelay = (i * 0.1) + "s";
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
  );

  elements.forEach((el) => observer.observe(el));
})();