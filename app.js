const APP_VERSION="20251028-220241"; console.log("grant-interviewer app.js version", APP_VERSION);

// Static seeds for first render (used only if nothing else present)
const STATIC_CHIPS = {
  "funding_agency": ["NSERC Discovery","CIHR Project","Genome Canada","Alberta Innovates"],
  "keywords": ["genomics","AMR","mastitis","nanopore"],
  "timeline": ["Jan–Dec 2026","Q1–Q4 2026","36 months"],
  "budget": ["$50k","$250k","$1M"],
  "pi_name": ["J. De Buck","K. Orsel","H. Barkema"],
  "project_title": ["Working title","Draft title"]
};
/* Minimal SPA logic for Q-by-Q flow + chips + voice dictation + local/remote save */
const state = {
  userId: null,
  anon: false,
  personalize: true,
  idx: 0,
  questions: [],
  answers: {},           // { questionId: {text:"", chipsUsed:[...]} }
  localChips: {},        // { questionId: [ "chip1", "chip2", ...] } learned locally
  recognition: null,
  listening: false
};
// Resolve API base:
// - Prefer window.API_BASE (from index.html)
// - Else use localStorage('api_base')
// - Else empty string for local Express dev (same origin)
const API_BASE = (function(){
  try { if (window.API_BASE) return window.API_BASE; } catch {}
  try { const ls = localStorage.getItem('api_base'); if (ls) return ls; } catch {}
  return "";
})();

function apiUrl(path){
  const base = (API_BASE || "").replace(/\/$/, "");
  const p = (path || "").startsWith("/") ? path : ("/" + (path || ""));
  return base + p;
}


// Utilities
function uuidv4(){
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}
function $(sel){ return document.querySelector(sel); }
function setStatus(msg){ $("#status").textContent = msg; }

async function loadQuestions(){
  const res = await fetch("questions.json");
  state.questions = await res.json();
  updateProgress();
  renderQuestion();
}

function restoreLocal(){
  const saved = JSON.parse(localStorage.getItem("interview_state") || "{}");
  if(saved.userId) state.userId = saved.userId;
  if(saved.answers) state.answers = saved.answers;
  if(saved.localChips) state.localChips = saved.localChips;
  if(saved.personalize !== undefined) state.personalize = saved.personalize;
  if(saved.anon !== undefined) state.anon = saved.anon;

  if(!state.userId) state.userId = uuidv4();
  $("#personalize-toggle").checked = state.personalize;
  $("#anon-toggle").checked = state.anon;
}

function persistLocal(){
  localStorage.setItem("interview_state", JSON.stringify({
    userId: state.userId,
    answers: state.answers,
    localChips: state.localChips,
    personalize: state.personalize,
    anon: state.anon
  }));
}

function updateProgress(){
  $("#progress-text").textContent = `Question ${state.idx+1}/${state.questions.length}`;
}

function currentQuestion(){
  return state.questions[state.idx];
}

function renderQuestion(){
  const q = currentQuestion();
  $("#question-text").textContent = q.text;
  const ans = state.answers[q.id]?.text || "";
  $("#answer-input").value = ans;
  renderChips(q.id);
  renderReview();
  updateProgress();
}

function addChip(questionId, chipText){
  if(!state.localChips[questionId]) state.localChips[questionId] = [];
  if(!state.localChips[questionId].includes(chipText)){
    state.localChips[questionId].push(chipText);
  }
}

function renderChips(questionId){
  const wrap = $("#chips");
  wrap.innerHTML = "";
  const gathered = new Set();
  // Seed statics on first render
  (STATIC_CHIPS[questionId] || []).forEach(c => gathered.add(c));

  // Local chips (from previous answers on this device)
  (state.localChips[questionId] || []).forEach(c => gathered.add(c));

  // Server chips (fetched async below) will be added later
  for(const text of gathered){
    const el = document.createElement("button");
    el.className = "chip";
    el.textContent = text;
    el.addEventListener("click", () => {
      $("#answer-input").value = text;
    });
    wrap.appendChild(el);
  }

  // Also fetch server-side suggestions if available
  fetchServerChips(questionId).catch(()=>{});
}

async function fetchServerChips(questionId){
  const q = currentQuestion();
  const body = {
    questionId,
    questionText: q.text,
    context: buildContext(),
    userId: state.anon ? null : state.userId,
    personalize: state.personalize
  };
  try{
    const res = await fetch(apiUrl("/api/suggest"), {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(body)
    });
    if(!res.ok) return;
    const data = await res.json();
    console.log("chips status:", res.status, data);
    if(Array.isArray(data.chips)){
      const wrap = $("#chips");
      // Filter duplicates vs local
      const existing = new Set(Array.from(wrap.querySelectorAll(".chip")).map(n=>n.textContent));
      for(const text of data.chips){
        if(!existing.has(text)){
          const el = document.createElement("button");
          el.className = "chip";
          el.textContent = text;
          el.addEventListener("click", () => { $("#answer-input").value = text; });
          wrap.appendChild(el);
        }
      }
    }
  }catch(e){
    // silent fail (likely static mode or offline)
  }
}

function buildContext(){
  const ctx = [];
  for(const q of state.questions){
    const a = state.answers[q.id]?.text || "";
    if(a) ctx.push({id:q.id, question:q.text, answer:a});
  }
  return ctx;
}

function captureAnswer(moveNext=true, skipped=false){
  const q = currentQuestion();
  const text = skipped ? "" : ($("#answer-input").value || "").trim();
  state.answers[q.id] = state.answers[q.id] || { text:"", chipsUsed:[] };
  state.answers[q.id].text = text;
  if(text) addChip(q.id, text); // learn locally as chip

  persistLocal();
  if(moveNext){
    if(state.idx < state.questions.length - 1){
      state.idx++;
      renderQuestion();
    }else{
      // End -> show review card more prominently
      document.querySelector(".review-card").scrollIntoView({behavior:"smooth"});
    }
  }else{
    renderReview();
  }
}


  // If still no chips after server/local seeds, show placeholder
  setTimeout(() => {
    const wrap = document.getElementById("chips");
    if (wrap && !wrap.querySelector(".chip")) {
      const el = document.createElement("span");
      el.className = "chip chip-empty";
      el.textContent = "No suggestions yet";
      wrap.appendChild(el);
    }
  }, 300);
function renderReview(){
  const list = $("#answers-list");
  list.innerHTML = "";
  for(const q of state.questions){
    const ans = state.answers[q.id]?.text || "";
    const div = document.createElement("div");
    div.className = "answer-item";
    div.innerHTML = `<strong>${q.text}</strong><div>${ans ? escapeHtml(ans) : '<em>(no answer)</em>'}</div>`;
    list.appendChild(div);
  }
}
function escapeHtml(str){
  return str.replace(/[&<>"']/g, s => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[s]));
}

// Speech-to-text via Web Speech API (browser-dependent)
function initSTT(){
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SpeechRecognition){
    setStatus("Voice dictation not supported in this browser.");
    return;
  }
  const rec = new SpeechRecognition();
  rec.continuous = false;
  rec.interimResults = true;
  rec.lang = "en-US";

  rec.onstart = () => {
    state.listening = true;
    $("#mic-btn").classList.add("active");
    setStatus("Listening…");
  };
  rec.onend = () => {
    state.listening = false;
    $("#mic-btn").classList.remove("active");
    setStatus("Ready.");
  };
  rec.onerror = (e) => {
    setStatus("Mic error: " + e.error);
  };
  rec.onresult = (e) => {
    let finalTranscript = "";
    for(let i=0; i<e.results.length; i++){
      const res = e.results[i];
      if(res.isFinal) finalTranscript += res[0].transcript;
    }
    if(finalTranscript){
      const prev = $("#answer-input").value;
      $("#answer-input").value = (prev ? prev + " " : "") + finalTranscript.trim();
    }
  };
  state.recognition = rec;
}

function toggleMic(){
  if(!state.recognition){ initSTT(); return; }
  if(state.listening){
    state.recognition.stop();
  }else{
    try{ state.recognition.start(); }catch{ /* no-op if already started */ }
  }
}

async function submitAnswers(){
  const btn=document.querySelector("#submit-btn"); if(btn){btn.disabled=true; btn.textContent="Submitting…";}
  const payload = {
    userId: state.anon ? null : state.userId,
    anon: state.anon,
    personalize: state.personalize,
    createdAt: new Date().toISOString(),
    answers: state.answers
  };
  try {
    const url = apiUrl("/api/submit");
    console.log("Submitting to:", url);
    const res = await fetch(url, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(payload)
    });
    const raw = await res.text();
    let json = null;
    try { json = JSON.parse(raw); } catch {}
    console.log("submit status:", res.status);
    console.log("submit body:", raw);
    if (!res.ok) {
      const msg = json && json.error ? json.error : raw || "Unknown error";
      setStatus(`Submit failed (${res.status}): ${msg}`);
      return;
    }
    setStatus("Submitted to server. Starting a fresh interview…");
try { localStorage.removeItem("interview_state"); } catch {}
try { localStorage.removeItem("interviewState"); } catch {}
try { localStorage.removeItem("answers"); } catch {}
try { for (let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if(k && /^interview[_-]/.test(k)) { localStorage.removeItem(k); i--; } } } catch {}
if (typeof state !== "undefined") { state.answers = {}; state.idx = 0; }
const ai=document.querySelector("#answer-input"); if(ai){ ai.value=""; }
if (typeof renderQuestion==="function") renderQuestion();
if (typeof renderReview==="function") renderReview();
setTimeout(()=>{ try{location.reload();}catch(e){} }, 400);

  } catch (err) {
    console.error("submit error:", err);
    setStatus(API_BASE ? "Network error calling API." : "Static mode: set API_BASE for live submit.");
  }
  finally {
    const btn=document.querySelector("#submit-btn"); if(btn){btn.disabled=false; btn.textContent="Submit";}
  }
}

function downloadJson(){
  const blob = new Blob([ JSON.stringify({
    userId: state.anon ? null : state.userId,
    anon: state.anon,
    personalize: state.personalize,
    createdAt: new Date().toISOString(),
    answers: state.answers
  }, null, 2) ], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "interview_answers.json";
  a.click();
  URL.revokeObjectURL(url);
}

// Bindings

function resetSession(){
  try { localStorage.removeItem("interview_state"); } catch {}
  try { localStorage.removeItem("interviewState"); } catch {}
  try { localStorage.removeItem("answers"); } catch {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (/^answer:|^chip:|^session:|^draft:/).test(k)) {
        localStorage.removeItem(k);
        i--;
      }
    }
  } catch {}
  if (typeof state !== "undefined") {
    state.answers = {};
    state.idx = 0;
  }
  const ai = document.querySelector("#answer-input");
  if (ai) ai.value = "";
  if (typeof renderQuestion === "function") renderQuestion();
  if (typeof renderReview === "function") renderReview();
  setStatus("Session cleared.");
}

document.addEventListener("DOMContentLoaded", () => {

// ----- Mutual exclusivity: Anonymize vs Personalize -----
function applyPrivacyInterlock(){
  const anonEl = document.getElementById("anon-toggle");
  const persEl = document.getElementById("personalize-toggle");
  if (!anonEl || !persEl) return;
  if (anonEl.checked) {
    persEl.checked = false;
    if (typeof state !== 'undefined') state.personalize = false;
    persEl.disabled = true;
    document.body.classList.add("personalize-disabled");
  } else {
    persEl.disabled = false;
    document.body.classList.remove("personalize-disabled");
  }
  if (typeof persistLocal === 'function') persistLocal();
}

  restoreLocal();
  applyPrivacyInterlock();
  loadQuestions();
  initSTT();

  $("#mic-btn").addEventListener("click", toggleMic);
  $("#next-btn").addEventListener("click", () => captureAnswer(true,false));
  $("#skip-btn").addEventListener("click", () => captureAnswer(true,true));
  $("#prev-btn").addEventListener("click", () => { if(state.idx>0){ state.idx--; renderQuestion(); } });
  $("#submit-btn").addEventListener("click", submitAnswers);
  $("#download-btn").addEventListener("click", downloadJson);
  $("#reset-btn").addEventListener("click", resetSession);
  $("#answer-input").addEventListener("change", ()=> captureAnswer(false,false));
  $("#personalize-toggle").addEventListener("change", (e)=>{ state.personalize = e.target.checked; applyPrivacyInterlock(); });
  $("#anon-toggle").addEventListener("change", (e)=>{ state.anon = e.target.checked; applyPrivacyInterlock(); });
});
