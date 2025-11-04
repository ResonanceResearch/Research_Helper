/* Faculty Research Mentor – app.js (surgical patches: non-blocking chips, chip filter, concise plan) */
const QPATH = "questions.json";
const RPATH = "resources.json";

const els = {
  qText: document.getElementById("questionText"),
  chips: document.getElementById("chips"),
  input: document.getElementById("answerInput"),
  submit: document.getElementById("submitAnswerBtn"),
  prev: document.getElementById("prevBtn"),
  next: document.getElementById("nextBtn"),
  finish: document.getElementById("finishBtn"),
  reset: document.getElementById("resetBtn"),
  exportPlan: document.getElementById("exportPlanBtn"),
  generatePlan: document.getElementById("generatePlanBtn"),
  submitSession: document.getElementById("submitSessionBtn"),
  progressFill: document.getElementById("progressFill"),
  progressPct: document.getElementById("progressPct"),
  progressChecklist: document.getElementById("progressChecklist"),
  questionsPreview: document.getElementById("questionsPreview"),
  resourceSearch: document.getElementById("resourceSearch"),
  refreshResources: document.getElementById("refreshResourcesBtn"),
  resourceList: document.getElementById("resourceList"),
  actionPlan: document.getElementById("actionPlan"),
  micBtn: document.getElementById("micBtn"),
  qSpin: document.getElementById("qSpinner"),
};

let QUESTIONS = [];
let RESOURCES = [];
let idx = 0;

const STATE = {
  answers: [],
  checklist: {},
  history: [],
  finished: false,
  planText: ""
};

/* === NEW: cache & prefetch helpers for chips === */
const CHIPS_CACHE = new Map();
function shouldFetchChips(q, i){
  if (!q) return false;
  if (i === 0) return false;            // skip chips for first question
  if (q.no_chips === true) return false;
  return true;
}
function cacheChips(qid, chips){
  if (!qid) return;
  if (!Array.isArray(chips)) chips = [];
  CHIPS_CACHE.set(qid, chips.slice(0, 12));
}
function getCachedChips(qid){
  return CHIPS_CACHE.has(qid) ? (CHIPS_CACHE.get(qid) || []) : null;
}
async function prefetchChipsFor(i){
  const q = QUESTIONS[i];
  if (!q || !shouldFetchChips(q, i)) return;
  if (getCachedChips(q.id) !== null) return; // already cached
  try {
    const chips = await suggestChips(q);
    cacheChips(q.id, chips);
  } catch { /* ignore prefetch errors */ }
}
function prefetchAhead(fromIndex, count=2){
  const start = Math.max(0, fromIndex + 1);
  const end = Math.min(QUESTIONS.length, start + count);
  for (let i = start; i < end; i++){
    prefetchChipsFor(i);
  }
}

/* === NEW: prune low-value chips to keep only directly useful suggestions === */
function filterChips(q, chips){
  if (!Array.isArray(chips)) return [];
  const seen = new Set();
  const badStarts = /^(list|describe|explain|discuss|outline|note)\b/i;  // e.g. "List lab methods"
  const badExact = new Set(["yes","no","n/a","na","maybe"]);
  const qWords = (q && q.text ? q.text.toLowerCase().split(/\W+/).filter(w=>w.length>3) : []);
  return chips
    .map(c => String(c).trim())
    .filter(c => c && c.length >= 5)                     // very short entries are rarely helpful
    .filter(c => !/[?]$/.test(c))                        // avoid questions as chips
    .filter(c => !badStarts.test(c))                     // avoid generic imperative templates
    .filter(c => !badExact.has(c.toLowerCase()))         // drop yes/no/N/A/maybe
    .filter(c => {                                       // keep those with at least one 4+ char word
      const words = c.toLowerCase().split(/\W+/);
      return words.some(w => w.length >= 4);
    })
    .filter(c => {                                       // simple relevance: share ≥1 word with question if any
      if (!qWords.length) return true;
      const words = new Set(c.toLowerCase().split(/\W+/).filter(w=>w.length>3));
      for (const w of qWords){ if (words.has(w)) return true; }
      return true; // permissive but upstream filters already trimmed
    })
    .filter(c => { const k = c.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 8);
}

function save(){ try{ localStorage.setItem("frm_state", JSON.stringify(STATE)); }catch{} }
function load(){
  try {
    const raw = localStorage.getItem("frm_state");
    if(raw){ Object.assign(STATE, JSON.parse(raw)); }
  } catch (e) { console.warn("State load failed:", e); }
}

function currentAnswerObj(){
  const q = QUESTIONS[idx];
  if(!q){ return { id:"", text:"", chipsAccepted:[], ts:Date.now() }; }
  let o = STATE.answers.find(a => a.id === q.id);
  if(!o){ o = { id: q.id, text: "", chipsAccepted: [], ts: Date.now() }; STATE.answers.push(o); save(); }
  return o;
}

function setInputsDisabled(dis){
  [els.input, els.submit, els.prev, els.next, els.finish].forEach(el => { if (el) el.disabled = !!dis; });
}

function renderChips(chips){
  els.chips.innerHTML = "";
  (chips||[]).forEach(c => {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = c;
    b.onclick = () => {
      els.input.value = (els.input.value ? els.input.value + "; " : "") + c;
      const cur = currentAnswerObj();
      cur.chipsAccepted = cur.chipsAccepted || [];
      cur.chipsAccepted.push(c);
      save();
    };
    els.chips.appendChild(b);
  });
}

function renderQuestionsPreview(){
  if(!els.questionsPreview) return;
  els.questionsPreview.innerHTML = "";
  QUESTIONS.forEach(q => {
    const done = !!STATE.checklist[q.id];
    const div = document.createElement("div");
    div.className = "q-item" + (done ? " done" : "");
    div.textContent = (done ? "✅ " : "⬜️ ") + q.text;
    els.questionsPreview.appendChild(div);
  });
}

function checklistItems(){
  return QUESTIONS.map(q => ({
    id: q.id, text: q.text, done: !!STATE.checklist[q.id], weight: q.weight || 1
  }));
}

function computeAndRenderProgress(forceDone=false){
  const items = checklistItems();
  const total = items.reduce((s,i)=>s+i.weight,0) || 1;
  const done = items.filter(i=>i.done).reduce((s,i)=>s+i.weight,0);
  let pct = Math.round((done/total)*100);
  if(forceDone || STATE.finished) pct = 100;
  if(els.progressFill) els.progressFill.style.width = pct + "%";
  if(els.progressPct) els.progressPct.textContent = pct + "%";
  if(els.progressChecklist){
    els.progressChecklist.innerHTML = "";
    items.forEach(i => {
      const div = document.createElement("div");
      div.className = "progress-item";
      div.innerHTML = `<span>${i.done ? "✅" : "⬜️"}</span><span>${i.text}</span>`;
      els.progressChecklist.appendChild(div);
    });
  }
}

function renderPlan(){
  if(!els.actionPlan) return;
  if (STATE.planText && STATE.planText.trim()) {
    els.actionPlan.textContent = STATE.planText;
    return;
  }
  const ansMap = new Map();
  for (const a of (STATE.answers||[])) {
    ansMap.set(a.id, a.text || "");
  }
  const order = [
    "identity","role_time","expertise","interests","constraints",
    "populations","collab_env","facilities","funding_targets","outcomes"
  ];
  const lines = [];
  for (const k of order) {
    const v = (ansMap.get(k)||"").trim();
    if (!v) continue;
    const label = {
      identity: "Identity",
      role_time: "Appointment & time",
      expertise: "Expertise/assets",
      interests: "Near-term interests",
      constraints: "Constraints",
      populations: "Accessible systems/cohorts",
      collab_env: "Potential collaborators/facilities",
      facilities: "Facilities",
      funding_targets: "Funding targets",
      outcomes: "12-month outcomes"
    }[k] || k;
    lines.push(`${label}: ${v}`);
  }
  els.actionPlan.textContent = lines.length ? lines.join("\n") :
    "Your personalized plan will assemble as you go, and will be generated on demand with GPT.";
}

async function fetchJSON(url){
  const res = await fetch(url, {cache:"no-store"});
  if(!res.ok) throw new Error(`fetch failed: ${url} -> ${res.status}`);
  return res.json();
}

function renderResources(){
  if(!els.resourceList) return;
  els.resourceList.innerHTML = "";
  const q = (els.resourceSearch?.value || "").toLowerCase();
  (RESOURCES||[]).filter(r => !q || JSON.stringify(r).toLowerCase().includes(q)).forEach(r => {
    const d = document.createElement("div");
    d.className = "resource";
    d.innerHTML = `<strong><a href="${r.url}" target="_blank" rel="noopener">${r.title}</a></strong><div>${(r.tags||[]).join(", ")}</div><div>${r.notes||""}</div>`;
    els.resourceList.appendChild(d);
  });
}

function renderQuestion(){
  try{
    const q = QUESTIONS[idx];
    if(!q){ els.qText.textContent = "Initializing…"; return; }
    els.qText.textContent = q.text || "…";
    els.input.value = currentAnswerObj().text || "";

    // Instant render of cached chips; otherwise fetch if appropriate (non-blocking)
    const cached = getCachedChips(q.id);
    if (cached) {
      renderChips(cached);
    } else if (shouldFetchChips(q, idx)) {
      if (els.qSpin) els.qSpin.classList.add("show");
      suggestChips(q)
        .then(chips => { cacheChips(q.id, chips); renderChips(chips); })
        .catch(()=> renderChips([]))
        .finally(()=>{ if (els.qSpin) els.qSpin.classList.remove("show"); });
    } else {
      renderChips([]);
    }

    computeAndRenderProgress();
    renderPlan();
    renderQuestionsPreview();

    // Prefetch upcoming questions
    prefetchAhead(idx, 2);
  }catch(e){
    console.error("renderQuestion error:", e);
    els.qText.textContent = "Error rendering question.";
  }
}

/* Worker interactions */
async function suggestChips(q){
  try{
    const cached = getCachedChips(q.id);
    if (cached !== null) return cached;

    if(!window.API_BASE) return [];
    const recentAnswers = (STATE.answers || []).slice(-5);
    const body = {
      questionText: q.text,
      context: recentAnswers.map(a => ({ id: a.id, answer: a.text, chips: a.chipsAccepted||[] }))
    };
    const res = await fetch(`${window.API_BASE}/api/suggest`, {
      method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body)
    });
    if(!res.ok) return [];
    const data = await res.json();
    const raw = Array.isArray(data.chips) ? data.chips.slice(0, 12) : [];
    const chips = filterChips(q, raw);
    return chips;
  }catch(e){
    console.warn("suggestChips failed:", e);
    return [];
  }
}

/* === NEW: concise plan post-processor (remove follow-ups) === */
function condensePlan(txt){
  if (!txt) return "";
  const lines = txt.replace(/\r/g,"").split("\n");
  const skip = /^(follow-?up|next steps?|consider|further (work|reading)|questions?:)/i;
  const kept = [];
  for (let ln of lines){
    const s = ln.trim();
    if (!s) continue;
    if (skip.test(s)) continue;
    kept.push(s);
  }
  const cleaned = kept.join("\n");
  return cleaned.split(/\n+/).map(p => {
    const m = p.match(/^[-*•]\s*(.+)$/);
    const body = m ? m[1] : p;
    const first = body.split(/(?<=[.!?])\s+/)[0];
    return m ? ("• " + first) : first;
  }).join("\n");
}

async function exportPlan(){
  const spinner = document.querySelector(".spinner");
  if(spinner) spinner.classList.add("show");
  try{
    if(!window.API_BASE){ alert("Set window.API_BASE in index.html to generate plan with GPT."); return; }
    const res = await fetch(`${window.API_BASE}/api/export`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ context: STATE.answers, resources: RESOURCES })
    });
    if(!res.ok){ alert("Plan generation failed."); return; }
    const txt = await res.text();
    const concise = condensePlan(txt);
    STATE.planText = concise;
    els.actionPlan.textContent = concise;
    save();
  } finally { if(spinner) spinner.classList.remove("show"); }
}

async function generatePlan(){ return exportPlan(); }

async function submitSession(){
  try{
    if(!window.API_BASE){ alert("Set window.API_BASE to submit session."); return; }
    const res = await fetch(`${window.API_BASE}/api/submit`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ answers: STATE.answers, checklist: STATE.checklist, finished: STATE.finished, ts: Date.now() })
    });
    const data = await res.json();
    if(!data.ok) alert("Submit failed."); else alert("Session submitted.");
  }catch(e){ alert("Submit failed."); }
}

/* Navigation & actions */
function submitAnswer(){
  const q = QUESTIONS[idx];
  const txt = els.input.value.trim();
  const cur = currentAnswerObj();
  cur.text = txt;
  cur.ts = Date.now();
  if(q) STATE.checklist[q.id] = !!txt;
  save();
  if(idx < QUESTIONS.length - 1){
    STATE.history.push(idx);
    idx++;
    renderQuestion();
  }else{
    finishInterview();
  }
}

function back(){
  if(STATE.history.length){
    idx = STATE.history.pop();
    renderQuestion();
  }
}

function skip(){
  if(idx < QUESTIONS.length - 1){
    STATE.history.push(idx);
    idx++;
    renderQuestion();
  }else{
    finishInterview();
  }
}

function finishInterview(){
  STATE.finished = true;
  computeAndRenderProgress(true);
  save();
}

/* Voice dictation */
let recognition = null;
let recognizing = false;
function setupVoice(){
  const btn = els.micBtn;
  if (!btn) return;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition){
    btn.disabled = true; btn.title = "Voice input not supported in this browser.";
    return;
  }
  recognition = new SpeechRecognition();
  recognition.lang = navigator.language || "en-US";
  recognition.interimResults = true;
  recognition.continuous = false;

  recognition.onstart = () => { recognizing = true; btn.classList.add("recording"); btn.textContent = "⏺"; };
  recognition.onerror = () => { recognizing = false; btn.classList.remove("recording"); btn.textContent = "🎤"; };
  recognition.onend = () => { recognizing = false; btn.classList.remove("recording"); btn.textContent = "🎤"; };
  recognition.onresult = (e) => {
    let interim = "";
    let final = "";
    for (let i=0;i<e.results.length;i++){
      const res = e.results[i];
      if (res.isFinal) final += res[0].transcript;
      else interim += res[0].transcript;
    }
    els.input.value = (final || interim).trim();
  };

  btn.addEventListener("click", () => {
    if (!recognizing){ try { recognition.start(); } catch {} }
    else { try { recognition.stop(); } catch {} }
  });
}

/* Wire events */
els.submit.addEventListener("click", submitAnswer);
els.prev.addEventListener("click", back);
els.next.addEventListener("click", skip);
els.finish.addEventListener("click", finishInterview);
document.getElementById("resetBtn").addEventListener("click", () => {
  try{ localStorage.removeItem("frm_state"); }catch{}
  location.reload();
});
document.getElementById("refreshResourcesBtn").addEventListener("click", renderResources);
document.getElementById("resourceSearch").addEventListener("input", renderResources);
els.exportPlan.addEventListener("click", exportPlan);
els.generatePlan.addEventListener("click", generatePlan);
els.submitSession.addEventListener("click", submitSession);

/* Init */
(async function init(){
  load();
  try {
    QUESTIONS = await fetchJSON(QPATH);
  } catch (e) {
    console.error("Failed to load questions.json:", e);
    QUESTIONS = [{id:"fallback", text:"Describe your research background and interests.", required:true, weight:10}];
  }
  try {
    const rr = await fetchJSON(RPATH).catch(()=>[]);
    RESOURCES = Array.isArray(rr) ? rr : [];
  } catch {
    RESOURCES = [];
  }
  if (idx >= QUESTIONS.length) idx = 0;
  renderResources();

  // Prefetch chips early (skips index 0 via shouldFetchChips)
  prefetchAhead(-1, 3);

  renderQuestion();
  try{ setupVoice(); }catch{}
})();
