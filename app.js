/* Faculty Research Mentor – front-end logic */
const QPATH = "questions.json";
const RPATH = "resources.json";

const els = {
  qText: document.getElementById("questionText"),
  chips: document.getElementById("chips"),
  input: document.getElementById("answerInput"),
  submit: document.getElementById("submitAnswerBtn"),
  fbGood: document.getElementById("fbGood"),
  fbBad: document.getElementById("fbBad"),
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
};

let QUESTIONS = [];
let DEFAULT_Q_IDS = new Set();
let RESOURCES = [];
let idx = 0;

const STATE = {
  answers: [],
  checklist: {},
  history: [],
  feedback: [],
  finished: false,
  planText: ""
};

function save(){ localStorage.setItem("frm_state", JSON.stringify(STATE)); }
function load(){
  const raw = localStorage.getItem("frm_state");
  if(raw){ try{ Object.assign(STATE, JSON.parse(raw)); }catch{} }
}
function currentAnswerObj(){
  const q = QUESTIONS[idx];
  let o = STATE.answers.find(a => a.id === q.id);
  if(!o){ o = { id: q.id, text: "", chipsAccepted: [], ts: Date.now() }; STATE.answers.push(o); }
  return o;
}

function renderQuestion(){
  const q = QUESTIONS[idx];
  els.qText.textContent = q.text;
  // Show "Custom" badge if not default
  const badge = document.getElementById("customBadge");
  if (badge) badge.style.display = q.default ? "none" : "inline-block";
  const qStatus = document.getElementById("qStatus");
  if (qStatus) qStatus.textContent = "";
  const qSpin = document.getElementById("qSpinner");
  if (qSpin) qSpin.classList.add("show");
  els.input.value = currentAnswerObj().text || "";
  setInputsDisabled(true);
  suggestChips(q).then(chips => renderChips(chips)).catch(()=> renderChips([])).finally(()=>{
    if (qSpin) qSpin.classList.remove("show");
    setInputsDisabled(false);
  });
  computeAndRenderProgress();
  renderPlan();
  renderQuestionsPreview();
}


function setInputsDisabled(disabled){
  [els.input, els.submit, els.prev, els.next, els.finish].forEach(el => { if (el) el.disabled = !!disabled; });
}
function renderChips(chips){

  els.chips.innerHTML = "";
  chips.forEach(c => {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = c;
    b.onclick = () => {
      els.input.value = (els.input.value ? els.input.value + "; " : "") + c;
      const cur = currentAnswerObj();
      cur.chipsAccepted.push(c);
      save();
    };
    els.chips.appendChild(b);
  });
}
async function fetchJSON(url){
  const res = await fetch(url, {cache:"no-store"});
  if(!res.ok) throw new Error("fetch failed");
  return res.json();
}
async function suggestChips(q){
  const body = {
    questionText: q.text,
    context: STATE.answers.map(a => ({ id: a.id, answer: a.text, chips: a.chipsAccepted }))
  };
  if(!window.API_BASE) return [];
  const res = await fetch(`${window.API_BASE}/api/suggest`, {
    method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body)
  });
  if(!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data.chips) ? data.chips.slice(0, 12) : [];
}
function submitAnswer(){
  const q = QUESTIONS[idx];
  const txt = els.input.value.trim();
  const cur = currentAnswerObj();
  cur.text = txt;
  cur.ts = Date.now();
  STATE.checklist[q.id] = !!txt;
  save();
  if(idx < QUESTIONS.length - 1){
    STATE.history.push(idx);
    idx++;
    renderQuestion();

  }else{
    const qStatus = document.getElementById("qStatus");
    if (qStatus) qStatus.textContent = "Fetching a tailored follow-up…";
    nextAdaptiveQuestion(true);
  }
}


async function nextAdaptiveQuestion(optional=false){
  if(!window.API_BASE){ if(optional) finishInterview(); return; }
  const qSpin = document.getElementById("qSpinner");
  if (qSpin) qSpin.classList.add("show");
  setInputsDisabled(true);
  try{
    const res = await fetch(`${window.API_BASE}/api/next-question`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ context: STATE.answers })
    });
    if(!res.ok){ if(optional) finishInterview(); return; }
    const data = await res.json();
    if(data && data.id && data.text){
      QUESTIONS.push({ id: data.id, text: data.text, required: false, weight: 3, default: false, custom: true });
      idx = QUESTIONS.length - 1;
      renderQuestion();
    }else if(optional){
      finishInterview();
    }
  }catch{
    if(optional) finishInterview();
  } finally {
    if (qSpin) qSpin.classList.remove("show");
    setInputsDisabled(false);
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
    const qStatus = document.getElementById("qStatus");
    if (qStatus) qStatus.textContent = "Fetching a tailored follow-up…";
    nextAdaptiveQuestion(true);
  }
}


function finishInterview(){
  STATE.finished = true;
  computeAndRenderProgress(true);
  const qStatus = document.getElementById("qStatus");
  if (qStatus) qStatus.textContent = "Interview complete. You can still add notes, or generate/download the plan.";
  if(window.API_BASE) generatePlan();
  save();
}

function resetAll(){
  localStorage.removeItem("frm_state");
  STATE.answers = [];
  STATE.checklist = {};
  STATE.history = [];
  STATE.feedback = [];
  STATE.finished = false;
  STATE.planText = "";
  idx = 0;
  renderQuestion();
}
function thumbs(up){
  const q = QUESTIONS[idx];
  STATE.feedback.push({ questionId: q.id, type: up ? "up" : "down" });
  save();
}

function checklistItems(){
  // All DEFAULT questions count toward completeness; weight kept
  return QUESTIONS
    .filter(q => q.default)  // only default (non-custom) questions
    .map(q => ({ id: q.id, text: q.text, done: !!STATE.checklist[q.id], weight: q.weight || 1 }));
}

function computeAndRenderProgress(forceDone=false){
  const items = checklistItems();
  const total = items.reduce((s,i)=>s+i.weight,0) || 1;
  const done = items.filter(i=>i.done).reduce((s,i)=>s+i.weight,0);
  let pct = Math.round((done/total)*100);
  if(forceDone || STATE.finished) pct = 100;
  els.progressFill.style.width = pct + "%";
  els.progressPct.textContent = pct + "%";
  els.progressChecklist.innerHTML = "";
  items.forEach(i => {
    const div = document.createElement("div");
    div.className = "progress-item";
    div.innerHTML = `<span>${i.done ? "✅" : "⬜️"}</span><span>${i.text}</span>`;
    els.progressChecklist.appendChild(div);
  });
}

function renderQuestionsPreview(){
  if(!els.questionsPreview) return;
  els.questionsPreview.innerHTML = "";
  QUESTIONS.forEach(q => {
    const done = !!STATE.checklist[q.id];
    const div = document.createElement("div");
    div.className = "q-item" + (done ? " done" : "");
    const prefix = q.default ? "★ " : "⧗ ";
    div.textContent = prefix + q.text;
    els.questionsPreview.appendChild(div);
  });
}

function renderPlan(){
  // Keep a running summary for user context; the GPT plan is generated separately.
  const a = Object.fromEntries(STATE.answers.map(x => [x.id, x.text]));
  const lines = [];
  if (a.identity) lines.push(`Identity: ${a.identity}`);
  if (a.role_time) lines.push(`Appointment & time: ${a.role_time}`);
  if (a.expertise) lines.push(`Expertise/assets: ${a.expertise}`);
  if (a.interests) lines.push(`Near-term interests: ${a.interests}`);
  if (a.constraints) lines.push(`Constraints: ${a.constraints}`);
  if (a.populations) lines.push(`Accessible systems/cohorts: ${a.populations}`);
  if (a.collab_env) lines.push(`Potential collaborators/facilities: ${a.collab_env}`);
  if (a.funding_targets) lines.push(`Funding targets: ${a.funding_targets}`);
  if (a.outcomes) lines.push(`12-month outcomes: ${a.outcomes}`);
  if(STATE.planText){
    els.actionPlan.textContent = STATE.planText;
  }else{
    els.actionPlan.textContent = lines.length ? lines.join("\n") : "Your personalized plan will assemble as you go, and will be generated on demand with GPT.";
  }
}
async function loadResources(){
  try{ RESOURCES = await fetchJSON(RPATH); renderResources(); }catch{}
}
function renderResources(){
  const q = (els.resourceSearch.value || "").toLowerCase();
  const matches = RESOURCES.filter(r => !q || r.title.toLowerCase().includes(q) || r.tags.some(t => t.toLowerCase().includes(q)) || (r.notes||"").toLowerCase().includes(q));
  els.resourceList.innerHTML = "";
  matches.forEach(r => {
    const div = document.createElement("div");
    div.className = "resource";
    div.innerHTML = `<strong>${r.title}</strong><br><a href="${r.url}" target="_blank" rel="noopener">${r.url}</a><p>${r.notes||""}</p>`;
    els.resourceList.appendChild(div);
  });
}

async function exportPlanClick(){
  try{
    if(!window.API_BASE){ alert("Set window.API_BASE to download plan."); return; }
    const res = await fetch(`${window.API_BASE}/api/export`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ context: STATE.answers, resources: [] })
    });
    if(!res.ok){ alert("Download failed."); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "action-plan.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }catch{ alert("Download failed."); }
}
  ];

  try {
    const out = await callOpenAI(prompt, env, /*jsonWanted*/ false);
    return typeof out === "string" ? out : JSON.stringify(out, null, 2);
  } catch (e) {
    // Instead of silently returning fallback, expose the problem:
    throw new Response(
      "OpenAI call failed: " + (e?.message || String(e)),
      { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }
}

async function generatePlan(){
  const spinner = document.querySelector(".spinner");
  if(spinner) spinner.classList.add("show");
  try{
    if(!window.API_BASE){ alert("Set window.API_BASE in index.html to generate plan with GPT."); return; }
    const res = await fetch(`${window.API_BASE}/api/export`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ context: STATE.answers, resources: [] })
    });
    if(!res.ok){ alert("Plan generation failed."); return; }
    const txt = await res.text();
    STATE.planText = txt;
    els.actionPlan.textContent = txt;
    save();
  } finally { if(spinner) spinner.classList.remove("show"); }
}
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


// --- Voice dictation (Web Speech API) ---
let recognition = null;
let recognizing = false;
function setupVoice(){
  const btn = document.getElementById("micBtn");
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

// Event wiring
els.submit.addEventListener("click", submitAnswer);
els.prev.addEventListener("click", back);
els.next.addEventListener("click", skip);
els.finish.addEventListener("click", finishInterview);
els.reset.addEventListener("click", resetAll);
els.fbGood.addEventListener("click", () => thumbs(true));
els.fbBad.addEventListener("click", () => thumbs(false));
els.refreshResources.addEventListener("click", renderResources);
els.resourceSearch.addEventListener("input", renderResources);
els.exportPlan.addEventListener("click", exportPlanClick);
els.generatePlan.addEventListener("click", generatePlan);
els.submitSession.addEventListener("click", submitSession);


(async function init(){
  load();
  try { QUESTIONS = await fetchJSON(QPATH); } catch { QUESTIONS = [{id:"fallback", text:"Describe your research background and interests.", required:true, weight:10}]; }
  // mark defaults
  DEFAULT_Q_IDS = new Set(QUESTIONS.map(q => q.id));
  QUESTIONS = QUESTIONS.map(q => ({ ...q, default: true }));
  if (idx >= QUESTIONS.length) idx = 0;
  loadResources();
  renderQuestion();
  setupVoice();
})();

