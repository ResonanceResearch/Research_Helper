export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    };
    if (request.method === "OPTIONS") return new Response("", { headers: cors });

    if (pathname === "/api/health") {
      return json({ ok: true, has_kv: !!env.ANSWERS, has_openai: !!env.OPENAI_API_KEY, model: env.OPENAI_MODEL || "gpt-5-mini" }, cors);
    }

    // NEW: diagnostics route to help debug OpenAI failures quickly
    if (pathname === "/api/diag") {
      const checks = {
        ok: true,
        has_kv: !!env.ANSWERS,
        has_openai: !!env.OPENAI_API_KEY,
        model: env.OPENAI_MODEL || "gpt-5-mini"
      };
      // Try a tiny OpenAI request if secret exists
      if (checks.has_openai) {
        try {
          const out = await callOpenAI(
            [{ role: "user", content: "Reply with the single word: pong" }],
            env,
            false
          );
          checks.openai_roundtrip = (out || "").trim().toLowerCase().includes("pong");
          checks.sample = (out || "").slice(0, 120);
        } catch (e) {
          checks.openai_roundtrip = false;
          checks.openai_error = String(e);
        }
      }
      return json(checks, cors);
    }

    if (pathname === "/api/suggest" && request.method === "POST") {
      const body = await safeJson(request);
      const { questionText, context = [] } = body || {};
      const profile = extractIdentity(context);
      const openalex = profile ? await fetchOpenAlex(profile, env) : null;
      const chips = await suggestChips(questionText, context, openalex, env);
      return json({ chips }, cors);
    }

    if (pathname === "/api/next-question" && request.method === "POST") {
      const body = await safeJson(request);
      const { context = [] } = body || {};
      const nextQ = await nextQuestion(context, env);
      return json(nextQ, cors);
    }

    if (pathname === "/api/export" && request.method === "POST") {
      const body = await safeJson(request);
      const { context = [], resources = [] } = body || {};
      try {
        const txt = await exportPlan(context, resources, env);
        return new Response(txt, { headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" } });
      } catch (e) {
        // Include error text so front-end shows why it failed
        return new Response("OpenAI call failed: " + (e?.message || String(e)), { status: 502, headers: cors });
      }
    }

    if (pathname === "/api/submit" && request.method === "POST") {
      try {
        const id = crypto.randomUUID();
        await env.ANSWERS.put(`session:${id}`, await request.text(), { expirationTtl: 60*60*24*30 });
        return json({ ok:true, id }, cors);
      } catch (e) {
        return json({ ok:false, error: String(e) }, cors, 500);
      }
    }

    return new Response("Not Found", { status: 404, headers: cors });
  }
};

function json(data, extraHeaders={}, status=200){
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...extraHeaders } });
}
async function safeJson(req){ try { return await req.json(); } catch { return null; } }

function extractIdentity(context){
  const idQ = context.find(x => (x.id||"").includes("identity"));
  if (!idQ) return null;
  const raw = (idQ.answer || "").trim();
  if (!raw) return null;
  const parts = raw.split(/—|-{1,2}|–/).map(s => s.trim()).filter(Boolean);
  const name = parts[0] || raw;
  const affiliation = parts[1] || "";
  return { name, affiliation };
}

async function fetchOpenAlex(profile, env){
  try {
    const q = encodeURIComponent(profile.name + (profile.affiliation ? " " + profile.affiliation : ""));
    const res = await fetch(`https://api.openalex.org/autocomplete/authors?q=${q}&per_page=1`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.results || !data.results.length) return null;
    const authorId = data.results[0].id;
    const worksRes = await fetch(`https://api.openalex.org/works?filter=authorships.author.id:${encodeURIComponent(authorId)}&per_page=25&sort=cited_by_count:desc`);
    if (!worksRes.ok) return null;
    const works = await worksRes.json();
    const concepts = new Map();
    for (const w of (works.results||[])) {
      for (const c of (w.concepts||[])) {
        concepts.set(c.display_name, (concepts.get(c.display_name)||0) + (c.score||0));
      }
    }
    return Array.from(concepts.entries()).sort((a,b)=>b[1]-a[1]).slice(0,20).map(x=>x[0]);
  } catch { return null; }
}

async function suggestChips(questionText, context, openalex, env){

  // Seed library to draw from when relevant (future-proof json could replace this)
  const SEED = [
    "Pilot study","Internal seed grant","Genome core","Biobank access","Clinical collaborator",
    "Ethics prep","Data steward","Stats consult","Undergrad RA","Postdoc co-mentor",
    "Industry partner","Knowledge mobilization","Core facility booking","Fee-for-service","Consortium join"
  ];
  function relevantToQuestion(text, chip){
    const qTokens = (text||"").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const cTokens = (chip||"").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    return cTokens.some(t => qTokens.includes(t));
  }

  
    const sys = `You suggest concise, question-specific "chips" (<=6 tokens each).
- Only include chips that directly help answer THIS question (not generic).
- Prefer concrete items: methods, cohorts, collaborators, units, funding programs, facilities, next actions.
- Personalize using prior answers and any OpenAlex topics IF they relate to the question.
Return JSON: {"chips":["...","..."]}`;


  const prompt = [
    { role:"system", content: sys },
    { role:"user", content: JSON.stringify({ questionText, context, openalex }) }
  ];
  try {
    const out = await callOpenAI(prompt, env, /*jsonWanted*/ true);
    
if (out && Array.isArray(out.chips)) {
  let list = out.chips.filter(c => relevantToQuestion(questionText, c));
  // add OpenAlex topics that overlap with question
  if (openalex && Array.isArray(openalex)) {
    const oa = openalex.filter(c => relevantToQuestion(questionText, c));
    list = list.concat(oa);
  }
  // add seed chips that are relevant
  list = list.concat(SEED.filter(c => relevantToQuestion(questionText, c)));
  // de-duplicate, trim to 12
  const uniq = Array.from(new Set(list.map(c => c.trim()).filter(Boolean)));
  return uniq.slice(0, 12);
}
if (out && Array.isArray(out)) {
  const uniq = Array.from(new Set(out.map(c => c.trim()).filter(c => relevantToQuestion(questionText, c))));
  if (uniq.length) return uniq.slice(0, 12);
}
const fallbacks = ["Pilot study","Local collaborator","Internal grant","UCVM facility","Co-authorship map","Method clinic"];
if (openalex && openalex.length) fallbacks.unshift(openalex[0]);
return Array.from(new Set(fallbacks.filter(c => relevantToQuestion(questionText, c)))).slice(0, 12);

}

async function nextQuestion(context, env){
  
    const sys = `Generate ONE concise follow-up question (<= 14 words) for this mentoring interview.
Goal: fill gaps (expertise, resources, collaborators, cohorts, funding, constraints, outcomes) and converge to an action plan.
Avoid multi-part questions. Be crisp and specific.
Return JSON: {"id":"q_<slug>","text":"...?"}`;

  const prompt = [
    { role:"system", content: sys },
    { role:"user", content: JSON.stringify({ context }) }
  ];
  try {
    const out = await callOpenAI(prompt, env, /*jsonWanted*/ true);
    if (out && out.id && out.text) return out;
  } catch {}
  return { id: "q_followup", text: "What specific dataset, clinic, or cohort could be mobilized in the next 3 months?" };
}

async function exportPlan(context, resources, env){
  const sys = `You synthesize a practical, stepwise 90-day action plan for a new or clinical/teaching-heavy faculty member to launch/advance a research program.
- Use the person's strengths/assets and address constraints via collaborations.
- Include: focus areas, 2–3 project directions, 3–5 collaborators (local or external), specific facilities/resources, funding leads (with program names if possible), risk/mitigation, and immediate next steps by week.
- Use the default resources and the resources added by the user. 
- Keep it concise and skimmable with short bullets.`;
  const prompt = [
    { role:"system", content: sys },
    { role:"user", content: JSON.stringify({ context, resources }) }
  ];
  const out = await callOpenAI(prompt, env, /*jsonWanted*/ false);
  return typeof out === "string" ? out : JSON.stringify(out, null, 2);
}

async function callOpenAI(messages, env, jsonWanted){
  const model = env.OPENAI_MODEL || "gpt-5-mini";
  const url = "https://api.openai.com/v1/chat/completions";
  const headers = {
    "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
    "Content-Type": "application/json"
  };
  const body = { model, messages };
  if (jsonWanted) body.response_format = { type: "json_object" };
  const res = await fetch(url, { method:"POST", headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const errText = await res.text().catch(()=> "");
    throw new Error(`OpenAI ${res.status} ${res.statusText} :: ${errText.slice(0, 400)}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || "";
  if (jsonWanted) { try { return JSON.parse(content); } catch { return null; } }
  return content;
}
