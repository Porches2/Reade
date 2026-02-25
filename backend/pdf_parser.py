import pdfplumber
import fitz  # PyMuPDF
import re
from io import BytesIO


def extract_pages(pdf_bytes: bytes) -> list[dict]:
    """Extract text from each page of a PDF. Returns list of {page, text}."""
    pages = []
    with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
        for i, page in enumerate(pdf.pages, start=1):
            text = page.extract_text() or ""
            pages.append({"page": i, "text": text.strip()})
    return pages


def get_metadata(pdf_bytes: bytes) -> dict:
    """Extract basic PDF metadata."""
    with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
        return {
            "total_pages": len(pdf.pages),
            "metadata": pdf.metadata or {},
        }


def extract_outline(pdf_bytes: bytes) -> list[dict]:
    """Extract PDF bookmarks/outline using PyMuPDF. Returns list of {title, page, level}."""
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        toc = doc.get_toc()  # [[level, title, page], ...]
        doc.close()
        chapters = []
        for level, title, page in toc:
            title = title.strip()
            if title and page > 0:
                chapters.append({"title": title, "page": page, "level": level})
        return chapters
    except Exception:
        return []


# Patterns for detecting chapter headings in page text
_CHAPTER_PATTERNS = [
    re.compile(r"^(Chapter\s+(\d+|[IVXLCDM]+))\s*[:\-—]?\s*(.*)", re.IGNORECASE),
    re.compile(r"^(Part\s+(\d+|[IVXLCDM]+))\s*[:\-—]?\s*(.*)", re.IGNORECASE),
    re.compile(r"^(Section\s+\d+[\.\d]*)\s*[:\-—]?\s*(.*)", re.IGNORECASE),
]


def detect_chapters_from_text(pages: list[dict]) -> list[dict]:
    """Detect chapter headings from page text using regex heuristics."""
    chapters = []
    for page_data in pages:
        text = page_data["text"]
        if not text:
            continue
        lines = text.split("\n")[:8]  # Check first 8 lines of each page
        for line in lines:
            line = line.strip()
            if not line:
                continue
            # Check regex patterns
            for pattern in _CHAPTER_PATTERNS:
                m = pattern.match(line)
                if m:
                    # Build title from matched groups
                    prefix = m.group(1).strip()
                    rest = m.group(m.lastindex).strip() if m.lastindex and m.lastindex > 1 else ""
                    title = f"{prefix}: {rest}" if rest and rest != prefix else prefix
                    chapters.append({"title": title, "page": page_data["page"]})
                    break
            else:
                # Check for short ALL-CAPS lines (likely headings) — only on first 3 lines
                if lines.index(line) < 3 and line.isupper() and 4 <= len(line) <= 60 and not line.startswith("PAGE"):
                    chapters.append({"title": line.title(), "page": page_data["page"]})
    return chapters


def find_relevant_chunks(pages: list[dict], query: str, top_k: int = 5) -> list[dict]:
    """Simple keyword-based retrieval: score pages by query term overlap."""
    query_terms = set(query.lower().split())
    scored = []
    for page in pages:
        page_terms = set(page["text"].lower().split())
        overlap = len(query_terms & page_terms)
        if overlap > 0 or not query_terms:
            scored.append((overlap, page))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [page for _, page in scored[:top_k]]
