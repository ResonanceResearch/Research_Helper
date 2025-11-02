/* Faculty Research Mentor – robust init (fixed) */
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

function renderQuestion(){
  try{
    const q = QUESTIONS[idx];
    if(!q){ els.qText.textContent = "Initializing…"; return; }
    els.qText.textContent = q.text || "…";
    els.input.value = currentAnswerObj().text || "";
    computeAndRenderProgress();
    renderPlan();
    renderQuestionsPreview();
  }catch(e){
    console.error("renderQuestion error:", e);
    els.qText.textContent = "Error rendering question.";
  }
}

function renderQuestionsPreview(){
  if(!els.questionsPreview) return;
  els.questionsPreview.innerHTML = "";
  QUESTIONS.forEach(q => {
    const done = !!STATE.checklist[q.id];
    const div = document.createElement("div");
    div.className = "q-item" + (done ? " done" : "");
    div.textContent = (q.required ? "★ " : "") + q.text;
    els.questionsPreview.appendChild(div);
  });
}

function checklistItems(){
  return QUESTIONS.filter(q => q.required)
    .map(q => ({ id: q.id, text: q.text, done: !!STATE.checklist[q.id], weight: q.weight || 1 }));
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
    // get chips async
    suggestChips(QUESTIONS[idx]).then(chips => renderChips(chips)).catch(()=> renderChips([]));
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

function resetAll(){
  try{ localStorage.removeItem("frm_state"); }catch{}
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
  STATE.feedback.push({ questionId: q?.id || "", type: up ? "up" : "down" });
  save();
}

function renderPlan(){
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
    els.actionPlan.textContent = lines.length ? lines.join("\\n") : "Your personalized plan will assemble as you go, and will be generated on demand with GPT.";
  }
}

/* Actions connected to Worker (leave as-is) */
async function exportPlan(){
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

/* Wire events */
els.submit.addEventListener("click", submitAnswer);
els.prev.addEventListener("click", back);
els.next.addEventListener("click", skip);
els.finish.addEventListener("click", finishInterview);
els.reset.addEventListener("click", resetAll);
els.fbGood.addEventListener("click", () => thumbs(true));
els.fbBad.addEventListener("click", () => thumbs(false));
els.refreshResources.addEventListener("click", renderResources);
els.resourceSearch.addEventListener("input", renderResources);
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
  // Fetch initial chips after rendering first question
  try { suggestChips(QUESTIONS[idx]).then(renderChips).catch(()=>{}); } catch {}
})();
