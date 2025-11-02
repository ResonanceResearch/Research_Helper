/* Faculty Research Mentor – front-end logic (hotfix build) */
const QPATH = 'questions.json';

const ADAPTIVE_LIMIT = 6; // cap extra GPT-generated questions
let INITIAL_QUESTIONS = null;

const els = {
  qText: document.getElementById('questionText'),
  input: document.getElementById('answerInput'),
  submit: document.getElementById('submitAnswerBtn'),
  voiceBtn: document.getElementById('voiceBtn'),
  genLoader: document.getElementById('genLoader'),
  progressFill: document.getElementById('progressFill'),
  progressLabel: document.getElementById('progressLabel'),
  qPreview: document.getElementById('questionsPreview')
};

let QUESTIONS = [];
const STATE = {
  idx: 0,
  checklist: {}, // id -> true when answered
  finished: false,
  profile: {}
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

/* ---------- Rendering ---------- */
function renderQuestion(i){
  const q = QUESTIONS[i];
  if(!q){ return; }
  els.qText.textContent = q.text || '…';
  els.input.value = '';
}
function computeAndRenderProgress(){
  const list = (INITIAL_QUESTIONS && Array.isArray(INITIAL_QUESTIONS)) ? INITIAL_QUESTIONS : QUESTIONS;
  const total = list.length || 1;
  const done = list.filter(q => STATE.checklist[q.id]).length;
  const pct = Math.round(100 * done / total);
  els.progressFill.style.width = pct + '%';
  els.progressLabel.textContent = pct + '% complete';
}
function renderQuestionsPreview(){
  const list = (INITIAL_QUESTIONS && Array.isArray(INITIAL_QUESTIONS)) ? INITIAL_QUESTIONS : QUESTIONS;
  els.qPreview.innerHTML = list.map(q => {
    const checked = STATE.checklist[q.id] ? '✅' : '⬜';
    return `<div class="q-item">${checked} ${q.text}</div>`;
  }).join('');
}

/* ---------- Interview flow ---------- */
function checklistItems(){
  const list = (INITIAL_QUESTIONS && Array.isArray(INITIAL_QUESTIONS)) ? INITIAL_QUESTIONS : QUESTIONS;
  return list.map(q => ({ id: q.id, text: q.text, done: !!STATE.checklist[q.id], weight: q.weight || 1 }));
}

async function nextAdaptiveQuestion(optional=false){
  // cap
  const genCount = QUESTIONS.length - (INITIAL_QUESTIONS ? INITIAL_QUESTIONS.length : QUESTIONS.length);
  if (genCount >= ADAPTIVE_LIMIT) { if(optional) finishInterview(); return; }

  const loader = els.genLoader;
  const prevLabel = els.submit.textContent;
  if(loader) loader.style.display = 'inline-block';
  els.submit.disabled = true; els.submit.textContent = 'Loading…';

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
    } else {
      if(optional) finishInterview();
    }
  } catch(e){
    if(optional) finishInterview();
  } finally {
    if(loader) loader.style.display = 'none';
    els.submit.disabled = false; els.submit.textContent = prevLabel;
    computeAndRenderProgress();
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
  if(!rec){ alert("Voice dictation is not supported in this browser."); return; }
  if(!recognizing){
    try{ rec.start(); recognizing = true; if(els.voiceBtn) els.voiceBtn.textContent = "⏹️"; }catch{}
  }else{
    try{ rec.stop(); }catch{} recognizing = false; if(els.voiceBtn) els.voiceBtn.textContent = "🎙️";
  }
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
