import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

const DATA_DIR = path.join(__dirname, "data");
if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/** POST /api/submit
 * Save answers to ./data as JSON file. */
app.post("/api/submit", async (req, res) => {
  try{
    const payload = req.body || {};
    const ts = new Date().toISOString().replace(/[:.]/g,"-");
    const uid = payload.userId || "anon";
    const fname = path.join(DATA_DIR, `${ts}_${uid}.json`);
    fs.writeFileSync(fname, JSON.stringify(payload, null, 2), "utf-8");
    res.json({ ok:true, file: path.basename(fname) });
  }catch(e){
    console.error(e);
    res.status(500).json({ ok:false, error: "write_failed" });
  }
});

/** POST /api/suggest
 * Returns chip suggestions for the given question using OpenAI,
 * plus light personalization (based on prior answers in the payload's context). */
app.post("/api/suggest", async (req, res) => {
  try{
    const { questionId, questionText, context=[], userId=null, personalize=true } = req.body || {};

    // Construct a compact prompt; prioritize question-specific suggestions.
    const contextText = context.map(c => `Q: ${c.question}\nA: ${c.answer}`).join("\n---\n");
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

    const resp = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user }
      ]
    });

    const text = resp.choices?.[0]?.message?.content || "{}";
    let json;
    try{ json = JSON.parse(text); } catch{ json = { chips: [] }; }
    if(!Array.isArray(json.chips)) json.chips = [];

    res.json({ chips: json.chips.slice(0,7) });
  }catch(e){
    console.error(e);
    res.json({ chips: [] });
  }
});

// Fallback to index.html for static hosting
app.get("*", (req,res)=>{
  res.sendFile(path.join(__dirname, "index.html"));
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, ()=>{
  console.log(`Dev server running on http://localhost:${PORT}`);
});
