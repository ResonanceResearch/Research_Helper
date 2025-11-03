/* Faculty Research Mentor – corrected */
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
  // Show ALL questions in the checklist (answered vs not), including custom ones
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
  // If a full GPT plan exists, show it; otherwise assemble a lightweight live summary
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
    if (els.qSpin) els.qSpin.classList.add("show");
    setInputsDisabled(true);
    // async chips
    suggestChips(q).then(chips => renderChips(chips)).catch(()=> renderChips([])).finally(()=>{
      if (els.qSpin) els.qSpin.classList.remove("show");
      setInputsDisabled(false);
    });
    computeAndRenderProgress();
    renderPlan();
    renderQuestionsPreview();
  }catch(e){
    console.error("renderQuestion error:", e);
    els.qText.textContent = "Error rendering question.";
  }
}

/* Worker interactions */
async function suggestChips(q){
  try{
    if(!window.API_BASE) return [];
    const body = {
      questionText: q.text,
      context: STATE.answers.map(a => ({ id: a.id, answer: a.text, chips: a.chipsAccepted||[] }))
    };
    const res = await fetch(`${window.API_BASE}/api/suggest`, {
      method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body)
    });
    if(!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.chips) ? data.chips.slice(0, 12) : [];
  }catch(e){
    console.warn("suggestChips failed:", e);
    return [];
  }
}

async function exportPlan(){
  const spinner = document.querySelector(".spinner");
  if(spinner) spinner.classList.add("show");
  try{
    if(!window.API_BASE){ alert("Set window.API_BASE in index.html to generate plan with GPT."); return; }
    // Pass RESOURCES to the Worker so it can use them when composing collaborators, etc.
    const res = await fetch(`${window.API_BASE}/api/export`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ context: STATE.answers, resources: RESOURCES })
    });
    if(!res.ok){ alert("Plan generation failed."); return; }
    const txt = await res.text();
    STATE.planText = txt;
    els.actionPlan.textContent = txt;
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
  renderQuestion();
  try{ setupVoice(); }catch{}
})();


/* === Latency wrapper patch v2 (non-destructive, late-apply chips) === */
(function(){
  // Prefetch slot
  if (typeof window.PREFETCHED_NEXT === "undefined") {
    window.PREFETCHED_NEXT = null;
  }

  // Helpers
  async function prefetchNextQuestion(){
    try{
      if(!window.API_BASE || !window.STATE || !Array.isArray(window.STATE.answers)) return;
      const ctx = window.STATE.answers.slice(-5).map(a => ({ id:a.id, answer:a.text, chips:a.chipsAccepted||[] }));
      const res = await fetch(`${window.API_BASE}/api/next-question`, {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ context: ctx })
      });
      if (res.ok){
        const data = await res.json();
        if (data && data.id && data.text) window.PREFETCHED_NEXT = data;
      }
    } catch {}
  }

  // Keep originals
  const _origSuggest = typeof suggestChips === "function" ? suggestChips : null;
  const _origRenderQ = typeof renderQuestion === "function" ? renderQuestion : null;
  const _origSubmit = typeof submitAnswer === "function" ? submitAnswer : null;

  // Wrap suggestChips:
  //  - Q0: return [] immediately (no chips for first question)
  //  - Later: return [] immediately so UI unblocks, but also fetch chips in background;
  //           when they arrive, apply them if still on the same question.
  if (_origSuggest) {
    window.suggestChips = function(q){
      try{
        if (typeof window.idx !== "number") window.idx = 0;
        if (window.idx === 0) return Promise.resolve([]);

        const questionId = q && q.id ? q.id : null;

        // Start slow fetch in background:
        Promise.resolve()
          .then(() => _origSuggest(q))
          .then(chips => {
            if (!chips || !chips.length) return;
            // Only apply if still on the same question
            try{
              const curQ = (window.QUESTIONS && typeof window.idx === "number") ? window.QUESTIONS[window.idx] : null;
              if (curQ && curQ.id === questionId && typeof window.renderChips === "function") {
                window.renderChips(chips);
              }
            } catch {}
          })
          .catch(() => {});

        // Return quickly so renderQuestion() unblocks:
        return Promise.resolve([]);
      } catch (e) {
        try { return _origSuggest(q); } catch { return Promise.resolve([]); }
      }
    };
  }

  // Wrap renderQuestion: call original then prefetch next in the background
  if (_origRenderQ) {
    window.renderQuestion = function(){
      try { _origRenderQ(); } catch(e){ console.error("renderQuestion orig failed:", e); }
      try { prefetchNextQuestion(); } catch {}
    };
  }

  // Wrap submitAnswer: if end reached and a prefetched Q exists, append & show it
  if (_origSubmit) {
    window.submitAnswer = function(){
      const hadPrefetch = !!(window.PREFETCHED_NEXT && window.PREFETCHED_NEXT.id && window.PREFETCHED_NEXT.text);

      try { _origSubmit(); } catch(e){ console.error("submitAnswer orig failed:", e); }

      try {
        const afterIdx = typeof window.idx === "number" ? window.idx : 0;
        const afterLen = Array.isArray(window.QUESTIONS) ? window.QUESTIONS.length : 0;
        const atEnd = (afterIdx >= afterLen - 1);

        if (hadPrefetch && atEnd && window.PREFETCHED_NEXT && window.PREFETCHED_NEXT.id && window.PREFETCHED_NEXT.text) {
          window.QUESTIONS.push({
            ...window.PREFETCHED_NEXT,
            required: false,
            weight: 3,
            default: false,
            custom: true
          });
          window.PREFETCHED_NEXT = null;
          window.STATE = window.STATE || {};
          window.STATE.history = window.STATE.history || [];
          if (typeof window.idx === "number") {
            window.STATE.history.push(window.idx);
            window.idx = window.QUESTIONS.length - 1;
          }
          if (typeof window.renderQuestion === "function") window.renderQuestion();
          prefetchNextQuestion();
        }
      } catch {}
    };
  }
})(); 
/* === end latency wrapper patch v2 === */


