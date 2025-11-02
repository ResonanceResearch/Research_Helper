/* Faculty Research Mentor – full client with restorations + safeguards */
const QPATH = './questions.json'; // adjust if hosted in subfolder

const ADAPTIVE_LIMIT = 6; // cap extra GPT-generated questions
let INITIAL_QUESTIONS = null;

const els = {
  qText: document.getElementById('questionText'),
  input: document.getElementById('answerInput'),
  submit: document.getElementById('submitAnswerBtn'),
  skip: document.getElementById('skipBtn'),
  reset: document.getElementById('resetBtn'),
  exportBtn: document.getElementById('exportBtn'),
  planBtn: document.getElementById('planBtn'),
  voiceBtn: document.getElementById('voiceBtn'),
  loader: document.getElementById('genLoader'),
  chips: document.getElementById('chips'),
  progressFill: document.getElementById('progressFill'),
  progressPct: document.getElementById('progressPct'),
  qPreview: document.getElementById('questionsPreview'),
  planOutput: document.getElementById('planOutput')
};

let QUESTIONS = [];
const STATE = {
  idx: 0,
  checklist: {}, // id -> true when answered
  finished: false,
  profile: {},
  context: [] // list of {id, text, answer}
};

/* ---------- Utilities ---------- */
async function fetchJSON(path){
  const res = await fetch(path, { cache: 'no-store' });
  if(!res.ok) throw new Error('Failed to load '+path);
  return await res.json();
}
function save(){
  try { localStorage.setItem('mentor_state', JSON.stringify(STATE)); } catch {}
}
function load(){
  try {
    const raw = localStorage.getItem('mentor_state');
    if(raw) Object.assign(STATE, JSON.parse(raw));
  } catch {}
}
function slugify(s){
  return (s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
}
function setBusy(b){
  if(b){
    if(els.loader) els.loader.style.display = 'inline-block';
    els.submit.disabled = true; els.submit.textContent = 'Loading…';
  } else {
    if(els.loader) els.loader.style.display = 'none';
    els.submit.disabled = false; els.submit.textContent = 'Submit';
  }
}
function download(filename, text){
  const blob = new Blob([text], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

/* ---------- Rendering ---------- */
function renderQuestion(i){
  const q = QUESTIONS[i];
  if(!q){ return; }
  els.qText.textContent = q.text || '…';
  els.input.value = '';
  renderChips(q);
}
function computeAndRenderProgress(){
  const list = (INITIAL_QUESTIONS && Array.isArray(INITIAL_QUESTIONS)) ? INITIAL_QUESTIONS : QUESTIONS;
  const total = list.length || 1;
  const done = list.filter(q => STATE.checklist[q.id]).length;
  const pct = Math.round(100 * done / total);
  els.progressFill.style.width = pct + '%';
  els.progressPct.textContent = pct + '%';
}
function renderQuestionsPreview(){
  const list = (INITIAL_QUESTIONS && Array.isArray(INITIAL_QUESTIONS)) ? INITIAL_QUESTIONS : QUESTIONS;
  els.qPreview.innerHTML = list.map(q => {
    const checked = STATE.checklist[q.id] ? '✅' : '⬜';
    return `<div class="q-item" data-qid="${q.id}">${checked} ${q.text}</div>`;
  }).join('');
}
function renderChips(q){
  els.chips.innerHTML = '';
  suggestChips(q).then(chips => {
    if(!chips || !chips.length) return;
    els.chips.innerHTML = chips.map(c => `<button class="chip" data-chip="${c}">${c}</button>`).join('');
    els.chips.querySelectorAll('.chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = btn.getAttribute('data-chip');
        els.input.value = (els.input.value ? els.input.value + ' ' : '') + v;
        els.input.focus();
      });
    });
  }).catch(()=>{});
}

/* ---------- Interview flow ---------- */
function checklistItems(){
  const list = (INITIAL_QUESTIONS && Array.isArray(INITIAL_QUESTIONS)) ? INITIAL_QUESTIONS : QUESTIONS;
  return list.map(q => ({ id: q.id, text: q.text, done: !!STATE.checklist[q.id], weight: q.weight || 1 }));
}

async function nextAdaptiveQuestion(optional=false){
  // cap
  const baseLen = (INITIAL_QUESTIONS ? INITIAL_QUESTIONS.length : QUESTIONS.length);
  const genCount = QUESTIONS.length - baseLen;
  if (genCount >= ADAPTIVE_LIMIT) { if(optional) finishInterview(); return; }

  setBusy(true);
  try{
    const res = await fetch('/api/next-question', { method: 'POST' });
    const data = await res.json();
    const q = data && data.question;
    if(q && q.text){
      if(!q.id) q.id = 'q_' + slugify(q.text).slice(0,40);
      QUESTIONS.push(q);
      STATE.idx = QUESTIONS.length - 1;
      renderQuestion(STATE.idx);
      renderQuestionsPreview();
      computeAndRenderProgress();
    } else {
      if(optional) finishInterview();
    }
  } catch(e){
    if(optional) finishInterview();
  } finally {
    setBusy(false);
  }
}

function finishInterview(){
  STATE.finished = true;
  computeAndRenderProgress();
  els.qText.textContent = 'Nice work — profile complete.';
  document.title = 'Faculty Research Mentor — Complete';
  save();
}

async function submitAnswer(){
  const q = QUESTIONS[STATE.idx];
  const a = els.input.value.trim();
  if(!q) return;
  if(!a) return;

  STATE.checklist[q.id] = true;
  STATE.context.push({ id:q.id, text:q.text, answer:a });
  save();
  computeAndRenderProgress();
  renderQuestionsPreview();

  // send to server (best effort, non-blocking UX)
  try {
    await fetch('/api/submit', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ id:q.id, text:q.text, answer:a }) });
  } catch {}

  // move to next default question if any remain
  const list = (INITIAL_QUESTIONS && Array.isArray(INITIAL_QUESTIONS)) ? INITIAL_QUESTIONS : QUESTIONS;
  if(STATE.idx + 1 < list.length){
    STATE.idx += 1;
    renderQuestion(STATE.idx);
    els.input.focus();
  } else {
    // ask for adaptive follow-up; pass optional=true so it can finish cleanly
    nextAdaptiveQuestion(true);
  }
}

async function skipQuestion(){
  const q = QUESTIONS[STATE.idx];
  if(!q) return;
  // record skip (not done)
  STATE.context.push({ id:q.id, text:q.text, answer:'(skipped)' });
  save();
  // move on the same way as submit, but without checklist done
  const list = (INITIAL_QUESTIONS && Array.isArray(INITIAL_QUESTIONS)) ? INITIAL_QUESTIONS : QUESTIONS;
  if(STATE.idx + 1 < list.length){
    STATE.idx += 1;
    renderQuestion(STATE.idx);
  } else {
    nextAdaptiveQuestion(true);
  }
}

function resetInterview(){
  if(!confirm('Reset this interview? All local progress will be cleared.')) return;
  localStorage.removeItem('mentor_state');
  STATE.idx = 0;
  STATE.checklist = {};
  STATE.finished = false;
  STATE.context = [];
  computeAndRenderProgress();
  renderQuestionsPreview();
  renderQuestion(0);
  els.planOutput.style.display = 'none';
  els.planOutput.textContent = '';
}

async function generatePlan(){
  setBusy(true);
  els.planOutput.style.display = 'block';
  els.planOutput.textContent = 'Generating plan…';
  try {
    const res = await fetch('/api/plan', { method:'POST' });
    const data = await res.json();
    const plan = (data && (data.plan || data.text)) ? (data.plan || data.text) : JSON.stringify(data, null, 2);
    els.planOutput.textContent = plan;
  } catch (e){
    els.planOutput.textContent = 'Plan generation failed.';
  } finally {
    setBusy(false);
  }
}

function exportSession(){
  const payload = {
    profile: STATE.profile,
    checklist: STATE.checklist,
    context: STATE.context,
    completed: STATE.finished,
    timestamp: new Date().toISOString()
  };
  download('research_helper_session.json', JSON.stringify(payload, null, 2));
}

/* ---------- Voice dictation ---------- */
let recognizer = null;
let recognizing = false;
function ensureRecognizer(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR) return null;
  if(!recognizer){
    recognizer = new SR();
    recognizer.lang = "en-US";
    recognizer.interimResults = true;
    recognizer.continuous = true;
    recognizer.onresult = (e) => {
      let finalTranscript = "";
      for(let i= e.resultIndex; i < e.results.length; i++){
        const res = e.results[i];
        if(res.isFinal) finalTranscript += res[0].transcript;
      }
      if(finalTranscript){
        els.input.value = (els.input.value ? els.input.value + " " : "") + finalTranscript.trim();
      }
    };
    recognizer.onend = () => { recognizing = false; if(els.voiceBtn) els.voiceBtn.textContent = "🎙️"; };
    recognizer.onerror = () => { recognizing = false; if(els.voiceBtn) els.voiceBtn.textContent = "🎙️"; };
  }
  return recognizer;
}
function toggleVoice(){
  const rec = ensureRecognizer();
  if(!rec){ alert("Voice dictation is not supported in this browser. Try Chrome."); return; }
  if(!recognizing){
    try{ rec.start(); recognizing = true; if(els.voiceBtn) els.voiceBtn.textContent = "⏹️"; }catch{}
  }else{
    try{ rec.stop(); }catch{} recognizing = false; if(els.voiceBtn) els.voiceBtn.textContent = "🎙️";
  }
}

/* ---------- Chips ---------- */
async function suggestChips(q){
  try{
    // backend will use profile/context/openalex; we send minimal signal here
    const res = await fetch('/api/suggest', { method:'POST' });
    const data = await res.json();
    if(Array.isArray(data.chips)) return data.chips;
    if(Array.isArray(data)) return data;
    return [];
  } catch { return []; }
}

/* ---------- Boot ---------- */
async function boot(){
  load();

  // Load questions.json with robust fallback
  try{
    const q = await fetchJSON(QPATH);
    if(!Array.isArray(q) || !q.length) throw new Error('Empty questions.json');
    QUESTIONS = q.map((x, i) => ({ id: x.id || ('q'+(i+1)), text: x.text, required: !!x.required, weight: x.weight || 1 }));
  } catch(e){
    // minimal fallback default questions
    QUESTIONS = [
      { id:'q1', text:'What is your research area?', required:true, weight:1 },
      { id:'q2', text:'Who are your core collaborators?', required:true, weight:1 },
      { id:'q3', text:'What is your next funding deadline?', required:true, weight:1 }
    ];
  }
  if(!INITIAL_QUESTIONS) INITIAL_QUESTIONS = JSON.parse(JSON.stringify(QUESTIONS));

  // Clamp idx
  if(STATE.idx < 0 || STATE.idx >= QUESTIONS.length) STATE.idx = 0;

  // Render
  renderQuestion(STATE.idx);
  renderQuestionsPreview();
  computeAndRenderProgress();

  // Wire events
  els.submit.addEventListener('click', submitAnswer);
  els.skip.addEventListener('click', skipQuestion);
  els.reset.addEventListener('click', resetInterview);
  els.exportBtn.addEventListener('click', exportSession);
  els.planBtn.addEventListener('click', generatePlan);
  if(els.voiceBtn) els.voiceBtn.addEventListener('click', toggleVoice);
  els.input.addEventListener('keydown', (e)=>{
    if(e.key === 'Enter') submitAnswer();
  });
}

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', boot);
}else{
  boot();
}

/* Front-end only: prompts live in worker.js; app calls API endpoints. */
