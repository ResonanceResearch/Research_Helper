# Interview App (MVP)

A minimal web app that:
- Presents a series of questions.
- Accepts answers via typing **or** voice dictation (Web Speech API).
- Suggests **chips** (question-specific, optionally user-personalized) using the OpenAI API.
- Saves answers **locally** in the browser and can **POST** to an API for storage.
- Supports **anonymized** mode and **personalization** toggle.
- Runs locally with an Express server (for saving answers and calling OpenAI), and can deploy the **front-end** to GitHub Pages with the API on a **Cloudflare Worker**.

> Note: GitHub Pages is static hosting only. To save answers or call OpenAI securely, you need a backend (e.g., Cloudflare Worker).

## Local Development

1. Install Node.js (>=18).
2. In this folder:
   ```bash
   npm i
   cp .env.example .env   # put your real OPENAI_API_KEY
   npm run dev            # serves http://localhost:8787
   ```
3. Open http://localhost:8787
   - Answers are saved to `./data` as JSON when you click **Submit**.
   - Chips call OpenAI via `/api/suggest`.

## Deploying the Front-end to GitHub Pages

1. Place `index.html`, `styles.css`, `app.js`, and `questions.json` into your repo (e.g., `gh-pages` branch or `/docs` folder).
2. Enable GitHub Pages for that branch/folder.
3. **API**: Point the front-end to your Worker endpoint by changing the `fetch("/api/...")` URLs in `app.js` to your worker URL (e.g., `https://your-worker.workers.dev/api/...`). You can do this via a small config block or environment variable replacement.

Example quick edit in `app.js`:
```js
// At top of app.js
const API_BASE = window.API_BASE || ""; // "" for local; set to "https://your-worker.workers.dev"
// Then use: fetch(API_BASE + "/api/suggest"), fetch(API_BASE + "/api/submit")
```

## Cloudflare Worker API (Production)

- Use `worker.js` and `wrangler.toml.sample` as a template.
- Bind a KV namespace named `ANSWERS` (for storage).
- Add your OpenAI key as a secret:
  ```bash
  wrangler secret put OPENAI_API_KEY
  ```
- Deploy:
  ```bash
  wrangler deploy
  ```

### wrangler.toml (example)

```toml
name = "grant-interviewer-api"
main = "worker.js"
compatibility_date = "2025-10-26"

[vars]
OPENAI_MODEL = "gpt-4o-mini"

kv_namespaces = [
  { binding = "ANSWERS", id = "YOUR_KV_NAMESPACE_ID" }
]
```

## Data Model

Each submission (local or API) looks like:
```json
{
  "userId": "uuid-or-null-if-anon",
  "anon": true,
  "personalize": true,
  "createdAt": "2025-01-01T12:34:56.000Z",
  "answers": {
    "project_title": { "text": "..." },
    "funding_agency": { "text": "..." },
    "...": { "text": "..." }
  }
}
```

## Privacy / Anonymization

- **Anonymize** toggle removes `userId` from server submissions.
- **Personalize** toggle uses only local (browser) storage to seed chips (no server call needed for that).
- To fully disable remote calls, host as static (GH Pages) and remove/replace `/api/*` calls. Users can still **download** their answers as JSON.

## Extending Chips

- Add a `/api/chips/learn` endpoint to aggregate popular answers per-question and feed back into suggestions.
- Consider per-user chips by userId (when not anonymized), controlled in the Worker/Express server.

## Notes

- The built-in voice dictation uses the **Web Speech API** (availability varies by browser). Gracefully degrades if not supported.
- On iOS/Safari, a secure context and user gesture may be required for mic access.
- You can swap the OpenAI call to the new **Responses API** with minor changes if desired.
