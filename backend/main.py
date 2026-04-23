from fastapi import FastAPI, UploadFile, File, HTTPException, Depends, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel
import uuid
import json
import os
import re
import asyncio
import traceback
import httpx
import stripe
from datetime import datetime

from dotenv import load_dotenv

load_dotenv()

# Stripe configuration
stripe.api_key = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")
STRIPE_PRO_PRICE_ID = os.getenv("STRIPE_PRO_PRICE_ID", "")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

# Free tier limits
FREE_MAX_BOOKS = 5
FREE_MAX_STORAGE_MB = 100

from pdf_parser import extract_pages, get_metadata, find_relevant_chunks, extract_outline, detect_chapters_from_text
from ai_engine import ask_question, summarize_document, recommend_books, clean_text_for_tts, analyze_document
from ebook_catalog import get_all_books, get_books_by_category, search_books_local, search_open_library, search_gutenberg, CATEGORIES, load_dynamic_catalog
from firebase_setup import init_firebase
from auth_middleware import get_current_user
import db

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
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    try:
        init_firebase()
        print("[Startup] Firebase initialized (auth only)")
    except Exception as e:
        print(f"[Startup] Firebase init failed: {e}")
    # Load dynamic book catalog in background (non-blocking)
    asyncio.ensure_future(load_dynamic_catalog())


# --- Subscription / quota helpers ---

def _check_upload_quota(user_id: str, new_file_size: int):
    """Check if user can upload. Raises HTTPException if over quota."""
    sub = db.get_subscription(user_id)
    if sub.get("tier") == "pro" and sub.get("status") == "active":
        return  # Pro users have no limits
    usage = db.get_user_usage(user_id)
    if usage["book_count"] >= FREE_MAX_BOOKS:
        raise HTTPException(
            status_code=403,
            detail=json.dumps({
                "error": "upgrade_required",
                "reason": "book_limit",
                "message": f"Free plan allows {FREE_MAX_BOOKS} books. Upgrade to Pro for unlimited.",
                "current": usage["book_count"],
                "limit": FREE_MAX_BOOKS,
            }),
        )
    if (usage["total_bytes"] + new_file_size) > FREE_MAX_STORAGE_MB * 1024 * 1024:
        raise HTTPException(
            status_code=403,
            detail=json.dumps({
                "error": "upgrade_required",
                "reason": "storage_limit",
                "message": f"Free plan allows {FREE_MAX_STORAGE_MB}MB. Upgrade to Pro for unlimited.",
                "current_mb": round(usage["total_bytes"] / (1024 * 1024), 1),
                "limit_mb": FREE_MAX_STORAGE_MB,
            }),
        )


def _require_pdf(user_id: str, pdf_id: str) -> dict:
    """Return the PDF row or raise 404. Replaces legacy get_pdf_meta."""
    row = db.get_pdf(user_id, pdf_id)
    if not row:
        # Debug: check if PDF exists for ANY user
        all_pdfs = db.list_pdfs(user_id)
        logger.error(f"[_require_pdf] NOT FOUND: user_id={user_id!r}, pdf_id={pdf_id!r}. User has {len(all_pdfs)} PDFs: {[p['id'] for p in all_pdfs[:5]]}")
        raise HTTPException(status_code=404, detail=f"PDF not found. user_id={user_id}, pdf_count={len(all_pdfs)}")
    return row


def _download_pdf_bytes(user_id: str, pdf_id: str) -> bytes:
    """Download a PDF's bytes from object storage."""
    return db.download_file(db.BUCKET_PDFS, db.pdf_object_path(user_id, pdf_id))


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
    has_begin = "-----BEGIN" in pk
    has_end = "-----END" in pk
    has_newlines = "\n" in pk
    return {
        "status": "ok",
        "firebase_initialized": fb_ok,
        "private_key_length": len(pk),
        "has_begin_marker": has_begin,
        "has_end_marker": has_end,
        "has_newlines": has_newlines,
        "project_id": os.getenv("FIREBASE_PROJECT_ID", "MISSING"),
        "client_email": os.getenv("FIREBASE_CLIENT_EMAIL", "MISSING"),
        "supabase_configured": bool(os.getenv("SUPABASE_URL") and os.getenv("SUPABASE_SERVICE_ROLE_KEY")),
    }


# --- Library management (auth required) ---

async def _run_analysis_background(user_id: str, pdf_id: str, pdf_bytes: bytes):
    """Run document analysis in background after upload."""
    try:
        pages = extract_pages(pdf_bytes)
        chapters = extract_outline(pdf_bytes)
        chapter_source = "bookmarks"
        if not chapters:
            chapters = detect_chapters_from_text(pages)
            chapter_source = "heuristics"
        if not chapters:
            chapter_source = "ai"

        loop = asyncio.get_event_loop()
        analysis = await loop.run_in_executor(
            None, lambda: analyze_document(pages, known_chapters=chapters if chapters else None)
        )

        if chapters and chapter_source != "ai":
            analysis["chapters"] = [{"title": c["title"], "page": c["page"]} for c in chapters]
        analysis["chapter_source"] = chapter_source

        db.save_analysis(user_id, pdf_id, analysis, chapter_source=chapter_source)
        logger.info(f"[Analysis] Background analysis complete for {pdf_id}")
    except Exception as e:
        logger.error(f"[Analysis] Background analysis failed for {pdf_id}: {e}")


@app.post("/upload")
async def upload_pdf(file: UploadFile = File(...), user_id: str = Depends(get_current_user)):
    logger.info(f"[Upload] user={user_id}, file={file.filename}")
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted.")

    pdf_bytes = await file.read()
    file_size = len(pdf_bytes)
    if file_size > 50 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large. Max 50MB.")

    # Check free tier quota
    _check_upload_quota(user_id, file_size)

    try:
        pages = extract_pages(pdf_bytes)
        metadata = get_metadata(pdf_bytes)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Failed to parse PDF: {e}")

    pdf_id = str(uuid.uuid4())

    # Upload PDF to Supabase Storage
    try:
        db.upload_file(
            db.BUCKET_PDFS,
            db.pdf_object_path(user_id, pdf_id),
            pdf_bytes,
            content_type="application/pdf",
        )
    except Exception as e:
        logger.error(f"[Upload] Storage upload failed: {e}")
        raise HTTPException(status_code=502, detail="Failed to save PDF to storage.")

    # Generate and upload thumbnail using PyMuPDF
    has_thumbnail = False
    try:
        import fitz
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        page = doc[0]
        pix = page.get_pixmap(matrix=fitz.Matrix(1.0, 1.0))
        thumb_bytes = pix.tobytes("png")
        doc.close()
        db.upload_file(
            db.BUCKET_THUMBNAILS,
            db.thumbnail_object_path(user_id, pdf_id),
            thumb_bytes,
            content_type="image/png",
        )
        has_thumbnail = True
    except Exception as e:
        logger.warning(f"[Upload] Thumbnail generation failed: {e}")

    # Save metadata row
    db.save_pdf(user_id, pdf_id, {
        "filename": file.filename,
        "total_pages": metadata["total_pages"],
        "file_size_bytes": file_size,
        "has_thumbnail": has_thumbnail,
        "source": "upload",
        "uploaded_at": datetime.utcnow().isoformat(),
    })

    logger.info(f"[Upload] Success: pdf_id={pdf_id}")

    # Trigger background analysis so it's ready when user clicks the book
    asyncio.ensure_future(_run_analysis_background(user_id, pdf_id, pdf_bytes))

    return {
        "pdf_id": pdf_id,
        "filename": file.filename,
        "total_pages": metadata["total_pages"],
        "thumbnail_url": f"/pdf/{pdf_id}/thumbnail" if has_thumbnail else None,
        "message": "PDF uploaded and added to library.",
    }


@app.get("/library")
def list_pdfs(user_id: str = Depends(get_current_user)):
    pdfs = db.list_pdfs(user_id)
    # Fetch progress and analysis in bulk to avoid N+1
    progress_by_pdf = {p["pdf_id"]: p for p in db.list_progress(user_id)}

    result = []
    for item in pdfs:
        pdf_id = item["id"]
        entry = {
            "pdf_id": pdf_id,
            "filename": item.get("filename", ""),
            "total_pages": item.get("total_pages", 0),
            "thumbnail_url": f"/pdf/{pdf_id}/thumbnail" if item.get("has_thumbnail") else None,
            "uploaded_at": item.get("uploaded_at"),
        }
        prog = progress_by_pdf.get(pdf_id)
        if prog:
            entry["progress"] = {
                "current_page": prog.get("current_page", 1),
                "total_time_seconds": prog.get("total_time_seconds", 0),
                "completed": prog.get("completed", False),
                "last_read_at": prog.get("last_read_at"),
                "started_at": prog.get("started_at"),
            }
        # Pass through optional explore-import fields
        if item.get("source") == "explore_import":
            entry["source"] = "explore_import"
            entry["original_title"] = item.get("original_title")
            entry["original_author"] = item.get("original_author")
            entry["cover_url"] = item.get("cover_url")
            entry["description"] = item.get("description")
            entry["tags"] = item.get("tags", [])
        result.append(entry)
    return {"pdfs": result}


@app.delete("/library/{pdf_id}")
def delete_pdf(pdf_id: str, user_id: str = Depends(get_current_user)):
    info = _require_pdf(user_id, pdf_id)
    filename = info.get("filename", pdf_id)

    # Delete from object storage (best-effort)
    db.delete_file(db.BUCKET_PDFS, db.pdf_object_path(user_id, pdf_id))
    if info.get("has_thumbnail"):
        db.delete_file(db.BUCKET_THUMBNAILS, db.thumbnail_object_path(user_id, pdf_id))

    # Delete the pdf row — cascades to pdf_progress and pdf_analysis
    db.delete_pdf(user_id, pdf_id)
    return {"message": f"Deleted '{filename}' from library."}


@app.get("/pdf/{pdf_id}/file")
def get_pdf_file(pdf_id: str, user_id: str = Depends(get_current_user)):
    _require_pdf(user_id, pdf_id)
    try:
        url = db.get_signed_url(db.BUCKET_PDFS, db.pdf_object_path(user_id, pdf_id))
    except Exception as e:
        logger.error(f"[PDF file] Signed URL failed: {e}")
        raise HTTPException(status_code=404, detail="PDF file not found.")
    if not url:
        raise HTTPException(status_code=404, detail="PDF file not found.")
    return RedirectResponse(url, status_code=302)


@app.get("/pdf/{pdf_id}/thumbnail")
def get_pdf_thumbnail(pdf_id: str, user_id: str = Depends(get_current_user)):
    info = _require_pdf(user_id, pdf_id)
    thumb_path = db.thumbnail_object_path(user_id, pdf_id)

    # Generate on-demand if missing
    if not info.get("has_thumbnail"):
        try:
            import fitz
            pdf_bytes = _download_pdf_bytes(user_id, pdf_id)
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")
            page = doc[0]
            pix = page.get_pixmap(matrix=fitz.Matrix(1.0, 1.0))
            thumb_bytes = pix.tobytes("png")
            doc.close()
            db.upload_file(
                db.BUCKET_THUMBNAILS, thumb_path, thumb_bytes, content_type="image/png"
            )
            db.save_pdf(user_id, pdf_id, {**info, "has_thumbnail": True})
        except Exception:
            raise HTTPException(status_code=404, detail="Thumbnail not found.")

    try:
        url = db.get_signed_url(db.BUCKET_THUMBNAILS, thumb_path)
    except Exception:
        raise HTTPException(status_code=404, detail="Thumbnail not found.")
    if not url:
        raise HTTPException(status_code=404, detail="Thumbnail not found.")
    return RedirectResponse(url, status_code=302)


# --- Reading progress (auth required) ---

@app.post("/library/{pdf_id}/progress")
def save_progress(pdf_id: str, req: ProgressRequest, user_id: str = Depends(get_current_user)):
    _require_pdf(user_id, pdf_id)
    existing = db.get_progress(user_id, pdf_id) or {}
    now = datetime.utcnow().isoformat()
    progress = {
        "current_page": req.current_page,
        "total_time_seconds": int(existing.get("total_time_seconds", 0) or 0) + req.reading_time_seconds,
        "completed": req.completed,
        "last_read_at": now,
        "started_at": existing.get("started_at") or now,
    }
    db.save_progress(user_id, pdf_id, progress)
    return {"progress": progress}


@app.get("/library/{pdf_id}/progress")
def get_progress(pdf_id: str, user_id: str = Depends(get_current_user)):
    _require_pdf(user_id, pdf_id)
    prog = db.get_progress(user_id, pdf_id) or {}
    return {
        "progress": {
            "current_page": prog.get("current_page", 1),
            "total_time_seconds": prog.get("total_time_seconds", 0),
            "completed": prog.get("completed", False),
            "last_read_at": prog.get("last_read_at"),
            "started_at": prog.get("started_at"),
        } if prog else {}
    }


# --- Document analysis (auth required) ---

@app.get("/pdf/{pdf_id}/analysis")
def get_analysis(pdf_id: str, user_id: str = Depends(get_current_user)):
    _require_pdf(user_id, pdf_id)

    # Return cached analysis if available
    cached_row = db.get_analysis(user_id, pdf_id)
    if cached_row and cached_row.get("analysis"):
        cached = cached_row["analysis"]
        if "chapter_source" in cached:
            return {"analysis": cached}

    # Generate analysis with 3-tier chapter detection
    pdf_bytes = _download_pdf_bytes(user_id, pdf_id)
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

    db.save_analysis(user_id, pdf_id, analysis, chapter_source=chapter_source)
    return {"analysis": analysis}


# --- AI features (auth required) ---

@app.post("/ask")
def ask(req: AskRequest, user_id: str = Depends(get_current_user)):
    _require_pdf(user_id, req.pdf_id)
    pdf_bytes = _download_pdf_bytes(user_id, req.pdf_id)
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
    _require_pdf(user_id, req.pdf_id)
    pdf_bytes = _download_pdf_bytes(user_id, req.pdf_id)
    pages = extract_pages(pdf_bytes)
    pages = get_page_range(pages, req.page_start, req.page_end)
    try:
        summary = summarize_document(pages, voice_mode=req.voice_mode)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI service error: {e}")
    return {"summary": summary}


@app.post("/recommend")
def recommend(req: SummarizeRequest, user_id: str = Depends(get_current_user)):
    _require_pdf(user_id, req.pdf_id)
    pdf_bytes = _download_pdf_bytes(user_id, req.pdf_id)
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
    pdf_bytes = _download_pdf_bytes(user_id, pdf_id)
    pages = extract_pages(pdf_bytes)
    _pages_cache[cache_key] = (now, pages)
    return pages


# In-memory TTS job store
_tts_jobs: dict[str, dict] = {}

# Audio cache: hash(pdf_id+page+voice+rate) -> {audio_id, word_timings, text}
import hashlib
_audio_cache: dict[str, dict] = {}


def _audio_cache_key(pdf_id: str, pages: list[int], voice: str, rate: str) -> str:
    raw = f"{pdf_id}:{','.join(map(str, sorted(pages)))}:{voice}:{rate}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


async def _generate_single_page_tts(page_text: str, voice: str, rate: str):
    """Generate TTS for a single page. Returns (audio_bytes, sentence_boundaries)."""
    import edge_tts
    communicate = edge_tts.Communicate(page_text, voice, rate=rate)
    boundaries: list[dict] = []
    chunks: list[bytes] = []
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            chunks.append(chunk["data"])
        elif chunk["type"] == "SentenceBoundary":
            boundaries.append({
                "offset": chunk.get("offset", 0),
                "duration": chunk.get("duration", 0),
                "text": chunk.get("text", ""),
            })
    return b"".join(chunks), boundaries


async def _run_tts_job(job_id: str, user_id: str, req_data: dict):
    """Background coroutine that generates TTS audio with parallel page processing."""
    try:
        pages = _get_pages_cached(user_id, req_data["pdf_id"])
        end_page = min(req_data["start_page"] + req_data["num_pages"] - 1, len(pages))
        selected = [p for p in pages if req_data["start_page"] <= p["page"] <= end_page]

        if not selected:
            _tts_jobs[job_id] = {"status": "failed", "error": "No content found for the requested pages."}
            return

        page_nums = [p["page"] for p in selected]
        cache_key = _audio_cache_key(req_data["pdf_id"], page_nums, req_data["voice"], req_data["rate"])

        # Check audio cache — instant return if already generated
        if cache_key in _audio_cache:
            cached = _audio_cache[cache_key]
            _tts_jobs[job_id] = {
                "status": "done",
                "audio_url": cached["audio_url"],
                "pages_read": page_nums,
                "has_more": end_page < len(pages),
                "next_page": end_page + 1 if end_page < len(pages) else None,
                "text": cached["text"],
                "word_timings": cached["word_timings"],
            }
            logger.info(f"[TTS Job {job_id}] Cache hit for pages {page_nums}")
            return

        # Clean text per page
        page_texts = []
        for p in selected:
            cleaned = clean_text_for_tts(p["text"]) if p["text"] else ""
            if cleaned.strip():
                page_texts.append(cleaned)

        if not page_texts:
            _tts_jobs[job_id] = {"status": "failed", "error": "No readable text on the requested pages."}
            return

        _tts_jobs[job_id] = {"status": "processing", "progress": 10}

        # ── Streaming approach: generate first page immediately, rest in parallel ──
        # Generate first page right away so frontend can start playing
        first_audio, first_boundaries = await _generate_single_page_tts(
            page_texts[0], req_data["voice"], req_data["rate"]
        )

        # Build word timings for first page
        first_word_timings: list[dict] = []
        first_cumulative = 0
        for sent in first_boundaries:
            end_offset = sent["offset"] + sent["duration"]
            if end_offset > first_cumulative:
                first_cumulative = end_offset
            start_ms = sent["offset"] / 10_000
            dur_ms = sent["duration"] / 10_000
            words = sent["text"].split()
            total_chars = max(sum(len(w) for w in words), 1)
            cursor = start_ms
            for w in words:
                word_dur = dur_ms * (len(w) / total_chars)
                first_word_timings.append({"word": w, "start": round(cursor), "end": round(cursor + word_dur)})
                cursor += word_dur

        # Upload first page audio so frontend can start playing immediately
        if len(page_texts) > 1:
            first_audio_id = str(uuid.uuid4())
            db.upload_file(
                db.BUCKET_AUDIO,
                db.audio_object_path(first_audio_id),
                first_audio,
                content_type="audio/mpeg",
            )
            _tts_jobs[job_id] = {
                "status": "first_page_ready",
                "audio_url": f"/audio/{first_audio_id}",
                "text": page_texts[0],
                "word_timings": first_word_timings,
                "pages_read": page_nums[:1],
                "progress": 30,
            }
            logger.info(f"[TTS Job {job_id}] First page ready, generating remaining {len(page_texts)-1} pages...")

            # Generate remaining pages in parallel
            remaining_tasks = [
                _generate_single_page_tts(text, req_data["voice"], req_data["rate"])
                for text in page_texts[1:]
            ]
            remaining_results = await asyncio.gather(*remaining_tasks)
            results = [(first_audio, first_boundaries)] + list(remaining_results)
        else:
            # Only one page — skip the intermediate step
            results = [(first_audio, first_boundaries)]

        _tts_jobs[job_id] = {"status": "processing", "progress": 80}

        # Concatenate all audio and build complete word timings
        all_audio = b""
        word_timings: list[dict] = []
        cumulative_offset = 0  # in Edge TTS units (10,000ths of second)

        for audio_bytes, boundaries in results:
            all_audio += audio_bytes
            page_max_offset = 0
            for sent in boundaries:
                end_offset = sent["offset"] + sent["duration"]
                if end_offset > page_max_offset:
                    page_max_offset = end_offset
                start_ms = (sent["offset"] + cumulative_offset) / 10_000
                dur_ms = sent["duration"] / 10_000
                words = sent["text"].split()
                total_chars = max(sum(len(w) for w in words), 1)
                cursor = start_ms
                for w in words:
                    word_dur = dur_ms * (len(w) / total_chars)
                    word_timings.append({"word": w, "start": round(cursor), "end": round(cursor + word_dur)})
                    cursor += word_dur
            cumulative_offset += page_max_offset

        audio_id = str(uuid.uuid4())
        # Upload full concatenated audio to Supabase Storage
        db.upload_file(
            db.BUCKET_AUDIO,
            db.audio_object_path(audio_id),
            all_audio,
            content_type="audio/mpeg",
        )

        full_text = "\n\n".join(page_texts)
        audio_url = f"/audio/{audio_id}"

        # Cache the result
        _audio_cache[cache_key] = {
            "audio_url": audio_url,
            "text": full_text,
            "word_timings": word_timings,
        }

        _tts_jobs[job_id] = {
            "status": "done",
            "audio_url": audio_url,
            "pages_read": page_nums,
            "has_more": end_page < len(pages),
            "next_page": end_page + 1 if end_page < len(pages) else None,
            "text": full_text,
            "word_timings": word_timings,
        }

        # Pre-generate next pages in background
        if end_page < len(pages):
            next_start = end_page + 1
            next_end = min(next_start + req_data["num_pages"] - 1, len(pages))
            next_pages = [p["page"] for p in pages if next_start <= p["page"] <= next_end]
            next_cache_key = _audio_cache_key(req_data["pdf_id"], next_pages, req_data["voice"], req_data["rate"])
            if next_cache_key not in _audio_cache:
                logger.info(f"[TTS] Pre-generating next pages {next_pages}")
                prefetch_job_id = f"prefetch-{uuid.uuid4()}"
                _tts_jobs[prefetch_job_id] = {"status": "processing"}
                asyncio.ensure_future(_run_tts_job(prefetch_job_id, user_id, {
                    **req_data,
                    "start_page": next_start,
                }))

    except Exception as e:
        logger.error(f"[TTS Job {job_id}] Failed: {e}\n{traceback.format_exc()}")
        _tts_jobs[job_id] = {"status": "failed", "error": str(e)}


@app.post("/tts")
async def text_to_speech(req: TTSRequest, user_id: str = Depends(get_current_user)):
    """Starts TTS generation as a background job. Returns job_id immediately."""
    _require_pdf(user_id, req.pdf_id)

    job_id = str(uuid.uuid4())
    _tts_jobs[job_id] = {"status": "processing"}

    # Launch background task
    asyncio.ensure_future(_run_tts_job(job_id, user_id, {
        "pdf_id": req.pdf_id,
        "start_page": req.start_page,
        "num_pages": req.num_pages,
        "voice": req.voice,
        "rate": req.rate,
    }))

    return {"job_id": job_id, "status": "processing"}


@app.get("/tts/{job_id}")
def get_tts_job(job_id: str, user_id: str = Depends(get_current_user)):
    """Poll for TTS job status. Returns result when done."""
    job = _tts_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job


@app.get("/audio/{audio_id}")
def get_audio(audio_id: str):
    """Redirect to a signed URL for the audio file in Supabase Storage."""
    try:
        url = db.get_signed_url(db.BUCKET_AUDIO, db.audio_object_path(audio_id))
    except Exception:
        raise HTTPException(status_code=404, detail="Audio not found.")
    if not url:
        raise HTTPException(status_code=404, detail="Audio not found.")
    return RedirectResponse(url, status_code=302)


_voices_cache: list[dict] | None = None

@app.get("/voices")
async def list_voices():
    global _voices_cache
    if _voices_cache is not None:
        return {"voices": _voices_cache}
    import edge_tts
    voices = await edge_tts.list_voices()
    us_voices = [
        {"name": v["Name"], "gender": v["Gender"], "locale": v["Locale"]}
        for v in voices
        if v["Locale"].startswith("en-US")
    ]
    _voices_cache = us_voices
    return {"voices": us_voices}


# --- Explore free ebooks (public, no auth) ---

@app.get("/explore")
def explore_ebooks():
    all_books = get_all_books()
    cats = list(all_books.keys())
    return {"categories": cats, "catalog": all_books}


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


class ImportBookRequest(BaseModel):
    title: str
    author: str
    download_url: str
    cover_url: str | None = None
    description: str = ""
    tags: list[str] = []


@app.post("/explore/import")
async def import_explore_book(req: ImportBookRequest, user_id: str = Depends(get_current_user)):
    """Download a book from explore and add it to the user's library."""
    import fitz  # PyMuPDF for epub/pdf handling

    # Check quota before downloading (estimate 5MB for explore books)
    _check_upload_quota(user_id, 5 * 1024 * 1024)

    try:
        # Download the file
        async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
            res = await client.get(req.download_url)
            res.raise_for_status()

        content = res.content
        content_type = res.headers.get("content-type", "")
        url_lower = req.download_url.lower()

        # Determine file type and convert to PDF if needed
        pdf_bytes = None
        if "pdf" in content_type or url_lower.endswith(".pdf"):
            pdf_bytes = content
        elif "epub" in content_type or url_lower.endswith(".epub"):
            # Convert epub to PDF using PyMuPDF
            try:
                doc = fitz.open(stream=content, filetype="epub")
                pdf_bytes = doc.convert_to_pdf()
                doc.close()
            except Exception as e:
                logger.error(f"EPUB conversion failed: {e}")
                raise HTTPException(status_code=422, detail="Could not convert EPUB to PDF.")
        elif "text" in content_type or url_lower.endswith(".txt"):
            # Wrap plain text into a PDF
            try:
                doc = fitz.open()
                # Split text into ~3000 char pages
                text = content.decode("utf-8", errors="replace")
                chunk_size = 3000
                for i in range(0, len(text), chunk_size):
                    page = doc.new_page(width=612, height=792)
                    text_rect = fitz.Rect(50, 50, 562, 742)
                    page.insert_textbox(text_rect, text[i:i + chunk_size], fontsize=11, fontname="helv")
                pdf_bytes = doc.tobytes()
                doc.close()
            except Exception as e:
                logger.error(f"Text-to-PDF conversion failed: {e}")
                raise HTTPException(status_code=422, detail="Could not convert text to PDF.")
        else:
            # Try treating as PDF anyway
            pdf_bytes = content

        if not pdf_bytes:
            raise HTTPException(status_code=422, detail="Could not process the downloaded file.")

        # Verify it's a valid PDF
        try:
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")
            total_pages = doc.page_count
            doc.close()
        except Exception:
            raise HTTPException(status_code=422, detail="Downloaded file is not a valid PDF.")

        # Save to user's library
        pdf_id = str(uuid.uuid4())
        safe_title = re.sub(r'[^\w\s\-.]', '', req.title)[:100].strip() or "imported-book"
        filename = f"{safe_title}.pdf"

        # Upload PDF to Supabase Storage
        try:
            db.upload_file(
                db.BUCKET_PDFS,
                db.pdf_object_path(user_id, pdf_id),
                pdf_bytes,
                content_type="application/pdf",
            )
        except Exception as e:
            logger.error(f"[Import] Storage upload failed: {e}")
            raise HTTPException(status_code=502, detail="Failed to save imported book.")

        # Generate and upload thumbnail from first page
        has_thumbnail = False
        try:
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")
            page = doc[0]
            pix = page.get_pixmap(matrix=fitz.Matrix(0.5, 0.5))
            thumb_bytes = pix.tobytes("png")
            doc.close()
            db.upload_file(
                db.BUCKET_THUMBNAILS,
                db.thumbnail_object_path(user_id, pdf_id),
                thumb_bytes,
                content_type="image/png",
            )
            has_thumbnail = True
        except Exception:
            pass

        # Save metadata row
        db.save_pdf(user_id, pdf_id, {
            "filename": filename,
            "total_pages": total_pages,
            "file_size_bytes": len(pdf_bytes),
            "has_thumbnail": has_thumbnail,
            "source": "explore_import",
            "original_title": req.title,
            "original_author": req.author,
            "cover_url": req.cover_url,
            "description": req.description,
            "tags": req.tags,
            "uploaded_at": datetime.utcnow().isoformat(),
        })

        return {
            "pdf_id": pdf_id,
            "filename": filename,
            "total_pages": total_pages,
            "thumbnail_url": f"/pdf/{pdf_id}/thumbnail" if has_thumbnail else None,
            "message": f"'{req.title}' added to your library.",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Import book failed: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Failed to import book: {str(e)}")


# --- Account & Subscription (auth required) ---

@app.get("/account")
def get_account(user_id: str = Depends(get_current_user)):
    """Get account info: subscription tier, usage, and limits."""
    sub = db.get_subscription(user_id)
    usage = db.get_user_usage(user_id)
    is_pro = sub.get("tier") == "pro" and sub.get("status") == "active"
    return {
        "subscription": {
            "tier": sub.get("tier", "free"),
            "status": sub.get("status", "active"),
            "stripe_customer_id": None,  # never expose to client
            "current_period_end": sub.get("current_period_end"),
        },
        "usage": {
            "books": usage["book_count"],
            "storage_mb": round(usage["total_bytes"] / (1024 * 1024), 1),
        },
        "limits": {
            "books": None if is_pro else FREE_MAX_BOOKS,
            "storage_mb": None if is_pro else FREE_MAX_STORAGE_MB,
        },
    }


@app.post("/create-checkout-session")
def create_checkout_session(user_id: str = Depends(get_current_user)):
    """Create a Stripe Checkout session for Pro upgrade."""
    if not stripe.api_key or not STRIPE_PRO_PRICE_ID:
        raise HTTPException(status_code=500, detail="Payment system not configured.")

    # Get or create Stripe customer
    user = db.get_user(user_id) or {}
    customer_id = user.get("stripe_customer_id")

    if not customer_id:
        customer = stripe.Customer.create(metadata={"user_id": user_id})
        customer_id = customer.id
        db.set_stripe_customer(user_id, customer_id)

    session = stripe.checkout.Session.create(
        customer=customer_id,
        payment_method_types=["card"],
        line_items=[{"price": STRIPE_PRO_PRICE_ID, "quantity": 1}],
        mode="subscription",
        success_url=f"{FRONTEND_URL}?upgraded=true",
        cancel_url=f"{FRONTEND_URL}?upgraded=false",
        metadata={"user_id": user_id},
    )
    return {"checkout_url": session.url}


@app.post("/create-portal-session")
def create_portal_session(user_id: str = Depends(get_current_user)):
    """Create a Stripe Customer Portal session for managing subscription."""
    user = db.get_user(user_id) or {}
    customer_id = user.get("stripe_customer_id")
    if not customer_id:
        raise HTTPException(status_code=400, detail="No subscription found.")

    session = stripe.billing_portal.Session.create(
        customer=customer_id,
        return_url=FRONTEND_URL,
    )
    return {"portal_url": session.url}


@app.post("/webhooks/stripe")
async def stripe_webhook(request: Request):
    """Handle Stripe webhook events to sync subscription state."""
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")

    try:
        event = stripe.Webhook.construct_event(payload, sig, STRIPE_WEBHOOK_SECRET)
    except (ValueError, stripe.SignatureVerificationError) as e:
        logger.error(f"[Stripe Webhook] Verification failed: {e}")
        raise HTTPException(status_code=400, detail="Invalid signature.")

    event_type = event["type"]
    data = event["data"]["object"]
    logger.info(f"[Stripe Webhook] {event_type}")

    if event_type == "checkout.session.completed":
        customer_id = data.get("customer")
        user_id = data.get("metadata", {}).get("user_id")
        if not user_id and customer_id:
            user_id = db.find_user_by_stripe_customer(customer_id)
        if user_id:
            subscription_id = data.get("subscription")
            if customer_id:
                db.set_stripe_customer(user_id, customer_id)
            db.upsert_subscription(user_id, {
                "tier": "pro",
                "status": "active",
                "stripe_subscription_id": subscription_id,
            })
            logger.info(f"[Stripe] User {user_id} upgraded to Pro")

    elif event_type in ("customer.subscription.updated", "customer.subscription.deleted"):
        customer_id = data.get("customer")
        user_id = db.find_user_by_stripe_customer(customer_id) if customer_id else None
        if user_id:
            status = data.get("status", "")
            is_active = status in ("active", "trialing")
            current_period_end = data.get("current_period_end")
            db.upsert_subscription(user_id, {
                "tier": "pro" if is_active else "free",
                "status": status,
                "stripe_subscription_id": data.get("id"),
                "current_period_end": datetime.utcfromtimestamp(current_period_end).isoformat() if current_period_end else None,
            })
            logger.info(f"[Stripe] User {user_id} subscription {status}")

    return {"received": True}
