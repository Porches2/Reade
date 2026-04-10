"""Rich ebook catalog — curated + dynamic from Gutenberg & Open Library.
Designed to feel like Spotify for book readers."""

import re
import httpx
import asyncio
import logging
from typing import Optional

logger = logging.getLogger("catalog")


def _gutenberg_cover(url: str) -> str | None:
    m = re.search(r"gutenberg\.org/ebooks/(\d+)", url)
    if m:
        return f"https://www.gutenberg.org/cache/epub/{m.group(1)}/pg{m.group(1)}.cover.medium.jpg"
    return None


def _ol_cover(isbn: str) -> str:
    return f"https://covers.openlibrary.org/b/isbn/{isbn}-M.jpg"


def _gb(id: int, title: str, author: str, desc: str, tags: list[str]) -> dict:
    """Shorthand for Gutenberg book entry."""
    return {
        "title": title, "author": author,
        "url": f"https://www.gutenberg.org/ebooks/{id}",
        "download_url": f"https://www.gutenberg.org/cache/epub/{id}/pg{id}-images.epub",
        "description": desc, "tags": tags,
        "cover_url": f"https://www.gutenberg.org/cache/epub/{id}/pg{id}.cover.medium.jpg",
    }


# ─── Curated catalog (120+ books) ─────────────────────────────────────────────

CATALOG = {
    "Trending": [
        _gb(1342, "Pride and Prejudice", "Jane Austen", "A witty romance of manners set in Regency-era England.", ["classic", "romance"]),
        _gb(84, "Frankenstein", "Mary Shelley", "The original science fiction masterpiece about creation and consequence.", ["classic", "sci-fi", "horror"]),
        _gb(1661, "The Adventures of Sherlock Holmes", "Arthur Conan Doyle", "Twelve brilliant detective stories featuring Sherlock Holmes.", ["mystery", "detective"]),
        _gb(64317, "The Great Gatsby", "F. Scott Fitzgerald", "The definitive novel of the Jazz Age and the American Dream.", ["classic", "literary"]),
        _gb(2701, "Moby Dick", "Herman Melville", "Captain Ahab's obsessive quest for the great white whale.", ["classic", "adventure"]),
        _gb(11, "Alice's Adventures in Wonderland", "Lewis Carroll", "A girl falls down a rabbit hole into a fantastical world.", ["classic", "fantasy"]),
        _gb(1232, "The Prince", "Niccolò Machiavelli", "The foundational text on power, politics, and leadership.", ["politics", "philosophy"]),
        _gb(2680, "Meditations", "Marcus Aurelius", "A Roman Emperor's private journal on Stoic philosophy.", ["philosophy", "stoicism"]),
    ],
    "Fiction": [
        _gb(1342, "Pride and Prejudice", "Jane Austen", "A witty romance of manners set in Regency-era England.", ["classic", "romance"]),
        _gb(84, "Frankenstein", "Mary Shelley", "The original science fiction masterpiece about creation and consequence.", ["classic", "sci-fi"]),
        _gb(1661, "The Adventures of Sherlock Holmes", "Arthur Conan Doyle", "Twelve brilliant detective stories featuring Sherlock Holmes.", ["mystery", "detective"]),
        _gb(11, "Alice's Adventures in Wonderland", "Lewis Carroll", "A girl falls down a rabbit hole into a fantastical world.", ["classic", "fantasy"]),
        _gb(2701, "Moby Dick", "Herman Melville", "Captain Ahab's obsessive quest for the great white whale.", ["classic", "adventure"]),
        _gb(345, "Dracula", "Bram Stoker", "The quintessential vampire novel told through letters and diary entries.", ["classic", "horror", "gothic"]),
        _gb(64317, "The Great Gatsby", "F. Scott Fitzgerald", "A portrait of the Jazz Age exploring wealth and the American Dream.", ["classic", "literary"]),
        _gb(1260, "Jane Eyre", "Charlotte Brontë", "An orphan's journey from hardship to independence and love.", ["classic", "romance", "gothic"]),
        _gb(174, "The Picture of Dorian Gray", "Oscar Wilde", "A young man sells his soul for eternal beauty.", ["classic", "gothic", "philosophical"]),
        _gb(98, "A Tale of Two Cities", "Charles Dickens", "Love and sacrifice during the French Revolution.", ["classic", "historical"]),
        _gb(1952, "The Yellow Wallpaper", "Charlotte Perkins Gilman", "A chilling feminist short story about mental illness.", ["classic", "feminist", "horror"]),
        _gb(76, "Adventures of Huckleberry Finn", "Mark Twain", "A boy's journey down the Mississippi River.", ["classic", "adventure"]),
        _gb(5200, "Metamorphosis", "Franz Kafka", "A man wakes up one morning transformed into a giant insect.", ["classic", "existentialism"]),
        _gb(1080, "A Modest Proposal", "Jonathan Swift", "Swift's darkly satirical essay on poverty in Ireland.", ["satire", "classic"]),
        _gb(74, "The Adventures of Tom Sawyer", "Mark Twain", "A boy's adventures growing up along the Mississippi.", ["classic", "adventure"]),
        _gb(16328, "Beowulf", "Anonymous", "The oldest surviving long poem in Old English.", ["classic", "epic", "mythology"]),
        _gb(244, "A Study in Scarlet", "Arthur Conan Doyle", "The first appearance of Sherlock Holmes.", ["mystery", "detective"]),
        _gb(1400, "Great Expectations", "Charles Dickens", "A young orphan's journey to become a gentleman.", ["classic", "literary"]),
        _gb(219, "Heart of Darkness", "Joseph Conrad", "A voyage into the depths of the Congo and the human psyche.", ["classic", "literary"]),
        _gb(2591, "Grimm's Fairy Tales", "Brothers Grimm", "The classic collection of fairy tales that shaped Western storytelling.", ["classic", "fairy-tales", "fantasy"]),
        _gb(1184, "The Count of Monte Cristo", "Alexandre Dumas", "The ultimate tale of revenge, hope, and justice.", ["classic", "adventure"]),
        _gb(2554, "Crime and Punishment", "Fyodor Dostoevsky", "A young man commits murder and faces psychological torment.", ["classic", "psychological"]),
        _gb(2600, "War and Peace", "Leo Tolstoy", "An epic panorama of Russian society during the Napoleonic Wars.", ["classic", "historical", "epic"]),
        _gb(1399, "Anna Karenina", "Leo Tolstoy", "A tragic love affair in Russian high society.", ["classic", "romance"]),
        _gb(4300, "Ulysses", "James Joyce", "A single day in Dublin, retold as a modern Odyssey.", ["classic", "modernist"]),
    ],
    "Non-Fiction": [
        _gb(132, "The Art of War", "Sun Tzu", "Ancient Chinese treatise on strategy and the philosophy of warfare.", ["strategy", "leadership"]),
        _gb(2680, "Meditations", "Marcus Aurelius", "Personal writings on Stoic philosophy and self-improvement.", ["philosophy", "stoicism"]),
        _gb(20203, "The Autobiography of Benjamin Franklin", "Benjamin Franklin", "From humble beginnings to Founding Father.", ["biography", "history"]),
        _gb(205, "Walden", "Henry David Thoreau", "Reflections on simple living near Walden Pond.", ["philosophy", "nature"]),
        _gb(852, "The Communist Manifesto", "Karl Marx & Friedrich Engels", "The foundational text of communist theory.", ["politics", "economics"]),
        _gb(3300, "An Inquiry into the Nature and Causes of the Wealth of Nations", "Adam Smith", "The foundational text of modern economics.", ["economics", "classic"]),
        _gb(815, "Democracy in America (Vol. 1)", "Alexis de Tocqueville", "A Frenchman's analysis of American democracy.", ["politics", "sociology"]),
        _gb(7370, "Second Treatise of Government", "John Locke", "The philosophical basis for liberal democracy.", ["politics", "philosophy"]),
    ],
    "Science": [
        _gb(1228, "On the Origin of Species", "Charles Darwin", "The groundbreaking work on evolution by natural selection.", ["science", "biology"]),
        _gb(5001, "Relativity: The Special and General Theory", "Albert Einstein", "Einstein's accessible explanation of relativity.", ["science", "physics"]),
        _gb(2300, "The Descent of Man", "Charles Darwin", "Evolutionary theory applied to human evolution.", ["science", "biology"]),
        _gb(14725, "A Short History of Nearly Everything", "Bill Bryson", "From the Big Bang to civilization in one delightful read.", ["science", "popular-science"]),
        _gb(36, "The War of the Worlds", "H.G. Wells", "The original alien invasion story.", ["sci-fi", "classic"]),
        _gb(35, "The Time Machine", "H.G. Wells", "A scientist travels to the year 802,701.", ["sci-fi", "classic"]),
        _gb(159, "The Island of Doctor Moreau", "H.G. Wells", "A shipwrecked man discovers a mad scientist's island.", ["sci-fi", "horror"]),
        _gb(5740, "Tractatus Logico-Philosophicus", "Ludwig Wittgenstein", "A landmark work in logic and the philosophy of language.", ["philosophy", "logic"]),
    ],
    "Philosophy": [
        _gb(4363, "Beyond Good and Evil", "Friedrich Nietzsche", "A challenge to traditional morality and the nature of truth.", ["philosophy", "ethics"]),
        _gb(1497, "The Republic", "Plato", "Plato's dialogue on justice, the ideal state, and the soul.", ["philosophy", "politics"]),
        _gb(1998, "Thus Spoke Zarathustra", "Friedrich Nietzsche", "The Übermensch, eternal recurrence, and the death of God.", ["philosophy", "existentialism"]),
        _gb(5827, "The Problems of Philosophy", "Bertrand Russell", "An accessible introduction to fundamental philosophical questions.", ["philosophy", "epistemology"]),
        _gb(10616, "The Social Contract", "Jean-Jacques Rousseau", "The basis of political legitimacy and popular sovereignty.", ["philosophy", "politics"]),
        _gb(55201, "The Ethics", "Baruch Spinoza", "A geometric approach to metaphysics and ethics.", ["philosophy", "metaphysics"]),
        _gb(4280, "Critique of Pure Reason", "Immanuel Kant", "The foundational text of modern philosophy.", ["philosophy", "epistemology"]),
        _gb(1656, "On Liberty", "John Stuart Mill", "The classic defense of individual freedom.", ["philosophy", "politics"]),
    ],
    "Psychology": [
        _gb(66082, "The Interpretation of Dreams", "Sigmund Freud", "Freud's landmark work on dream analysis and the unconscious mind.", ["psychology", "psychoanalysis"]),
        _gb(445, "The Crowd: A Study of the Popular Mind", "Gustave Le Bon", "How groups think and behave differently from individuals.", ["psychology", "sociology"]),
        _gb(26328, "An Introduction to the Study of Experimental Medicine", "Claude Bernard", "The founding text of modern medical research methodology.", ["psychology", "science"]),
        _gb(15489, "The Psychology of the Unconscious", "Carl Jung", "Jung's exploration of the collective unconscious.", ["psychology", "psychoanalysis"]),
    ],
    "History": [
        _gb(7142, "The History of the Peloponnesian War", "Thucydides", "The ancient Greek account of Athens vs Sparta.", ["history", "ancient", "military"]),
        _gb(1232, "The Prince", "Niccolò Machiavelli", "A political treatise on power and statecraft from Renaissance Italy.", ["history", "politics"]),
        _gb(25717, "The Decline and Fall of the Roman Empire", "Edward Gibbon", "Tracing Rome's decline from its height to the fall.", ["history", "ancient"]),
        _gb(10000, "The Magna Carta", "Various", "The foundational document of constitutional law.", ["history", "politics", "law"]),
        _gb(3076, "The Federalist Papers", "Hamilton, Madison, Jay", "The arguments for ratifying the US Constitution.", ["history", "politics"]),
        _gb(46, "A Christmas Carol", "Charles Dickens", "Scrooge's transformation on Christmas Eve.", ["classic", "holiday"]),
    ],
    "Business & Leadership": [
        {"title": "The Making of a Manager", "author": "Julie Zhuo", "url": "https://www.juliezhuo.com/book/manager.html", "download_url": None, "description": "A modern guide to management from Facebook's VP of Design.", "tags": ["business", "leadership"], "cover_url": _ol_cover("9780735219564")},
        {"title": "The Lean Startup", "author": "Eric Ries", "url": "https://openlibrary.org/works/OL16090728W", "download_url": None, "description": "Continuous innovation for radically successful businesses.", "tags": ["business", "startup"], "cover_url": _ol_cover("9780307887894")},
        _gb(72868, "How to Win Friends and Influence People", "Dale Carnegie", "The timeless classic on communication and leadership.", ["business", "self-help"]),
        _gb(132, "The Art of War", "Sun Tzu", "Strategy and philosophy of warfare, applied to business.", ["strategy", "leadership"]),
        _gb(852, "The Communist Manifesto", "Karl Marx & Friedrich Engels", "Understanding the theory that shaped modern economics.", ["economics", "politics"]),
    ],
    "Self-Improvement": [
        _gb(2680, "Meditations", "Marcus Aurelius", "A Roman Emperor's private journal on self-mastery.", ["stoicism", "philosophy"]),
        _gb(205, "Walden", "Henry David Thoreau", "The art of simple, intentional living.", ["philosophy", "nature"]),
        _gb(5827, "The Problems of Philosophy", "Bertrand Russell", "Learn to think clearly about the deepest questions.", ["philosophy", "thinking"]),
        _gb(1656, "On Liberty", "John Stuart Mill", "The classic defense of individual freedom and autonomy.", ["philosophy", "freedom"]),
        _gb(72868, "How to Win Friends and Influence People", "Dale Carnegie", "Master the art of human relations.", ["self-help", "communication"]),
    ],
    "Programming": [
        {"title": "Think Python", "author": "Allen B. Downey", "url": "https://github.com/AllenDowney/ThinkPython2", "download_url": "https://greenteapress.com/thinkpython2/thinkpython2.pdf", "description": "Learn Python by thinking like a computer scientist.", "tags": ["programming", "python"], "cover_url": _ol_cover("9781491939369")},
        {"title": "The Linux Command Line", "author": "William Shotts", "url": "https://linuxcommand.org/tlcl.php", "download_url": "https://sourceforge.net/projects/linuxcommand/files/TLCL/19.01/TLCL-19.01.pdf/download", "description": "From basic navigation to shell scripting mastery.", "tags": ["linux", "devops"], "cover_url": _ol_cover("9781593279523")},
        {"title": "Pro Git", "author": "Scott Chacon & Ben Straub", "url": "https://github.com/progit/progit2", "download_url": "https://github.com/progit/progit2/releases/download/2.1.360/progit.pdf", "description": "The definitive guide to Git version control.", "tags": ["git", "devops"], "cover_url": _ol_cover("9781484200773")},
        {"title": "Eloquent JavaScript", "author": "Marijn Haverbeke", "url": "https://eloquentjavascript.net/", "download_url": "https://eloquentjavascript.net/Eloquent_JavaScript.pdf", "description": "A modern, interactive introduction to JavaScript.", "tags": ["javascript", "web"], "cover_url": _ol_cover("9781593279509")},
        {"title": "Structure and Interpretation of Computer Programs", "author": "Abelson & Sussman", "url": "https://github.com/sarabander/sicp", "download_url": "https://web.mit.edu/6.001/6.037/sicp.pdf", "description": "The legendary MIT textbook on CS fundamentals.", "tags": ["computer-science", "classic"], "cover_url": _ol_cover("9780262510875")},
        {"title": "Automate the Boring Stuff with Python", "author": "Al Sweigart", "url": "https://automatetheboringstuff.com/", "download_url": "https://automatetheboringstuff.com/", "description": "Practical Python for real-world automation tasks.", "tags": ["python", "automation"], "cover_url": _ol_cover("9781593279929")},
    ],
    "Poetry & Drama": [
        _gb(1112, "The Tragedy of Romeo and Juliet", "William Shakespeare", "The greatest love story ever told.", ["drama", "classic", "romance"]),
        _gb(2265, "Hamlet", "William Shakespeare", "To be, or not to be — the ultimate tragedy.", ["drama", "classic"]),
        _gb(2267, "Macbeth", "William Shakespeare", "Ambition, power, and madness in medieval Scotland.", ["drama", "classic"]),
        _gb(1727, "The Odyssey", "Homer", "Odysseus' epic journey home after the Trojan War.", ["epic", "mythology", "classic"]),
        _gb(6130, "The Iliad", "Homer", "The wrath of Achilles and the siege of Troy.", ["epic", "mythology", "classic"]),
        _gb(1065, "The Raven", "Edgar Allan Poe", "The haunting poem of loss and a mysterious raven.", ["poetry", "gothic"]),
        _gb(8800, "The Divine Comedy", "Dante Alighieri", "A journey through Hell, Purgatory, and Paradise.", ["poetry", "epic", "classic"]),
        _gb(2000, "Don Quixote", "Miguel de Cervantes", "The original novel — a knight-errant tilts at windmills.", ["classic", "satire", "adventure"]),
    ],
    "Adventure & Travel": [
        _gb(120, "Treasure Island", "Robert Louis Stevenson", "Pirates, treasure maps, and high-seas adventure.", ["adventure", "classic"]),
        _gb(45, "Anne of Green Gables", "L.M. Montgomery", "An orphan girl transforms a small town with her imagination.", ["classic", "coming-of-age"]),
        _gb(103, "Around the World in Eighty Days", "Jules Verne", "A gentleman bets he can circumnavigate the globe in 80 days.", ["adventure", "classic"]),
        _gb(164, "Twenty Thousand Leagues Under the Sea", "Jules Verne", "Captain Nemo and his submarine Nautilus.", ["adventure", "sci-fi"]),
        _gb(1184, "The Count of Monte Cristo", "Alexandre Dumas", "The ultimate revenge saga.", ["adventure", "classic"]),
        _gb(209, "The Turn of the Screw", "Henry James", "A governess suspects the children are haunted.", ["horror", "gothic", "classic"]),
        _gb(3600, "The Jungle Book", "Rudyard Kipling", "Mowgli's adventures growing up among the animals.", ["adventure", "classic"]),
        _gb(35, "The Time Machine", "H.G. Wells", "A scientist journeys to the distant future.", ["sci-fi", "adventure"]),
    ],
}

CATEGORIES = list(CATALOG.keys())


# ─── Dynamic catalog from Gutenberg API ───────────────────────────────────────

_dynamic_books: dict[str, list[dict]] = {}
_dynamic_loaded = False


async def _fetch_gutenberg_popular(topic: str, limit: int = 15) -> list[dict]:
    """Fetch popular books from Gutendex API by topic."""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.get(
                "https://gutendex.com/books/",
                params={"topic": topic, "sort": "popular", "page_size": limit, "languages": "en"},
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
            cover_url = formats.get("image/jpeg")
            download_url = (
                formats.get("application/epub+zip")
                or formats.get("application/pdf")
                or formats.get("text/plain; charset=utf-8")
            )
            subjects = book.get("subjects", [])[:3]
            tags = [s.lower().split(" -- ")[0].strip().replace(" ", "-") for s in subjects[:3]]

            results.append({
                "title": title,
                "author": author,
                "url": f"https://www.gutenberg.org/ebooks/{book_id}",
                "download_url": download_url,
                "description": f"Topics: {', '.join(subjects[:3])}." if subjects else "Available on Project Gutenberg.",
                "cover_url": cover_url,
                "tags": tags,
                "source": "gutenberg",
            })
        return results
    except Exception as e:
        logger.warning(f"Failed to fetch Gutenberg popular ({topic}): {e}")
        return []


async def _fetch_open_library_trending(subject: str, limit: int = 15) -> list[dict]:
    """Fetch trending/popular books from Open Library by subject."""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.get(
                f"https://openlibrary.org/subjects/{subject}.json",
                params={"limit": limit, "details": "false"},
            )
            res.raise_for_status()
            data = res.json()

        results = []
        for work in data.get("works", []):
            title = work.get("title", "")
            authors = work.get("authors", [])
            author = authors[0].get("name", "Unknown") if authors else "Unknown"
            key = work.get("key", "")
            cover_id = work.get("cover_id")
            cover_url = f"https://covers.openlibrary.org/b/id/{cover_id}-M.jpg" if cover_id else None

            results.append({
                "title": title,
                "author": author,
                "url": f"https://openlibrary.org{key}" if key else "",
                "download_url": None,
                "description": f"Popular in {subject.replace('_', ' ')}.",
                "cover_url": cover_url,
                "tags": [subject.replace("_", "-")],
                "source": "openlibrary",
            })
        return results
    except Exception as e:
        logger.warning(f"Failed to fetch Open Library trending ({subject}): {e}")
        return []


async def _fetch_google_books(query: str, category_label: str, limit: int = 20) -> list[dict]:
    """Fetch books from Google Books API (free, no key needed for small volume)."""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.get(
                "https://www.googleapis.com/books/v1/volumes",
                params={
                    "q": query,
                    "maxResults": min(limit, 40),
                    "printType": "books",
                    "filter": "free-ebooks",
                    "orderBy": "relevance",
                    "langRestrict": "en",
                },
            )
            res.raise_for_status()
            data = res.json()

        results = []
        for item in data.get("items", []):
            info = item.get("volumeInfo", {})
            title = info.get("title", "")
            authors = info.get("authors", ["Unknown"])
            author = ", ".join(authors[:2])
            desc = info.get("description", "")[:200]
            categories = info.get("categories", [])
            tags = [c.lower().replace(" ", "-") for c in categories[:3]]

            # Cover image
            images = info.get("imageLinks", {})
            cover_url = images.get("thumbnail") or images.get("smallThumbnail")
            if cover_url:
                cover_url = cover_url.replace("http://", "https://")

            # Download / read link
            access = item.get("accessInfo", {})
            epub_link = access.get("epub", {}).get("downloadLink")
            pdf_link = access.get("pdf", {}).get("downloadLink")
            web_reader = info.get("previewLink", "")
            download_url = epub_link or pdf_link or None

            results.append({
                "title": title,
                "author": author,
                "url": info.get("infoLink", web_reader),
                "download_url": download_url,
                "description": desc or f"Available on Google Books.",
                "cover_url": cover_url,
                "tags": tags or [category_label.lower().replace(" & ", "-").replace(" ", "-")],
                "source": "google_books",
            })
        return results
    except Exception as e:
        logger.warning(f"Failed to fetch Google Books ({query}): {e}")
        return []


async def load_dynamic_catalog():
    """Fetch popular books from external APIs to enrich the catalog. Called on startup."""
    global _dynamic_books, _dynamic_loaded

    # Gutenberg popular by topic
    gutenberg_topics = {
        "Most Downloaded": "",
        "Love & Romance": "love",
        "Science Fiction": "science fiction",
        "Mystery & Crime": "mystery",
        "Horror & Gothic": "horror",
        "Children's Literature": "children",
    }

    # Open Library subjects (reliable, no rate limit issues)
    ol_subjects = {
        "Bestsellers": "bestsellers",
        "Biographies": "biography",
        "Fantasy": "fantasy",
        "Thriller": "thriller",
        "Art & Design": "art",
        "Music": "music",
        "Cooking": "cooking",
        "Health & Wellness": "health",
        "Economics": "economics",
        "Education": "education",
        "Religion & Spirituality": "religion",
        "Nature & Environment": "nature",
        "Sports": "sports",
        "True Crime": "true_crime",
        "Humor": "humor",
    }

    # Google Books disabled for startup (429 rate limit without API key)
    # Still available for on-demand search via search_explore endpoint
    google_queries: dict[str, str] = {}

    tasks = []
    keys = []

    for label, topic in gutenberg_topics.items():
        keys.append(label)
        tasks.append(_fetch_gutenberg_popular(topic, 20))

    for label, subject in ol_subjects.items():
        keys.append(label)
        tasks.append(_fetch_open_library_trending(subject, 20))

    # Run Gutenberg + Open Library in parallel first
    results = await asyncio.gather(*tasks, return_exceptions=True)

    for key, result in zip(keys, results):
        if isinstance(result, list) and result:
            _dynamic_books[key] = result
            logger.info(f"Loaded {len(result)} books for '{key}'")

    # Run Google Books sequentially with delays to avoid 429 rate limits
    for label, query in google_queries.items():
        try:
            result = await _fetch_google_books(query, label, 20)
            if result:
                _dynamic_books[label] = result
                logger.info(f"Loaded {len(result)} books for '{label}'")
            await asyncio.sleep(3)  # Rate limit delay for Google Books
        except Exception as e:
            logger.warning(f"Google Books fetch failed for {label}: {e}")

    _dynamic_loaded = True
    total = sum(len(v) for v in _dynamic_books.values())
    logger.info(f"Dynamic catalog loaded: {total} books across {len(_dynamic_books)} categories")


# ─── Public API ────────────────────────────────────────────────────────────────

def _enrich(book: dict) -> dict:
    """Add cover_url if missing."""
    if "cover_url" not in book or book.get("cover_url") is None:
        cover = _gutenberg_cover(book.get("url", ""))
        return {**book, "cover_url": cover}
    return book


def get_all_books() -> dict:
    """Return combined curated + dynamic catalog."""
    combined = {cat: [_enrich(b) for b in books] for cat, books in CATALOG.items()}
    # Merge dynamic books (don't duplicate categories)
    for cat, books in _dynamic_books.items():
        if cat not in combined:
            combined[cat] = [_enrich(b) for b in books]
        else:
            # Dedupe by title
            existing_titles = {b["title"].lower() for b in combined[cat]}
            for b in books:
                if b["title"].lower() not in existing_titles:
                    combined[cat].append(_enrich(b))
                    existing_titles.add(b["title"].lower())
    return combined


def get_books_by_category(category: str) -> list[dict]:
    all_books = get_all_books()
    return all_books.get(category, [])


def search_books_local(query: str) -> list[dict]:
    """Search all catalogs by individual words."""
    stop_words = {"the", "a", "an", "of", "in", "on", "by", "to", "and", "or", "is", "it", "for", "with", "from"}
    words = [w for w in query.lower().split() if len(w) > 1 and w not in stop_words]
    if not words:
        return []
    results = []
    for category, books in get_all_books().items():
        for book in books:
            searchable = f"{book['title']} {book['author']} {book.get('description', '')}".lower()
            matches = sum(1 for w in words if w in searchable)
            if matches > 0:
                results.append({**_enrich(book), "category": category, "source": book.get("source", "curated"), "_score": matches})
    # Dedupe by title
    seen = set()
    deduped = []
    for r in sorted(results, key=lambda x: x["_score"], reverse=True):
        key = r["title"].lower()
        if key not in seen:
            seen.add(key)
            deduped.append(r)
    for r in deduped:
        del r["_score"]
    return deduped


async def search_open_library(query: str, limit: int = 20) -> list[dict]:
    """Search Open Library for free ebooks."""
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
            ia_ids = doc.get("ia", [])
            download_url = f"https://archive.org/download/{ia_ids[0]}/{ia_ids[0]}.pdf" if ia_ids else None
            subjects = doc.get("subject", [])[:3]
            year = doc.get("first_publish_year", "")
            desc = f"Published {year}. " if year else ""
            if subjects:
                desc += f"Topics: {', '.join(subjects[:3])}."
            tags = [s.lower().replace(" ", "-") for s in subjects[:3]] if subjects else []

            results.append({
                "title": title, "author": author,
                "url": f"https://openlibrary.org{key}" if key else "",
                "download_url": download_url,
                "description": desc or "Available on Open Library.",
                "cover_url": f"https://covers.openlibrary.org/b/id/{cover_id}-M.jpg" if cover_id else None,
                "category": "Open Library", "source": "openlibrary",
                "ebook_access": doc.get("ebook_access", ""),
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
            download_url = (
                formats.get("application/epub+zip")
                or formats.get("application/pdf")
                or formats.get("text/plain; charset=utf-8")
            )
            cover_url = formats.get("image/jpeg")
            subjects = book.get("subjects", [])[:3]
            tags = [s.lower().replace(" ", "-") for s in subjects[:3]] if subjects else []

            results.append({
                "title": title, "author": author,
                "url": f"https://www.gutenberg.org/ebooks/{book_id}" if book_id else "",
                "download_url": download_url,
                "description": f"Topics: {', '.join(subjects[:3])}." if subjects else "Available on Project Gutenberg.",
                "cover_url": cover_url,
                "category": "Project Gutenberg", "source": "gutenberg",
                "tags": tags,
            })
        return results
    except Exception:
        return []
