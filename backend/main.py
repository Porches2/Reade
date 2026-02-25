from fastapi import FastAPI, UploadFile, File, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
import uuid
import json
import os
import traceback
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from pdf_parser import extract_pages, get_metadata, find_relevant_chunks, extract_outline, detect_chapters_from_text
from ai_engine import ask_question, summarize_document, recommend_books, clean_text_for_tts, analyze_document
from ebook_catalog import get_all_books, get_books_by_category, search_books_local, search_open_library, search_gutenberg, CATEGORIES
from firebase_setup import init_firebase
from auth_middleware import get_current_user

import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("api")

app = FastAPI(title="PDF Intelligence API")


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled error: {exc}\n{traceback.format_exc()}")
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc)},
    )

# Configurable CORS origins
allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in allowed_origins],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Local storage directories
DATA_DIR = Path(os.getenv("DATA_DIR", os.path.join(os.path.dirname(__file__), "data")))
PDF_DIR = DATA_DIR / "pdfs"
THUMB_DIR = DATA_DIR / "thumbnails"
AUDIO_DIR = DATA_DIR / "audio"
META_DIR = DATA_DIR / "meta"

for d in (PDF_DIR, THUMB_DIR, AUDIO_DIR, META_DIR):
    d.mkdir(parents=True, exist_ok=True)


@app.on_event("startup")
def startup():
    try:
        init_firebase()
        print("[Startup] Firebase initialized (auth only)")
    except Exception as e:
        print(f"[Startup] Firebase init failed: {e}")


# --- Local metadata storage (replaces Firestore) ---

def _user_meta_path(user_id: str) -> Path:
    p = META_DIR / f"{user_id}.json"
    return p


def _load_user_meta(user_id: str) -> dict:
    p = _user_meta_path(user_id)
    if p.exists():
        return json.loads(p.read_text())
    return {}


def _save_user_meta(user_id: str, data: dict):
    p = _user_meta_path(user_id)
    p.write_text(json.dumps(data, indent=2))


def get_pdf_meta(user_id: str, pdf_id: str) -> dict:
    meta = _load_user_meta(user_id)
    if pdf_id not in meta:
        raise HTTPException(status_code=404, detail="PDF not found. Upload a PDF first.")
    return meta[pdf_id]


def save_pdf_meta(user_id: str, pdf_id: str, info: dict):
    meta = _load_user_meta(user_id)
    meta[pdf_id] = info
    _save_user_meta(user_id, meta)


def delete_pdf_meta(user_id: str, pdf_id: str):
    meta = _load_user_meta(user_id)
    if pdf_id in meta:
        del meta[pdf_id]
        _save_user_meta(user_id, meta)


def list_pdf_meta(user_id: str) -> list[dict]:
    meta = _load_user_meta(user_id)
    items = []
    for pdf_id, info in meta.items():
        items.append({"pdf_id": pdf_id, **info})
    items.sort(key=lambda x: x.get("uploaded_at", ""))
    return items


# --- Request models ---

class ProgressRequest(BaseModel):
    current_page: int = 1
    reading_time_seconds: int = 0
    completed: bool = False


class AskRequest(BaseModel):
    pdf_id: str
    question: str
    voice_mode: bool = False
    page_start: int | None = None
    page_end: int | None = None


class SummarizeRequest(BaseModel):
    pdf_id: str
    voice_mode: bool = False
    page_start: int | None = None
    page_end: int | None = None


class TTSRequest(BaseModel):
    pdf_id: str
    start_page: int = 1
    num_pages: int = 5
    voice: str = "en-US-AriaNeural"
    rate: str = "+0%"


# --- Helpers ---

def get_pdf_path(user_id: str, pdf_id: str) -> Path:
    user_dir = PDF_DIR / user_id
    user_dir.mkdir(parents=True, exist_ok=True)
    return user_dir / f"{pdf_id}.pdf"


def get_thumb_path(user_id: str, pdf_id: str) -> Path:
    user_dir = THUMB_DIR / user_id
    user_dir.mkdir(parents=True, exist_ok=True)
    return user_dir / f"{pdf_id}.png"


def get_page_range(pages: list[dict], start: int | None, end: int | None) -> list[dict]:
    if start is None and end is None:
        return pages
    s = start or 1
    e = end or len(pages)
    return [p for p in pages if s <= p["page"] <= e]


# --- Endpoints ---

@app.get("/health")
def health():
    import firebase_admin as _fa
    fb_ok = _fa._apps.get("[DEFAULT]") is not None
    pk = os.getenv("FIREBASE_PRIVATE_KEY", "")
    return {
        "status": "ok",
        "firebase_initialized": fb_ok,
        "private_key_starts": pk[:30] if pk else "MISSING",
        "private_key_length": len(pk),
        "project_id": os.getenv("FIREBASE_PROJECT_ID", "MISSING"),
        "client_email": os.getenv("FIREBASE_CLIENT_EMAIL", "MISSING"),
    }


# --- Library management (auth required) ---

@app.post("/upload")
async def upload_pdf(file: UploadFile = File(...), user_id: str = Depends(get_current_user)):
    logger.info(f"[Upload] user={user_id}, file={file.filename}")
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted.")

    pdf_bytes = await file.read()
    if len(pdf_bytes) > 50 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large. Max 50MB.")

    try:
        pages = extract_pages(pdf_bytes)
        metadata = get_metadata(pdf_bytes)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Failed to parse PDF: {e}")

    pdf_id = str(uuid.uuid4())

    # Save PDF locally
    pdf_path = get_pdf_path(user_id, pdf_id)
    pdf_path.write_bytes(pdf_bytes)

    # Generate thumbnail
    has_thumbnail = False
    try:
        import pdfplumber
        from io import BytesIO
        with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
            img = pdf.pages[0].to_image(resolution=72)
            thumb_path = get_thumb_path(user_id, pdf_id)
            img.save(str(thumb_path), format="PNG")
            has_thumbnail = True
    except Exception:
        pass

    # Save metadata locally as JSON
    save_pdf_meta(user_id, pdf_id, {
        "filename": file.filename,
        "total_pages": metadata["total_pages"],
        "has_thumbnail": has_thumbnail,
        "uploaded_at": datetime.utcnow().isoformat(),
    })

    logger.info(f"[Upload] Success: pdf_id={pdf_id}")
    return {
        "pdf_id": pdf_id,
        "filename": file.filename,
        "total_pages": metadata["total_pages"],
        "thumbnail_url": f"/pdf/{pdf_id}/thumbnail" if has_thumbnail else None,
        "message": "PDF uploaded and added to library.",
    }


@app.get("/library")
def list_pdfs(user_id: str = Depends(get_current_user)):
    items = list_pdf_meta(user_id)
    result = []
    for item in items:
        entry = {
            "pdf_id": item["pdf_id"],
            "filename": item["filename"],
            "total_pages": item["total_pages"],
            "thumbnail_url": f"/pdf/{item['pdf_id']}/thumbnail" if item.get("has_thumbnail") else None,
            "uploaded_at": item.get("uploaded_at"),
        }
        if "progress" in item:
            entry["progress"] = item["progress"]
        if "analysis" in item:
            entry["analysis"] = item["analysis"]
        result.append(entry)
    return {"pdfs": result}


@app.delete("/library/{pdf_id}")
def delete_pdf(pdf_id: str, user_id: str = Depends(get_current_user)):
    info = get_pdf_meta(user_id, pdf_id)
    filename = info["filename"]

    # Delete local files
    pdf_path = get_pdf_path(user_id, pdf_id)
    if pdf_path.exists():
        pdf_path.unlink()
    thumb_path = get_thumb_path(user_id, pdf_id)
    if thumb_path.exists():
        thumb_path.unlink()

    # Delete metadata
    delete_pdf_meta(user_id, pdf_id)
    return {"message": f"Deleted '{filename}' from library."}


@app.get("/pdf/{pdf_id}/file")
def get_pdf_file(pdf_id: str, user_id: str = Depends(get_current_user)):
    get_pdf_meta(user_id, pdf_id)  # verify ownership
    pdf_path = get_pdf_path(user_id, pdf_id)
    if not pdf_path.exists():
        raise HTTPException(status_code=404, detail="PDF file not found.")
    return FileResponse(str(pdf_path), media_type="application/pdf")


@app.get("/pdf/{pdf_id}/thumbnail")
def get_pdf_thumbnail(pdf_id: str, user_id: str = Depends(get_current_user)):
    get_pdf_meta(user_id, pdf_id)  # verify ownership
    thumb_path = get_thumb_path(user_id, pdf_id)
    if not thumb_path.exists():
        raise HTTPException(status_code=404, detail="Thumbnail not found.")
    return FileResponse(str(thumb_path), media_type="image/png")


# --- Reading progress (auth required) ---

@app.post("/library/{pdf_id}/progress")
def save_progress(pdf_id: str, req: ProgressRequest, user_id: str = Depends(get_current_user)):
    meta = _load_user_meta(user_id)
    if pdf_id not in meta:
        raise HTTPException(status_code=404, detail="PDF not found.")
    existing_progress = meta[pdf_id].get("progress", {})
    now = datetime.utcnow().isoformat()
    meta[pdf_id]["progress"] = {
        "current_page": req.current_page,
        "total_time_seconds": existing_progress.get("total_time_seconds", 0) + req.reading_time_seconds,
        "completed": req.completed,
        "last_read_at": now,
        "started_at": existing_progress.get("started_at", now),
    }
    _save_user_meta(user_id, meta)
    return {"progress": meta[pdf_id]["progress"]}


@app.get("/library/{pdf_id}/progress")
def get_progress(pdf_id: str, user_id: str = Depends(get_current_user)):
    info = get_pdf_meta(user_id, pdf_id)
    return {"progress": info.get("progress", {})}


# --- Document analysis (auth required) ---

@app.get("/pdf/{pdf_id}/analysis")
def get_analysis(pdf_id: str, user_id: str = Depends(get_current_user)):
    meta = _load_user_meta(user_id)
    if pdf_id not in meta:
        raise HTTPException(status_code=404, detail="PDF not found.")
    # Return cached analysis if available and up-to-date (has chapter_source field)
    cached = meta[pdf_id].get("analysis")
    if cached and "chapter_source" in cached:
        return {"analysis": cached}
    # Generate analysis with 3-tier chapter detection
    pdf_path = get_pdf_path(user_id, pdf_id)
    pdf_bytes = pdf_path.read_bytes()
    pages = extract_pages(pdf_bytes)

    # Tier 1: PDF bookmarks (most accurate, instant)
    chapters = extract_outline(pdf_bytes)
    chapter_source = "bookmarks"

    # Tier 2: Text heuristics fallback
    if not chapters:
        chapters = detect_chapters_from_text(pages)
        chapter_source = "heuristics"

    # Tier 3: AI fallback (chapters will be empty, AI detects them)
    if not chapters:
        chapter_source = "ai"

    try:
        analysis = analyze_document(pages, known_chapters=chapters if chapters else None)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Analysis failed: {e}")

    # If chapters came from bookmarks or heuristics, ensure they're in the result
    if chapters and chapter_source != "ai":
        analysis["chapters"] = [{"title": c["title"], "page": c["page"]} for c in chapters]

    analysis["chapter_source"] = chapter_source

    # Cache in metadata
    meta[pdf_id]["analysis"] = analysis
    _save_user_meta(user_id, meta)
    return {"analysis": analysis}


# --- AI features (auth required) ---

@app.post("/ask")
def ask(req: AskRequest, user_id: str = Depends(get_current_user)):
    get_pdf_meta(user_id, req.pdf_id)
    pdf_path = get_pdf_path(user_id, req.pdf_id)
    pdf_bytes = pdf_path.read_bytes()
    pages = extract_pages(pdf_bytes)
    pages = get_page_range(pages, req.page_start, req.page_end)
    chunks = find_relevant_chunks(pages, req.question)
    try:
        answer = ask_question(chunks, req.question, voice_mode=req.voice_mode)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI service error: {e}")

    cited_pages = [c["page"] for c in chunks]
    return {"answer": answer, "cited_pages": cited_pages}


@app.post("/summarize")
def summarize(req: SummarizeRequest, user_id: str = Depends(get_current_user)):
    get_pdf_meta(user_id, req.pdf_id)
    pdf_path = get_pdf_path(user_id, req.pdf_id)
    pdf_bytes = pdf_path.read_bytes()
    pages = extract_pages(pdf_bytes)
    pages = get_page_range(pages, req.page_start, req.page_end)
    try:
        summary = summarize_document(pages, voice_mode=req.voice_mode)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI service error: {e}")
    return {"summary": summary}


@app.post("/recommend")
def recommend(req: SummarizeRequest, user_id: str = Depends(get_current_user)):
    get_pdf_meta(user_id, req.pdf_id)
    pdf_path = get_pdf_path(user_id, req.pdf_id)
    pdf_bytes = pdf_path.read_bytes()
    pages = extract_pages(pdf_bytes)
    try:
        books = recommend_books(pages, voice_mode=req.voice_mode)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI service error: {e}")
    return {"recommendations": books}


# --- TTS (auth required) ---

# In-memory cache for extracted PDF pages (avoids re-parsing on every TTS call)
_pages_cache: dict[str, tuple[float, list[dict]]] = {}

def _get_pages_cached(user_id: str, pdf_id: str) -> list[dict]:
    import time
    cache_key = f"{user_id}/{pdf_id}"
    now = time.time()
    if cache_key in _pages_cache:
        ts, pages = _pages_cache[cache_key]
        if now - ts < 600:  # 10 min TTL
            return pages
    pdf_path = get_pdf_path(user_id, pdf_id)
    pdf_bytes = pdf_path.read_bytes()
    pages = extract_pages(pdf_bytes)
    _pages_cache[cache_key] = (now, pages)
    return pages


@app.post("/tts")
async def text_to_speech(req: TTSRequest, user_id: str = Depends(get_current_user)):
    import edge_tts

    get_pdf_meta(user_id, req.pdf_id)
    pages = _get_pages_cached(user_id, req.pdf_id)

    end_page = min(req.start_page + req.num_pages - 1, len(pages))
    selected = [p for p in pages if req.start_page <= p["page"] <= end_page]

    if not selected:
        raise HTTPException(status_code=400, detail="No content found for the requested pages.")

    raw = "\n\n".join(p["text"] for p in selected if p["text"])
    text = clean_text_for_tts(raw)

    if not text.strip():
        raise HTTPException(status_code=400, detail="No readable text on the requested pages.")

    audio_id = str(uuid.uuid4())
    audio_path = AUDIO_DIR / f"{audio_id}.mp3"

    try:
        communicate = edge_tts.Communicate(text, req.voice, rate=req.rate)
        # Stream to capture sentence boundaries for word-level timing
        sentence_boundaries: list[dict] = []
        audio_chunks: list[bytes] = []
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_chunks.append(chunk["data"])
            elif chunk["type"] == "SentenceBoundary":
                sentence_boundaries.append({
                    "offset": chunk.get("offset", 0),
                    "duration": chunk.get("duration", 0),
                    "text": chunk.get("text", ""),
                })
        audio_path.write_bytes(b"".join(audio_chunks))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"TTS generation failed: {e}")

    # Build word-level timings from sentence boundaries
    word_timings: list[dict] = []
    for sent in sentence_boundaries:
        start_ms = sent["offset"] / 10_000  # 100ns units → ms
        dur_ms = sent["duration"] / 10_000
        words = sent["text"].split()
        total_chars = max(sum(len(w) for w in words), 1)
        cursor = start_ms
        for w in words:
            word_dur = dur_ms * (len(w) / total_chars)
            word_timings.append({"word": w, "start": round(cursor), "end": round(cursor + word_dur)})
            cursor += word_dur

    return {
        "audio_url": f"/audio/{audio_id}",
        "pages_read": [p["page"] for p in selected],
        "has_more": end_page < len(pages),
        "next_page": end_page + 1 if end_page < len(pages) else None,
        "text": text,
        "word_timings": word_timings,
    }


@app.get("/audio/{audio_id}")
def get_audio(audio_id: str):
    audio_path = AUDIO_DIR / f"{audio_id}.mp3"
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Audio not found.")
    return FileResponse(str(audio_path), media_type="audio/mpeg")


@app.get("/voices")
async def list_voices():
    import edge_tts
    voices = await edge_tts.list_voices()
    en_voices = [
        {"name": v["Name"], "gender": v["Gender"], "locale": v["Locale"]}
        for v in voices
        if v["Locale"].startswith("en-")
    ]
    return {"voices": en_voices}


# --- Explore free ebooks (public, no auth) ---

@app.get("/explore")
def explore_ebooks():
    return {"categories": CATEGORIES, "catalog": get_all_books()}


@app.get("/explore/search")
async def explore_search(q: str = ""):
    import asyncio
    if not q.strip():
        return {"query": q, "results": [], "total": 0}
    local = search_books_local(q)
    ol_results, gut_results = await asyncio.gather(
        search_open_library(q, limit=20),
        search_gutenberg(q, limit=15),
    )
    seen = set()
    combined = []
    for book in local + gut_results + ol_results:
        key = book["title"].lower().strip()
        if key not in seen:
            seen.add(key)
            combined.append(book)
    return {"query": q, "results": combined, "total": len(combined)}


@app.get("/explore/{category}")
def explore_category(category: str):
    books = get_books_by_category(category)
    if not books:
        raise HTTPException(status_code=404, detail=f"Category '{category}' not found.")
    return {"category": category, "books": books}
