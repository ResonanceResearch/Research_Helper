// worker.js

const ALLOWED_ORIGIN = "https://resonanceresearch.github.io"; // or your repo pages URL

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": (env && env.DEBUG_CORS === "1") ? "*" : ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Vary": "Origin"
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Lightweight export endpoint:
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

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(env) });
    }

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

    if (request.method === "POST" && url.pathname === "/api/submit") {
      if (!env.ANSWERS) {
        return new Response(JSON.stringify({ ok:false, error:"KV_not_bound" }), {
          status: 501,
          headers: { "content-type": "application/json", ...corsHeaders(env) },
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

    if (request.method === "POST" && url.pathname === "/api/suggest") {
      const body = await request.json().catch(()=>({}));
      const questionText = body.questionText || "";
      const context = Array.isArray(body.context) ? body.context : [];
      const contextText = context.map(c => `Q: ${c.question}\nA: ${c.answer}`).join("\n---\n");

      // If no API key, be explicit (still safe to show in browser console)
      if (!env.OPENAI_API_KEY) {
        return new Response(JSON.stringify({
          chips: [],
          _diag: { reason: "missing_openai_api_key", model: env.OPENAI_MODEL || null }
        }), {
          headers: { "content-type": "application/json", ...corsHeaders(env) },
        });
      }

      const sys = `You generate short, concrete suggestion "chips" to help users answer a form.
Rules:
- 3 to 7 chips max.
- Each chip must be succinct (2–6 words), not full sentences.
- Chips must be specific to the CURRENT question and informed by the context when helpful.
- If the question asks for a name or title, suggest plausible placeholders (e.g., "CIHR", "NSERC Discovery") not generic text like "Enter a name".
- If nothing useful can be inferred, return an empty list.`;

      const user = `Current question: "${questionText}"
Context (previous Q&A, if any):
${contextText || "(none)"} 

Return JSON: {"chips": ["..."]}`;

      let out = { chips: [] };

      // Call OpenAI Chat Completions API
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

      // If OpenAI errored, surface a minimal diagnostic
      if (!resp.ok) {
        let err;
        try { err = await resp.json(); } catch { err = { error: { message: await resp.text() } }; }
        return new Response(JSON.stringify({
          chips: [],
          _diag: {
            reason: "openai_error",
            status: resp.status,
            message: err?.error?.message || "unknown"
          }
        }), { headers: { "content-type": "application/json", ...corsHeaders(env) } });
      }

      try {
        const data = await resp.json();
        const text = data.choices?.[0]?.message?.content || "{}";
        const json = JSON.parse(text);
        if (Array.isArray(json.chips)) out.chips = json.chips.slice(0,7);
      } catch (e) {
        // fall through with empty chips
      }

      return new Response(JSON.stringify(out), {
        headers: { "content-type": "application/json", ...corsHeaders(env) },
      });
    }

    return new Response(JSON.stringify({ok:true, service:"grant-interviewer-api"}), {
      status: 200,
      headers: { "content-type": "application/json", ...corsHeaders(env) }
    });
  }
};
