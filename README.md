# HealthLens AI 🔬

**Understand your lab report before you meet your doctor.**

HealthLens AI helps people understand blood test reports in simple, calm language. Upload a PDF or photo of your lab report, and get:

- ✅ Automatic extraction of test values
- 📊 Age and sex-adjusted reference ranges
- 💡 AI-powered explanations in plain English or Hindi
- 🩺 Ready-made questions to ask your doctor
- 📈 Comparison with previous reports
- 🎙️ Voice assistant for asking questions about your report
- ♿ Accessibility: high contrast, dyslexia-friendly font, read-aloud, senior mode

> ⚠️ HealthLens AI does NOT give medical advice or diagnosis. It helps you prepare for a conversation with a qualified healthcare professional.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML + CSS + Vanilla JavaScript |
| Backend | Node.js + Express 5 |
| Database | SQLite (via better-sqlite3) |
| AI | Google Gemini (vision + text), Groq |
| Auth | JWT + bcrypt |

---

## Project Structure

```
HealthLens_AI/
├── index.html           # Landing page
├── login.html           # Login / register
├── dashboard.html       # Upload report
├── review.html          # Review extracted values
├── report.html          # Analysis results
├── history.html         # Saved reports
├── css/style.css        # Styles
├── js/app.js            # Frontend logic
└── backend/
    ├── server.js        # Express API server
    ├── package.json     # Dependencies
    └── .env.example     # Environment variable template
```

---

## Local Development Setup

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/HealthLens_AI.git
cd HealthLens_AI
```

### 2. Install backend dependencies

```bash
cd backend
npm install
```

### 3. Set up environment variables

```bash
cp .env.example .env
```

Then edit `backend/.env` and add your real API keys:
- **GROQ_API_KEY**: Get from [console.groq.com](https://console.groq.com)
- **GEMINI_API_KEY**: Get from [aistudio.google.com](https://aistudio.google.com/apikey)
- **JWT_SECRET**: Any long random string

### 4. Start the backend

```bash
npm start
```

The backend runs at `http://localhost:3000`.

### 5. Open the frontend

Open `index.html` directly in your browser, or use a local server like VS Code's Live Server extension (port 5500).

---

## Deployment

### Backend → Render

1. Create a new **Web Service** on [render.com](https://render.com)
2. Connect your GitHub repository
3. Settings:
   - **Root Directory**: `backend`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. Add environment variables in Render dashboard (same as `.env.example`)

### Frontend → Vercel

1. Create a new project on [vercel.com](https://vercel.com)
2. Connect your GitHub repository
3. Settings:
   - **Framework Preset**: Other
   - **Root Directory**: `.` (project root)
   - **Output Directory**: `.` (project root)
4. No build command needed (static HTML)

---

## API Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | /auth/register | No | Create account |
| POST | /auth/login | No | Log in |
| GET | /auth/me | Yes | Current user info |
| GET | /profiles | Yes | List profiles |
| POST | /profiles | Yes | Create profile |
| DELETE | /profiles/:id | Yes | Delete profile |
| GET | /reports | Yes | List reports |
| POST | /reports | Yes | Save report |
| DELETE | /reports/:id | Yes | Delete report |
| POST | /extract | Yes | Extract values from PDF/image |
| POST | /explain | No | Get AI explanation of flagged values |
| POST | /voice-ask | Optional | Ask voice assistant a question |
| GET | /history/logins | Yes | Login history |
| GET | /history/activity | Yes | Activity log |
| GET | /history/voice | Yes | Voice query history |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GROQ_API_KEY` | Yes | Groq API key for AI explanations |
| `GROQ_MODEL` | No | Groq model name (default: openai/gpt-oss-120b) |
| `GEMINI_API_KEY` | Yes | Google Gemini API key for vision + text |
| `GEMINI_VISION_MODELS` | No | Comma-separated Gemini vision models |
| `JWT_SECRET` | Yes | Secret for signing auth tokens |
| `SAVE_ANSWERS` | No | Cache AI responses to disk (default: false) |
| `PORT` | No | Server port (default: 3000, auto-set by Render) |
| `FRONTEND_URL` | No | Production frontend URL for CORS |

---

## License

ISC
