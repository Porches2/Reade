import anthropic
import os
from dotenv import load_dotenv

load_dotenv()

client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

SYSTEM_PROMPT = """You are an advanced AI document intelligence engine.

Your role is to:
- Analyze PDF documents accurately.
- Answer questions using ONLY the provided document context.
- Cite page numbers when available.
- Never fabricate information.
- If the answer is not in the document, respond: "This information is not found in the document."

Response Guidelines:
- Be structured.
- Be concise.
- Use bullet points when appropriate.
- Highlight key insights.
- Explain complex ideas clearly.

If summarizing:
Provide:
1. Executive Summary (2-3 sentences)
2. Section Breakdown
3. Key Insights
4. Actionable Points (if applicable)

If explaining:
- Simplify language.
- Use examples.
- Maintain accuracy."""

VOICE_ADDENDUM = """
Additional instruction: Write in a natural spoken tone suitable for voice narration.
Avoid markdown symbols like **, ##, or bullet characters.
Keep the flow conversational and easy to listen to."""


def format_chunks(chunks: list[dict]) -> str:
    """Format page chunks into context string."""
    parts = []
    for chunk in chunks:
        parts.append(f"--- Page {chunk['page']} ---\n{chunk['text']}")
    return "\n\n".join(parts)


def ask_question(chunks: list[dict], question: str, voice_mode: bool = False) -> str:
    """Ask a question about the document using Claude."""
    context = format_chunks(chunks)
    system = SYSTEM_PROMPT + (VOICE_ADDENDUM if voice_mode else "")

    user_message = f"""Here is the relevant document context:

---
{context}
---

User Question:
{question}

Answer using ONLY the context above.
If information is missing, say so clearly."""

    response = client.messages.create(
        model="claude-sonnet-4-5-20250929",
        max_tokens=2048,
        system=system,
        messages=[{"role": "user", "content": user_message}],
    )
    return response.content[0].text


def summarize_document(pages: list[dict], voice_mode: bool = False) -> str:
    """Generate a structured summary of the document. Samples pages for large docs."""
    # For large documents, sample key pages to stay within token limits
    MAX_PAGES = 30
    if len(pages) > MAX_PAGES:
        # Take first 10, last 5, and evenly spaced middle pages
        step = max(1, (len(pages) - 15) // 15)
        middle = pages[10:-5:step][:15]
        sampled = pages[:10] + middle + pages[-5:]
        note = f"(Note: This document has {len(pages)} pages. Summary is based on a representative sample of {len(sampled)} pages.)\n\n"
    else:
        sampled = pages
        note = ""

    context = format_chunks(sampled)
    system = SYSTEM_PROMPT + (VOICE_ADDENDUM if voice_mode else "")

    user_message = f"""Here is the document content:

---
{context}
---

Please provide a comprehensive summary of this document following your summarization format:
1. Executive Summary (2-3 sentences)
2. Section Breakdown
3. Key Insights
4. Actionable Points (if applicable)"""

    response = client.messages.create(
        model="claude-sonnet-4-5-20250929",
        max_tokens=4096,
        system=system,
        messages=[{"role": "user", "content": user_message}],
    )
    return note + response.content[0].text


def recommend_books(pages: list[dict], voice_mode: bool = False) -> str:
    """Recommend related books based on the document's topics."""
    # Use first ~15 pages to understand the document's topic
    sample = pages[:15]
    context = format_chunks(sample)
    system = SYSTEM_PROMPT + (VOICE_ADDENDUM if voice_mode else "")

    user_message = f"""Here is a sample from a document the user uploaded:

---
{context}
---

Based on the topics and themes in this document, recommend 5-8 books that the reader would likely enjoy or find useful. For each book provide:
- Title and Author
- A 1-2 sentence description of why it's relevant
- How it complements or extends the ideas in the uploaded document

Focus on well-known, highly-rated books in similar subject areas."""

    response = client.messages.create(
        model="claude-sonnet-4-5-20250929",
        max_tokens=2048,
        system=system,
        messages=[{"role": "user", "content": user_message}],
    )
    return response.content[0].text


def analyze_document(pages: list[dict], known_chapters: list[dict] | None = None) -> dict:
    """Analyze document to extract TOC, important pages, and book type using Claude.

    If known_chapters are provided (from PDF bookmarks or text heuristics),
    AI skips chapter detection and focuses on importance/tags/type only.
    """
    # Sample pages for large docs
    MAX_PAGES = 40
    if len(pages) > MAX_PAGES:
        step = max(1, (len(pages) - 15) // 25)
        middle = pages[10:-5:step][:25]
        sampled = pages[:10] + middle + pages[-5:]
    else:
        sampled = pages

    context = format_chunks(sampled)

    # If we already have good chapter data, ask AI for everything else only
    chapters_already_found = known_chapters and len(known_chapters) >= 3

    if chapters_already_found:
        import json as _json
        chapters_json = _json.dumps(known_chapters[:30], indent=2)
        user_message = f"""Analyze this document and return a JSON object. The table of contents / chapters have already been extracted from the PDF structure:

{chapters_json}

Return a JSON object with:
{{
  "book_type": "string - one of: textbook, novel, research-paper, manual, report, essay, reference, self-help, biography, other",
  "tags": ["string array of 2-4 topic tags like: programming, philosophy, business, psychology, design, science, fiction, history, etc."],
  "important_pages": [
    {{"page": page_number, "reason": "brief 5-10 word reason why this page is important"}}
  ]
}}

Rules:
- Do NOT include a "chapters" field — chapters are already known.
- For important_pages: rank the top 5-10 most important/insightful pages. Focus on key arguments, conclusions, definitions, or turning points.
- Return ONLY valid JSON, no markdown fences, no explanation.

Document ({len(pages)} total pages):

---
{context}
---"""
    else:
        # Include any sparse hints if available
        hints = ""
        if known_chapters:
            import json as _json
            hints = f"\nSome chapter headings were detected: {_json.dumps(known_chapters)}\nUse these as hints but find additional chapters.\n"

        user_message = f"""Analyze this document and return a JSON object with the following structure:

{{
  "book_type": "string - one of: textbook, novel, research-paper, manual, report, essay, reference, self-help, biography, other",
  "tags": ["string array of 2-4 topic tags like: programming, philosophy, business, psychology, design, science, fiction, history, etc."],
  "chapters": [
    {{"title": "chapter/section title", "page": page_number}}
  ],
  "important_pages": [
    {{"page": page_number, "reason": "brief 5-10 word reason why this page is important"}}
  ]
}}

Rules:
- For chapters: identify table of contents, chapter headings, major section breaks. Include page numbers.
- For important_pages: rank the top 5-10 most important/insightful pages. Focus on key arguments, conclusions, definitions, or turning points.
- Return ONLY valid JSON, no markdown fences, no explanation.
{hints}
Document ({len(pages)} total pages):

---
{context}
---"""

    import json as _json
    response = client.messages.create(
        model="claude-sonnet-4-5-20250929",
        max_tokens=2048,
        system="You are a document analysis engine. Return only valid JSON.",
        messages=[{"role": "user", "content": user_message}],
    )
    text = response.content[0].text.strip()
    # Strip markdown fences if present
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
    try:
        result = _json.loads(text)
    except _json.JSONDecodeError:
        result = {"book_type": "other", "tags": [], "chapters": [], "important_pages": []}

    # If chapters were already known, inject them into the result
    if chapters_already_found:
        result["chapters"] = [{"title": c["title"], "page": c["page"]} for c in known_chapters]

    return result


NARRATOR_SYSTEM = """You are a professional narrator and document reader.

Your tasks:
- Convert the PDF text into natural, expressive spoken language suitable for narration.
- Make the reading friendly, clear, smooth, and engaging.
- Add pauses, phrasing, and natural sentence breaks for a human-like flow.
- Remove any markdown, bullet points, tables, or technical formatting.
- Keep all important details intact.
- For questions:
  - Answer only using the PDF content.
  - If the answer is missing, say: "This information is not found in the document."
  - Format the answer in a way that reads naturally aloud.
- Output should be ready to feed directly into a TTS engine like Coqui TTS, Edge TTS, or ElevenLabs."""


def clean_text_for_tts(text: str) -> str:
    """Clean raw PDF text for browser TTS — no AI needed."""
    import re
    # Remove markdown-style formatting
    text = re.sub(r'[#*_`~\[\]]', '', text)
    # Remove bullet characters
    text = re.sub(r'^[\-•●◦▪]\s*', '', text, flags=re.MULTILINE)
    # Collapse multiple newlines into sentence breaks
    text = re.sub(r'\n{2,}', '. ', text)
    # Replace single newlines (mid-paragraph) with space
    text = re.sub(r'\n', ' ', text)
    # Collapse multiple spaces
    text = re.sub(r' {2,}', ' ', text)
    # Clean up double periods
    text = re.sub(r'\.{2,}', '.', text)
    # Add period after lines that don't end with punctuation
    text = re.sub(r'([a-zA-Z0-9])\. ([A-Z])', r'\1.\n\n\2', text)
    return text.strip()
