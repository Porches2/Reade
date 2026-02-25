"""Curated catalog of free, legal, public domain ebooks + Open Library search."""

import re
import httpx


def _gutenberg_cover(url: str) -> str | None:
    """Extract Gutenberg book ID from URL and return a cover image URL."""
    m = re.search(r"gutenberg\.org/ebooks/(\d+)", url)
    if m:
        return f"https://www.gutenberg.org/cache/epub/{m.group(1)}/pg{m.group(1)}.cover.medium.jpg"
    return None


# Fallback covers for non-Gutenberg books (Open Library cover IDs or direct URLs)
_KNOWN_COVERS: dict[str, str] = {
    "Think Python": "https://covers.openlibrary.org/b/isbn/9781491939369-M.jpg",
    "The Linux Command Line": "https://covers.openlibrary.org/b/isbn/9781593279523-M.jpg",
    "Pro Git": "https://covers.openlibrary.org/b/isbn/9781484200773-M.jpg",
    "Eloquent JavaScript": "https://covers.openlibrary.org/b/isbn/9781593279509-M.jpg",
    "Structure and Interpretation of Computer Programs": "https://covers.openlibrary.org/b/isbn/9780262510875-M.jpg",
    "Automate the Boring Stuff with Python": "https://covers.openlibrary.org/b/isbn/9781593279929-M.jpg",
    "The Making of a Manager": "https://covers.openlibrary.org/b/isbn/9780735219564-M.jpg",
    "The Lean Startup": "https://covers.openlibrary.org/b/isbn/9780307887894-M.jpg",
}


CATALOG = {
    "Fiction": [
        {"title": "Pride and Prejudice", "author": "Jane Austen", "url": "https://www.gutenberg.org/ebooks/1342", "download_url": "https://www.gutenberg.org/cache/epub/1342/pg1342-images.epub", "description": "A classic romance exploring the dynamics between Elizabeth Bennet and Mr. Darcy in Regency-era England.", "tags": ["classic", "romance"]},
        {"title": "Frankenstein", "author": "Mary Shelley", "url": "https://www.gutenberg.org/ebooks/84", "download_url": "https://www.gutenberg.org/cache/epub/84/pg84-images.epub", "description": "The original science fiction novel about a scientist who creates a sentient creature.", "tags": ["classic", "sci-fi", "horror"]},
        {"title": "The Adventures of Sherlock Holmes", "author": "Arthur Conan Doyle", "url": "https://www.gutenberg.org/ebooks/1661", "download_url": "https://www.gutenberg.org/cache/epub/1661/pg1661-images.epub", "description": "Twelve short stories featuring the brilliant detective Sherlock Holmes and his companion Dr. Watson.", "tags": ["classic", "mystery", "detective"]},
        {"title": "Alice's Adventures in Wonderland", "author": "Lewis Carroll", "url": "https://www.gutenberg.org/ebooks/11", "download_url": "https://www.gutenberg.org/cache/epub/11/pg11-images.epub", "description": "A whimsical tale of a girl who falls down a rabbit hole into a fantastical underground world.", "tags": ["classic", "fantasy", "children"]},
        {"title": "Moby Dick", "author": "Herman Melville", "url": "https://www.gutenberg.org/ebooks/2701", "download_url": "https://www.gutenberg.org/cache/epub/2701/pg2701-images.epub", "description": "The epic tale of Captain Ahab's obsessive quest to hunt the great white whale.", "tags": ["classic", "adventure"]},
        {"title": "Dracula", "author": "Bram Stoker", "url": "https://www.gutenberg.org/ebooks/345", "download_url": "https://www.gutenberg.org/cache/epub/345/pg345-images.epub", "description": "The quintessential vampire novel told through letters, diary entries, and newspaper clippings.", "tags": ["classic", "horror", "gothic"]},
        {"title": "The Great Gatsby", "author": "F. Scott Fitzgerald", "url": "https://www.gutenberg.org/ebooks/64317", "download_url": "https://www.gutenberg.org/cache/epub/64317/pg64317-images.epub", "description": "A portrait of the Jazz Age exploring wealth, idealism, and the American Dream.", "tags": ["classic", "literary"]},
    ],
    "Non-Fiction": [
        {"title": "The Art of War", "author": "Sun Tzu", "url": "https://www.gutenberg.org/ebooks/132", "download_url": "https://www.gutenberg.org/cache/epub/132/pg132-images.epub", "description": "Ancient Chinese military treatise on strategy, tactics, and the philosophy of warfare.", "tags": ["strategy", "leadership", "classic"]},
        {"title": "Meditations", "author": "Marcus Aurelius", "url": "https://www.gutenberg.org/ebooks/2680", "download_url": "https://www.gutenberg.org/cache/epub/2680/pg2680-images.epub", "description": "Personal writings of the Roman Emperor on Stoic philosophy and self-improvement.", "tags": ["philosophy", "stoicism", "self-help"]},
        {"title": "The Autobiography of Benjamin Franklin", "author": "Benjamin Franklin", "url": "https://www.gutenberg.org/ebooks/20203", "download_url": "https://www.gutenberg.org/cache/epub/20203/pg20203-images.epub", "description": "Franklin's own account of his life, from humble beginnings to becoming a Founding Father.", "tags": ["biography", "history"]},
        {"title": "Walden", "author": "Henry David Thoreau", "url": "https://www.gutenberg.org/ebooks/205", "download_url": "https://www.gutenberg.org/cache/epub/205/pg205-images.epub", "description": "Thoreau's reflections on simple living in natural surroundings near Walden Pond.", "tags": ["philosophy", "nature", "classic"]},
    ],
    "Science": [
        {"title": "On the Origin of Species", "author": "Charles Darwin", "url": "https://www.gutenberg.org/ebooks/1228", "download_url": "https://www.gutenberg.org/cache/epub/1228/pg1228-images.epub", "description": "Darwin's groundbreaking work introducing the theory of evolution by natural selection.", "tags": ["science", "biology", "classic"]},
        {"title": "Relativity: The Special and General Theory", "author": "Albert Einstein", "url": "https://www.gutenberg.org/ebooks/5001", "download_url": "https://www.gutenberg.org/cache/epub/5001/pg5001-images.epub", "description": "Einstein's accessible explanation of his revolutionary theories of relativity.", "tags": ["science", "physics"]},
        {"title": "The Descent of Man", "author": "Charles Darwin", "url": "https://www.gutenberg.org/ebooks/2300", "download_url": "https://www.gutenberg.org/cache/epub/2300/pg2300-images.epub", "description": "Darwin applies evolutionary theory to human evolution and sexual selection.", "tags": ["science", "biology", "evolution"]},
    ],
    "Programming": [
        {"title": "Think Python", "author": "Allen B. Downey", "url": "https://github.com/AllenDowney/ThinkPython2", "download_url": "https://greenteapress.com/thinkpython2/thinkpython2.pdf", "description": "An introduction to Python programming for beginners, using a think-like-a-computer-scientist approach.", "tags": ["programming", "python", "beginner"]},
        {"title": "The Linux Command Line", "author": "William Shotts", "url": "https://linuxcommand.org/tlcl.php", "download_url": "https://sourceforge.net/projects/linuxcommand/files/TLCL/19.01/TLCL-19.01.pdf/download", "description": "A complete introduction to the Linux command line, from basic navigation to shell scripting.", "tags": ["programming", "linux", "devops"]},
        {"title": "Pro Git", "author": "Scott Chacon & Ben Straub", "url": "https://github.com/progit/progit2", "download_url": "https://github.com/progit/progit2/releases/download/2.1.360/progit.pdf", "description": "The definitive guide to Git version control, from basics to advanced workflows.", "tags": ["programming", "git", "devops"]},
        {"title": "Eloquent JavaScript", "author": "Marijn Haverbeke", "url": "https://eloquentjavascript.net/", "download_url": "https://eloquentjavascript.net/Eloquent_JavaScript.pdf", "description": "A modern introduction to JavaScript programming with interactive examples.", "tags": ["programming", "javascript", "web"]},
        {"title": "Structure and Interpretation of Computer Programs", "author": "Abelson & Sussman", "url": "https://github.com/sarabander/sicp", "download_url": "https://web.mit.edu/6.001/6.037/sicp.pdf", "description": "The legendary MIT textbook on computer science fundamentals and programming principles.", "tags": ["programming", "computer-science", "classic"]},
        {"title": "Automate the Boring Stuff with Python", "author": "Al Sweigart", "url": "https://automatetheboringstuff.com/", "download_url": "https://automatetheboringstuff.com/", "description": "Practical programming for beginners, teaching Python through real-world automation tasks.", "tags": ["programming", "python", "automation"]},
    ],
    "Business": [
        {"title": "The Making of a Manager", "author": "Julie Zhuo", "url": "https://www.juliezhuo.com/book/manager.html", "download_url": None, "description": "A modern guide to management based on Julie Zhuo's experience as VP of Design at Facebook.", "tags": ["business", "leadership", "management"]},
        {"title": "The Lean Startup", "author": "Eric Ries", "url": "https://openlibrary.org/works/OL16090728W", "download_url": None, "description": "How today's entrepreneurs use continuous innovation to create radically successful businesses.", "tags": ["business", "startup", "innovation"]},
        {"title": "How to Win Friends and Influence People", "author": "Dale Carnegie", "url": "https://www.gutenberg.org/ebooks/72868", "download_url": "https://www.gutenberg.org/cache/epub/72868/pg72868-images.epub", "description": "The timeless classic on human relations, communication, and leadership skills.", "tags": ["business", "self-help", "communication"]},
    ],
    "Design": [
        {"title": "The Design of Everyday Things", "author": "Don Norman", "url": "https://openlibrary.org/works/OL2668568W", "download_url": None, "description": "A foundational text on human-centered design, exploring how everyday objects succeed or fail.", "tags": ["design", "ux", "psychology"]},
        {"title": "Don't Make Me Think", "author": "Steve Krug", "url": "https://openlibrary.org/works/OL3525625W", "download_url": None, "description": "A common-sense approach to web usability, emphasizing intuitive navigation and clear design.", "tags": ["design", "ux", "web"]},
    ],
    "Psychology": [
        {"title": "The Interpretation of Dreams", "author": "Sigmund Freud", "url": "https://www.gutenberg.org/ebooks/66082", "download_url": "https://www.gutenberg.org/cache/epub/66082/pg66082-images.epub", "description": "Freud's landmark work on dream analysis and the role of the unconscious mind.", "tags": ["psychology", "classic", "psychoanalysis"]},
        {"title": "The Crowd: A Study of the Popular Mind", "author": "Gustave Le Bon", "url": "https://www.gutenberg.org/ebooks/445", "download_url": "https://www.gutenberg.org/cache/epub/445/pg445-images.epub", "description": "A pioneering study of crowd psychology and how groups think and behave differently from individuals.", "tags": ["psychology", "sociology", "behavior"]},
    ],
    "Philosophy": [
        {"title": "Beyond Good and Evil", "author": "Friedrich Nietzsche", "url": "https://www.gutenberg.org/ebooks/4363", "download_url": "https://www.gutenberg.org/cache/epub/4363/pg4363-images.epub", "description": "Nietzsche challenges traditional morality and explores the nature of truth and values.", "tags": ["philosophy", "ethics", "classic"]},
        {"title": "The Republic", "author": "Plato", "url": "https://www.gutenberg.org/ebooks/1497", "download_url": "https://www.gutenberg.org/cache/epub/1497/pg1497-images.epub", "description": "Plato's foundational dialogue on justice, the ideal state, and the nature of the soul.", "tags": ["philosophy", "politics", "classic"]},
        {"title": "Thus Spoke Zarathustra", "author": "Friedrich Nietzsche", "url": "https://www.gutenberg.org/ebooks/1998", "download_url": "https://www.gutenberg.org/cache/epub/1998/pg1998-images.epub", "description": "A philosophical novel exploring themes of the Übermensch, eternal recurrence, and the death of God.", "tags": ["philosophy", "existentialism"]},
        {"title": "The Problems of Philosophy", "author": "Bertrand Russell", "url": "https://www.gutenberg.org/ebooks/5827", "download_url": "https://www.gutenberg.org/cache/epub/5827/pg5827-images.epub", "description": "An accessible introduction to philosophical questions about knowledge, reality, and existence.", "tags": ["philosophy", "epistemology", "beginner"]},
    ],
    "History": [
        {"title": "The History of the Peloponnesian War", "author": "Thucydides", "url": "https://www.gutenberg.org/ebooks/7142", "download_url": "https://www.gutenberg.org/cache/epub/7142/pg7142-images.epub", "description": "Ancient Greek account of the war between Athens and Sparta, a foundational work of history.", "tags": ["history", "ancient", "military"]},
        {"title": "The Prince", "author": "Niccolò Machiavelli", "url": "https://www.gutenberg.org/ebooks/1232", "download_url": "https://www.gutenberg.org/cache/epub/1232/pg1232-images.epub", "description": "A political treatise on power, statecraft, and leadership from Renaissance Italy.", "tags": ["history", "politics", "leadership"]},
        {"title": "The Decline and Fall of the Roman Empire (Vol. 1)", "author": "Edward Gibbon", "url": "https://www.gutenberg.org/ebooks/25717", "download_url": "https://www.gutenberg.org/cache/epub/25717/pg25717-images.epub", "description": "Gibbon's monumental history tracing Rome's decline from its height to the fall of Constantinople.", "tags": ["history", "ancient", "classic"]},
    ],
}

CATEGORIES = list(CATALOG.keys())


def _enrich(book: dict) -> dict:
    """Add cover_url to a curated book if missing."""
    if "cover_url" not in book:
        cover = _gutenberg_cover(book.get("url", ""))
        if not cover:
            cover = _KNOWN_COVERS.get(book.get("title", ""))
        return {**book, "cover_url": cover}
    return book


def get_all_books() -> dict:
    return {cat: [_enrich(b) for b in books] for cat, books in CATALOG.items()}


def get_books_by_category(category: str) -> list[dict]:
    books = CATALOG.get(category, [])
    return [_enrich(b) for b in books]


def search_books_local(query: str) -> list[dict]:
    """Search local catalog by individual words — any word match counts."""
    stop_words = {"the", "a", "an", "of", "in", "on", "by", "to", "and", "or", "is", "it", "for", "with", "from"}
    words = [w for w in query.lower().split() if len(w) > 1 and w not in stop_words]
    if not words:
        return []
    results = []
    for category, books in CATALOG.items():
        for book in books:
            searchable = f"{book['title']} {book['author']} {book['description']}".lower()
            matches = sum(1 for w in words if w in searchable)
            if matches > 0:
                results.append({**_enrich(book), "category": category, "source": "curated", "_score": matches})
    results.sort(key=lambda x: x["_score"], reverse=True)
    for r in results:
        del r["_score"]
    return results


async def search_open_library(query: str, limit: int = 20) -> list[dict]:
    """Search Open Library for free ebooks available to borrow or read."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(
                "https://openlibrary.org/search.json",
                params={"q": query, "limit": limit, "has_fulltext": "true"},
            )
            res.raise_for_status()
            data = res.json()

        results = []
        for doc in data.get("docs", []):
            title = doc.get("title", "")
            author = ", ".join(doc.get("author_name", [])[:2]) or "Unknown"
            key = doc.get("key", "")
            cover_id = doc.get("cover_i")
            ebook_access = doc.get("ebook_access", "")

            # Build URLs
            ol_url = f"https://openlibrary.org{key}" if key else ""
            cover_url = f"https://covers.openlibrary.org/b/id/{cover_id}-M.jpg" if cover_id else None

            # Try to find a download/read link
            ia_ids = doc.get("ia", [])
            download_url = None
            if ia_ids:
                download_url = f"https://archive.org/download/{ia_ids[0]}/{ia_ids[0]}.pdf"

            subjects = doc.get("subject", [])[:3]
            year = doc.get("first_publish_year", "")
            desc = f"Published {year}. " if year else ""
            if subjects:
                desc += f"Topics: {', '.join(subjects[:3])}."

            # Extract tags from subjects
            tags = [s.lower().replace(" ", "-") for s in subjects[:3]] if subjects else []

            results.append({
                "title": title,
                "author": author,
                "url": ol_url,
                "download_url": download_url,
                "description": desc or "Available on Open Library.",
                "cover_url": cover_url,
                "category": "Open Library",
                "source": "openlibrary",
                "ebook_access": ebook_access,
                "tags": tags,
            })
        return results
    except Exception:
        return []


async def search_gutenberg(query: str, limit: int = 10) -> list[dict]:
    """Search Project Gutenberg for free public domain ebooks."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(
                "https://gutendex.com/books/",
                params={"search": query, "page_size": limit},
            )
            res.raise_for_status()
            data = res.json()

        results = []
        for book in data.get("results", []):
            title = book.get("title", "")
            authors = [a.get("name", "") for a in book.get("authors", [])]
            author = ", ".join(authors[:2]) or "Unknown"
            book_id = book.get("id", "")
            formats = book.get("formats", {})

            # Get best download format
            download_url = (
                formats.get("application/epub+zip")
                or formats.get("application/pdf")
                or formats.get("text/plain; charset=utf-8")
                or formats.get("text/html")
            )
            cover_url = formats.get("image/jpeg")

            subjects = book.get("subjects", [])[:3]
            desc = f"Topics: {', '.join(subjects[:3])}." if subjects else "Available on Project Gutenberg."

            tags = [s.lower().replace(" ", "-") for s in subjects[:3]] if subjects else []

            results.append({
                "title": title,
                "author": author,
                "url": f"https://www.gutenberg.org/ebooks/{book_id}" if book_id else "",
                "download_url": download_url,
                "description": desc,
                "cover_url": cover_url,
                "category": "Project Gutenberg",
                "source": "gutenberg",
                "tags": tags,
            })
        return results
    except Exception:
        return []
