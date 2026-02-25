# PDF Intelligence

AI-powered PDF document analysis app. Upload a PDF, ask questions, and get structured answers with page citations.

## Setup

### Backend

```bash
cd backend
cp .env.example .env
# Add your Anthropic API key to .env
pip install -r requirements.txt
uvicorn main:app --reload
```

Runs on http://localhost:8000

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Runs on http://localhost:3000

## Features

- **PDF Upload** — drag-and-drop or file picker
- **Q&A** — ask questions, get answers with page citations
- **Summarize** — structured executive summary
- **Voice Mode** — toggle for natural spoken-tone output
