"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";

interface Book {
  title: string;
  author: string;
  url: string;
  download_url?: string | null;
  description: string;
  category?: string;
  source?: string;
  cover_url?: string | null;
  tags?: string[];
}

interface ImportResult {
  pdf_id: string;
  filename: string;
  total_pages: number;
  thumbnail_url: string | null;
}

export default function ExplorePanel({ onImportSuccess, externalSearch }: { onImportSuccess?: (data: ImportResult) => void; externalSearch?: string }) {
  const [categories, setCategories] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<Record<string, Book[]>>({});
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Book[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [totalResults, setTotalResults] = useState(0);
  const [exploreLoading, setExploreLoading] = useState(true);
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [serverWaking, setServerWaking] = useState(false);

  useEffect(() => {
    // Show cached explore data instantly while fetching fresh data
    try {
      const cached = localStorage.getItem("reade-explore-cache");
      if (cached) {
        const data = JSON.parse(cached);
        setCategories(data.categories || []);
        setCatalog(data.catalog || {});
        if (data.categories?.length > 0) setActiveCategory(data.categories[0]);
        setExploreLoading(false);
      }
    } catch {}

    // If no cache, show "server waking up" after 3s of waiting
    const wakeTimer = setTimeout(() => setServerWaking(true), 3000);

    api.getExplore()
      .then((data) => {
        setCategories(data.categories || []);
        setCatalog(data.catalog || {});
        if (data.categories?.length > 0) setActiveCategory((prev) => prev || data.categories[0]);
        // Cache for instant load next time
        try { localStorage.setItem("reade-explore-cache", JSON.stringify(data)); } catch {}
      })
      .catch(() => {})
      .finally(() => { setExploreLoading(false); setServerWaking(false); clearTimeout(wakeTimer); });

    return () => clearTimeout(wakeTimer);
  }, []);

  // React to external search from header
  useEffect(() => {
    if (!externalSearch?.trim()) {
      setSearchResults(null);
      setSearchQuery("");
      return;
    }
    setSearchQuery(externalSearch);
    setSearching(true);
    api.searchExplore(externalSearch)
      .then((data) => {
        setSearchResults(data.results || []);
        setTotalResults(data.total || 0);
      })
      .catch(() => setSearchResults([]))
      .finally(() => setSearching(false));
  }, [externalSearch]);

  const handleImport = async (book: Book) => {
    if (!book.download_url) return;
    setImporting(true);
    setImportStatus("Downloading...");
    try {
      const result = await api.importBook({
        title: book.title,
        author: book.author,
        download_url: book.download_url,
        cover_url: book.cover_url,
        description: book.description,
        tags: book.tags || [],
      });
      setImportStatus("Added to library!");
      onImportSuccess?.(result);
      setTimeout(() => {
        setSelectedBook(null);
        setImportStatus(null);
      }, 1500);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Import failed";
      setImportStatus(`Error: ${msg}`);
    } finally {
      setImporting(false);
    }
  };

  // ─── Render helpers ───────────────────────────────────────

  const BookCard = ({ book, size = "normal" }: { book: Book; size?: "large" | "normal" }) => {
    const isLarge = size === "large";
    return (
      <button
        onClick={() => { setSelectedBook(book); setImportStatus(null); }}
        className={`${isLarge ? "flex-shrink-0 w-[171px]" : ""} group text-left`}
      >
        <div className={`${isLarge ? "w-[171px] h-[171px]" : "aspect-square"} rounded-2xl overflow-hidden bg-white/5 border border-white/5 group-hover:border-white/20 transition-all flex items-center justify-center`}>
          {book.cover_url ? (
            <img
              src={book.cover_url}
              alt={book.title}
              className="w-full h-full object-cover"
              loading="lazy"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <span className={`${isLarge ? "text-sm" : "text-xs"} font-semibold text-white/20 text-center px-3`}>{book.title}</span>
          )}
        </div>
        <h3 className={`mt-2 ${isLarge ? "text-sm" : "text-sm"} font-semibold text-white truncate`}>{book.title}</h3>
        <p className="text-xs text-white/50 truncate">{book.author}</p>
      </button>
    );
  };

  const CategorySection = ({ title, books }: { title: string; books: Book[] }) => (
    <section>
      <h2 className="text-xl font-semibold text-white mb-4">{title}</h2>
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {books.slice(0, 12).map((book, i) => (
          <BookCard key={`${book.title}-${i}`} book={book} />
        ))}
      </div>
    </section>
  );

  // Determine what to show
  const heroBooks = categories.length > 0 ? (catalog[categories[0]] || []).slice(0, 8) : [];

  return (
    <div className="space-y-10 px-2">
      {/* Category pills */}
      <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-1">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => { setActiveCategory(cat); setSearchResults(null); setSearchQuery(""); }}
            className={`px-4 py-2 text-sm rounded-full whitespace-nowrap transition-colors ${
              activeCategory === cat && !searchResults
                ? "bg-white/85 text-black font-semibold"
                : "bg-white/5 text-white/80 font-normal"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Search results */}
      {searchResults !== null ? (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <p className="text-sm text-white/60 font-medium">
              {totalResults} result{totalResults !== 1 ? "s" : ""} for &quot;{searchQuery}&quot;
            </p>
            <button onClick={() => { setSearchResults(null); setSearchQuery(""); setTotalResults(0); }}
              className="px-4 py-2 text-sm text-white/60 bg-white/5 rounded-full hover:bg-white/10 transition-colors">
              Clear
            </button>
          </div>
          {searching ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full" />
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {searchResults.map((book, i) => (
                <BookCard key={`search-${i}`} book={book} />
              ))}
            </div>
          )}
        </div>
      ) : exploreLoading ? (
        /* Loading skeleton */
        <div className="space-y-10">
          {serverWaking && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 border border-white/10">
              <div className="animate-spin w-4 h-4 border-2 border-white/20 border-t-white/60 rounded-full flex-shrink-0" />
              <p className="text-sm text-white/50">Waking up server — free tier hibernates after inactivity. Usually takes 10-20s...</p>
            </div>
          )}
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="aspect-square rounded-2xl bg-white/5" />
                <div className="mt-2 h-4 bg-white/5 rounded w-3/4" />
                <div className="mt-1 h-3 bg-white/5 rounded w-1/2" />
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* Main browse view */
        <div className="space-y-10">
          {/* Hero row for first category */}
          {heroBooks.length > 0 && activeCategory === categories[0] && (
            <section>
              <h1 className="text-[32px] font-semibold text-white tracking-wide mb-5">Discover</h1>
              <div className="flex gap-5 overflow-x-auto hide-scrollbar pb-2">
                {heroBooks.map((book, i) => (
                  <BookCard key={`hero-${i}`} book={book} size="large" />
                ))}
              </div>
            </section>
          )}

          {/* Active category content */}
          {activeCategory && catalog[activeCategory] && (
            <CategorySection
              title={activeCategory === categories[0] ? "Recently Added" : activeCategory}
              books={activeCategory === categories[0] ? (catalog[categories[0]] || []).slice(6) : (catalog[activeCategory] || [])}
            />
          )}

          {/* Browse more categories (only on first tab) */}
          {activeCategory === categories[0] && categories.slice(1, 6).map((cat) => (
            catalog[cat] && catalog[cat].length > 0 ? (
              <CategorySection key={cat} title={cat} books={catalog[cat]} />
            ) : null
          ))}
        </div>
      )}

      {/* ── Book Detail Modal ── */}
      {selectedBook && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => { setSelectedBook(null); setImportStatus(null); }}>
          <div className="bg-[#111] rounded-2xl shadow-2xl max-w-lg w-full border border-white/10 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* Cover */}
            <div className="w-full h-[240px] bg-white/5 flex items-center justify-center overflow-hidden">
              {selectedBook.cover_url ? (
                <img
                  src={selectedBook.cover_url}
                  alt={selectedBook.title}
                  className="w-full h-full object-cover"
                  loading="lazy"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              ) : (
                <span className="text-2xl font-bold text-white/10">{selectedBook.title}</span>
              )}
            </div>

            <div className="p-6 space-y-4">
              {/* Title + Author */}
              <div>
                <h2 className="text-xl font-semibold text-white">{selectedBook.title}</h2>
                <p className="text-white/50 text-sm mt-1">{selectedBook.author}</p>
              </div>

              {/* Tags */}
              {selectedBook.tags && selectedBook.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selectedBook.tags.slice(0, 5).map((tag) => (
                    <span key={tag} className="text-[10px] px-2.5 py-1 rounded-full bg-white/10 text-white/60 capitalize">
                      {tag.replace(/-/g, " ")}
                    </span>
                  ))}
                  {selectedBook.source && (
                    <span className="text-[10px] px-2.5 py-1 rounded-full bg-white/5 text-white/30 capitalize">
                      {selectedBook.source.replace(/_/g, " ")}
                    </span>
                  )}
                </div>
              )}

              {/* Description */}
              <p className="text-white/60 text-sm leading-relaxed line-clamp-4">
                {selectedBook.description}
              </p>

              {/* Import status */}
              {importStatus && (
                <p className={`text-sm font-medium ${importStatus.startsWith("Error") ? "text-red-400" : importStatus.includes("Added") ? "text-green-400" : "text-white/60"}`}>
                  {importStatus}
                </p>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                {selectedBook.download_url ? (
                  <button
                    onClick={() => handleImport(selectedBook)}
                    disabled={importing || importStatus?.includes("Added")}
                    className="flex-1 py-3 text-sm font-medium text-white bg-[#5865F2] rounded-xl hover:bg-[#4752c4] disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                  >
                    {importing ? (
                      <>
                        <div className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full" />
                        Importing...
                      </>
                    ) : importStatus?.includes("Added") ? (
                      <>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                        </svg>
                        In Library
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                        Add to Library
                      </>
                    )}
                  </button>
                ) : (
                  <a
                    href={selectedBook.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 py-3 text-sm font-medium text-white bg-[#5865F2] rounded-xl hover:bg-[#4752c4] transition-colors text-center"
                  >
                    Read Online
                  </a>
                )}
                <button
                  onClick={() => { setSelectedBook(null); setImportStatus(null); }}
                  className="px-6 py-3 text-sm font-medium text-white/60 bg-white/10 rounded-xl hover:bg-white/15 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
