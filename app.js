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
  reset: document.getElementById("resetBtn"),
  exportPlan: document.getElementById("exportPlanBtn"),
  progressFill: document.getElementById("progressFill"),
  progressPct: document.getElementById("progressPct"),
  progressChecklist: document.getElementById("progressChecklist"),
  resourceSearch: document.getElementById("resourceSearch"),
  refreshResources: document.getElementById("refreshResourcesBtn"),
  resourceList: document.getElementById("resourceList"),
  actionPlan: document.getElementById("actionPlan"),
};

let QUESTIONS = [];
let RESOURCES = [];
let idx = 0;

const STATE = {
  answers: [],          // [{id, text, chipsAccepted:[], ts}]
  checklist: {},        // id -> boolean completeness
  history: [],          // navigation history of idx
  feedback: [],         // [{questionId, type:'up'|'down'}]
};

function save() { localStorage.setItem("frm_state", JSON.stringify(STATE)); }
function load() {
  const raw = localStorage.getItem("frm_state");
  if (raw) {
    try { Object.assign(STATE, JSON.parse(raw)); } catch (e) {}
  }
}
function currentAnswerObj() {
  const q = QUESTIONS[idx];
  let o = STATE.answers.find(a => a.id === q.id);
  if (!o) { o = { id: q.id, text: "", chipsAccepted: [], ts: Date.now() }; STATE.answers.push(o); }
  return o;
}
function renderQuestion() {
  const q = QUESTIONS[idx];
  els.qText.textContent = q.text;
  els.input.value = currentAnswerObj().text || "";

  // Request AI chips
  suggestChips(q).then(chips => renderChips(chips)).catch(()=> renderChips([]));

  // Progress
  computeAndRenderProgress();
  // Update plan
  renderPlan();
}
function renderChips(chips) {
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
async function fetchJSON(url) {
  const res = await fetch(url, {cache: "no-store"});
  if (!res.ok) throw new Error("fetch failed");
  return res.json();
}
async function suggestChips(q) {
  const body = {
    questionText: q.text,
    context: STATE.answers.map(a => ({ id: a.id, answer: a.text, chips: a.chipsAccepted }))
  };
  if (!window.API_BASE) return [];
  const res = await fetch(`${window.API_BASE}/api/suggest`, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify(body)
  });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data.chips) ? data.chips.slice(0, 12) : [];
}
function submitAnswer() {
  const q = QUESTIONS[idx];
  const txt = els.input.value.trim();
  const cur = currentAnswerObj();
  cur.text = txt;
  cur.ts = Date.now();
  STATE.checklist[q.id] = !!txt;
  save();
  // advance
  if (idx < QUESTIONS.length - 1) {
    STATE.history.push(idx);
    idx++;
    renderQuestion();
  } else {
    // Ask backend for a follow-up tailored question if available
    nextAdaptiveQuestion();
  }
}
async function nextAdaptiveQuestion() {
  if (!window.API_BASE) return;
  try {
    const res = await fetch(`${window.API_BASE}/api/next-question`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ context: STATE.answers })
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data && data.id && data.text) {
      QUESTIONS.push({ id: data.id, text: data.text, required: false, weight: 3 });
      idx = QUESTIONS.length - 1;
      renderQuestion();
    }
  } catch {}
}
function back() {
  if (STATE.history.length) {
    idx = STATE.history.pop();
    renderQuestion();
  }
}
function skip() {
  if (idx < QUESTIONS.length - 1) {
    STATE.history.push(idx);
    idx++;
    renderQuestion();
  } else {
    nextAdaptiveQuestion();
  }
}
function resetAll() {
  localStorage.removeItem("frm_state");
  STATE.answers = [];
  STATE.checklist = {};
  STATE.history = [];
  STATE.feedback = [];
  idx = 0;
  renderQuestion();
}
function thumbs(up) {
  const q = QUESTIONS[idx];
  STATE.feedback.push({ questionId: q.id, type: up ? "up" : "down" });
  save();
}
function checklistItems() {
  return QUESTIONS.filter(q => q.required).map(q => ({
    id: q.id, text: q.text, done: !!STATE.checklist[q.id], weight: q.weight || 1
  }));
}
function computeAndRenderProgress() {
  const items = checklistItems();
  const total = items.reduce((s, i) => s + i.weight, 0) || 1;
  const done = items.filter(i => i.done).reduce((s, i) => s + i.weight, 0);
  const pct = Math.round((done / total) * 100);
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
function renderPlan() {
  // Simple local synthesis – backend will generate the final plan on export.
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
  if (a.outcomes) lines.push(`12‑month outcomes: ${a.outcomes}`);
  els.actionPlan.textContent = lines.length ? lines.join("\n") : "Your personalized plan will assemble as you go.";
}
async function loadResources() {
  try {
    const data = await fetchJSON(RPATH);
    RESOURCES = data;
    renderResources();
  } catch (e) { /* ignore */ }
}
function renderResources() {
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
async function exportPlan() {
  const payload = {
    context: STATE.answers,
    resources: RESOURCES
  };
  if (!window.API_BASE) {
    alert("Set window.API_BASE in index.html to your Worker endpoint to export.");
    return;
  }
  const res = await fetch(`${window.API_BASE}/api/export`, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    alert("Export failed.");
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "action-plan.txt";
  a.click();
  URL.revokeObjectURL(url);
}

// Event wiring
els.submit.addEventListener("click", submitAnswer);
els.prev.addEventListener("click", back);
els.next.addEventListener("click", skip);
els.reset.addEventListener("click", resetAll);
els.fbGood.addEventListener("click", () => thumbs(true));
els.fbBad.addEventListener("click", () => thumbs(false));
els.refreshResources.addEventListener("click", renderResources);
els.resourceSearch.addEventListener("input", renderResources);
els.exportPlan.addEventListener("click", exportPlan);

(async function init(){
  load();
  try {
    QUESTIONS = await fetchJSON(QPATH);
  } catch (e) {
    QUESTIONS = [{id:"fallback", text:"Describe your research background and interests.", required:true, weight:10}];
  }
  if (idx >= QUESTIONS.length) idx = 0;
  // Load resource seeds
  loadResources();
  renderQuestion();
})();