// worker.js — with OpenAlex keyword enrichment for researcher identity

const ALLOWED_ORIGIN = "https://resonanceresearch.github.io"; // limit CORS in prod

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": (env && env.DEBUG_CORS === "1") ? "*" : ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Vary": "Origin"
  };
}

// --- Utilities ---------------------------------------------------------------

function parseIdentityFromContext(ctx) {
  // Looks for an item whose id is "researcher_identity" (added in questions.json).
  // Expected format: "Full Name — Affiliation" (em dash) OR "Full Name - Affiliation".
  if (!Array.isArray(ctx)) return null;
  const item = ctx.find(x => (x?.id === "researcher_identity") && (x?.answer?.trim()));
  if (!item) return null;
  const raw = item.answer.trim();
  // Split on em dash or hyphen with whitespace margins
  const parts = raw.split(/\s+[—-]\s+/);
  const name = parts[0]?.trim();
  const affiliation = (parts[1] || "").trim();
  if (!name) return null;
  return { name, affiliation };
}

async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.json();
}

function tally(arr) {
  const m = new Map();
  for (const a of arr) {
    const k = a?.toLowerCase?.() || a;
    if (!k) continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a,b)=>b[1]-a[1]).map(([k])=>k);
}

async function openalexKeywordsFor(env, identity) {
  // Very small, resilient pipeline:
  // 1) Try KV cache: key = openalex:keywords:<name>|<affil>
  // 2) If miss, query OpenAlex authors by name (+ affiliation filter if provided)
  // 3) Fetch top works for that author and collect x_concepts display_names
  // 4) Cache the deduped top terms in KV and return
  const name = identity?.name || "";
  const affiliation = identity?.affiliation || "";
  if (!name) return [];

  const cacheKey = `openalex:keywords:${name}|${affiliation}`;
  if (env.ANSWERS) {
    const cached = await env.ANSWERS.get(cacheKey);
    if (cached) {
      try { return JSON.parse(cached); } catch {}
    }
  }

  let authorId = null;
  try {
    const params = new URLSearchParams();
    params.set("search", name);
    params.set("per_page", "5");
    // bias by affiliation if provided
    if (affiliation) {
      params.set("filter", `last_known_institution.display_name.search:${affiliation}`);
    }
    const ares = await fetchJSON(`https://api.openalex.org/authors?${params.toString()}`);
    const author = (ares?.results || [])[0];
    authorId = author?.id; // e.g., "https://openalex.org/A123..."
  } catch (e) {
    // swallow
  }
  if (!authorId) return [];

  // Pull top works (limit 25) and collect x_concepts.display_name
  const idShort = authorId.split("/").pop();
  let concepts = [];
  try {
    const wparams = new URLSearchParams();
    wparams.set("filter", `authorships.author.id:${authorId}`);
    wparams.set("per_page", "25");
    wparams.set("sort", "cited_by_count:desc");
    const wres = await fetchJSON(`https://api.openalex.org/works?${wparams.toString()}`);
    for (const w of (wres?.results || [])) {
      const xs = (w?.x_concepts || []).map(c => c?.display_name).filter(Boolean);
      concepts.push(...xs);
    }
  } catch (e) {
    // swallow
  }

  const ranked = tally(concepts).slice(0, 24); // top few dozen
  if (env.ANSWERS) {
    await env.ANSWERS.put(cacheKey, JSON.stringify(ranked), { expirationTtl: 60 * 60 * 24 * 7 }); // 7d
  }
  return ranked;
}

// --- Worker ------------------------------------------------------------------

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(env) });
    }

    // Health
    if (request.method === "GET" && url.pathname === "/api/health") {
      const ok = {
        ok: true,
        has_kv: !!env.ANSWERS,
        has_openai: !!env.OPENAI_API_KEY,
        model: env.OPENAI_MODEL || null
      };
      return new Response(JSON.stringify(ok), {
        headers: { "content-type": "application/json", ...corsHeaders(env) }
      });
    }

    // Export
    if (request.method === "GET" && url.pathname === "/api/export") {
      if (!env.ANSWERS) {
        return new Response(JSON.stringify({ ok:false, error:"KV_not_bound" }), {
          status: 501, headers: { "content-type": "application/json", ...corsHeaders(env) },
        });
      }
      const prefix = url.searchParams.get("prefix") || "";
      const list = await env.ANSWERS.list({ prefix, limit: 1000 });
      const out = [];
      for (const k of list.keys) {
        const val = await env.ANSWERS.get(k.name);
        out.push({ key: k.name, value: (()=>{ try{return JSON.parse(val)}catch{return val} })() });
      }
      return new Response(JSON.stringify({ ok:true, count: out.length, items: out }, null, 2), {
        headers: { "content-type": "application/json", ...corsHeaders(env) },
      });
    }

    // Submit
    if (request.method === "POST" && url.pathname === "/api/submit") {
      if (!env.ANSWERS) {
        return new Response(JSON.stringify({ ok:false, error:"KV_not_bound" }), {
          status: 501, headers: { "content-type": "application/json", ...corsHeaders(env) },
        });
      }
      const body = await request.json().catch(()=>({}));
      const ts = new Date().toISOString().replace(/[:.]/g,"-");
      const uid = body.userId || "anon";
      const key = `${ts}_${uid}`;
      await env.ANSWERS.put(key, JSON.stringify(body));
      return new Response(JSON.stringify({ ok:true, key }), {
        headers: { "content-type": "application/json", ...corsHeaders(env) },
      });
    }

    // Suggest
    if (request.method === "POST" && url.pathname === "/api/suggest") {
      const body = await request.json().catch(()=>({}));
      const questionText = body.questionText || "";
      const context = Array.isArray(body.context) ? body.context : [];
      const personalize = !!body.personalize;

      // Researcher identity → OpenAlex keywords (best-effort)
      let identity = parseIdentityFromContext(context);
      let oaKeywords = [];
      try {
        if (identity?.name) {
          oaKeywords = await openalexKeywordsFor(env, identity);
        }
      } catch(e) { /* ignore */ }

      // If no API key, return only OpenAlex-based chips (fallback)
      if (!env.OPENAI_API_KEY) {
        const chips = (oaKeywords || []).slice(0, 7).map(k => k.replace(/\b\w/g, c=>c.toUpperCase()));
        return new Response(JSON.stringify({
          chips,
          _diag: { reason: "missing_openai_api_key", model: env.OPENAI_MODEL || null, oa: chips.length }
        }), { headers: { "content-type": "application/json", ...corsHeaders(env) } });
      }

      // Compose prompt
      const contextText = context.map(c => `Q: ${c.question}\nA: ${c.answer}`).join("\n---\n");
      const sys = `You generate short, concrete suggestion "chips" to help users answer a form.
Rules:
- 3 to 7 chips max.
- Each chip must be succinct (2–6 words).
- Use researcher-specific keywords if provided to bias suggestions toward the user's domain.
- If the current question is about "keywords", suggest topical terms based on the researcher's profile terms.
- If nothing useful can be inferred, return an empty list.`;

      const user = `Current question: "${questionText}"

Context (previous Q&A):
${contextText || "(none)"}

Researcher identity:
${identity ? JSON.stringify(identity) : "(unknown)"}

Researcher keywords (OpenAlex-derived):
${(oaKeywords && oaKeywords.length) ? oaKeywords.join(", ") : "(none)"}

Return JSON strictly of the form: {"chips": ["..."]}`;

      let out = { chips: [] };

      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: env.OPENAI_MODEL || "gpt-4o-mini",
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: sys },
            { role: "user", content: user }
          ]
        })
      });

      if (!resp.ok) {
        let err;
        try { err = await resp.json(); } catch { err = { error: { message: await resp.text() } }; }
        // Fallback: if OpenAI fails but we have OA keywords, return them
        const fallback = (oaKeywords || []).slice(0, 7).map(k => k.replace(/\b\w/g, c=>c.toUpperCase()));
        return new Response(JSON.stringify({
          chips: fallback,
          _diag: { reason: "openai_error", status: resp.status, message: err?.error?.message || "unknown", oa: fallback.length }
        }), { headers: { "content-type": "application/json", ...corsHeaders(env) } });
      }

      try {
        const data = await resp.json();
        const text = data.choices?.[0]?.message?.content || "{}";
        const json = JSON.parse(text);
        if (Array.isArray(json.chips)) out.chips = json.chips.slice(0,7);
      } catch (e) {
        // If parsing fails, try OA fallback
        if (!out.chips.length && oaKeywords?.length) {
          out.chips = oaKeywords.slice(0, 7).map(k => k.replace(/\b\w/g, c=>c.toUpperCase()));
        }
      }

      return new Response(JSON.stringify(out), {
        headers: { "content-type": "application/json", ...corsHeaders(env) },
      });
    }

    // Default
    return new Response(JSON.stringify({ ok:true, service:"grant-interviewer-api" }), {
      status: 200,
      headers: { "content-type": "application/json", ...corsHeaders(env) }
    });
  }
};
