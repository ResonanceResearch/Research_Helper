# 🧭 Faculty Research Mentor

A web app that **mentors new faculty or teaching/clinical appointees** to shape a viable research program.
It keeps the **conversation-first** flow and technical structure of the Grant Interviewer MVP, but retargeted to
**build a profile, adapt questions in real-time with AI, and synthesize an action plan** (collaborators, resources, funding).

- Conversational interview with **AI-suggested chips**
- **Progress bar** over required profile elements
- **Adaptive follow-ups** from the Worker (`/api/next-question`)
- **Resource search** seeded with UCVM links and the UCVM dashboard
- One‑click **Export Action Plan**
- **Reset** to clear session

## 📦 Structure
- `index.html` – UI shell
- `app.js` – state, navigation, chips, progress, resources, export
- `styles.css` – minimal dark theme
- `questions.json` – seed questions + weights
- `resources.json` – seed resources (add more over time)
- `worker.js` – Cloudflare Worker (`/api/suggest`, `/api/next-question`, `/api/export`, `/api/submit`, `/api/health`)
- `wrangler.toml` – Worker config

> This app preserves the Pages + Cloudflare Worker split.  
> Adapted from your original MVP (Grant Interviewer).

## 🚀 Quick Start (local static + Worker)
1) Serve the static files (e.g., VS Code Live Server) or GitHub Pages.  
2) Deploy the Worker:
```bash
npm i -g wrangler
wrangler login
wrangler secret put OPENAI_API_KEY
wrangler deploy
```
3) Set the Worker URL in `index.html`:
```html
<script>window.API_BASE="https://faculty-research-mentor-api.YOURNAME.workers.dev";</script>
```

## 🔌 OpenAlex enrichment
When the **identity** question is answered (e.g., “Jane Doe — University of Calgary”), the Worker queries OpenAlex
to harvest **top concepts** to bias chip suggestions and collaborator ideas.

## 🧠 Action Plan
Click **Export Action Plan** to get a concise 90‑day plan compiled by the Worker from your answers and resources.

## 🛡️ Privacy
- Answers stay in your browser unless you call `/api/submit` (optional).  
- If enabled, sessions are stored in KV as anonymized JSON with a 30‑day TTL.

## 🪪 License
MIT
