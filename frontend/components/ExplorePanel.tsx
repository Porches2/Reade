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

export default function ExplorePanel() {
  const [categories, setCategories] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<Record<string, Book[]>>({});
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Book[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [totalResults, setTotalResults] = useState(0);
  const [exploreLoading, setExploreLoading] = useState(true);

  useEffect(() => {
    api.getExplore()
      .then((data) => {
        setCategories(data.categories || []);
        setCatalog(data.catalog || {});
        if (data.categories?.length > 0) setActiveCategory(data.categories[0]);
      })
      .catch(() => {})
      .finally(() => setExploreLoading(false));
  }, []);

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    try {
      const data = await api.searchExplore(searchQuery);
      setSearchResults(data.results || []);
      setTotalResults(data.total || 0);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  // Get recommended books (first 6 from first category)
  const recommendedBooks = categories.length > 0 ? (catalog[categories[0]] || []).slice(0, 6) : [];

  const displayBooks = searchResults !== null
    ? searchResults
    : activeCategory
    ? catalog[activeCategory] || []
    : [];

  return (
    <div className="space-y-8">
      {/* Search */}
      <div className="flex gap-3">
        <div className="flex-1 relative">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search free ebooks (e.g. python, philosophy, fiction...)"
            className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
        <button onClick={handleSearch} disabled={searching}
          className="px-6 py-3 bg-indigo-600 text-white text-sm rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium">
          {searching ? "..." : "Search"}
        </button>
        {searchResults !== null && (
          <button onClick={() => { setSearchResults(null); setSearchQuery(""); setTotalResults(0); }}
            className="px-5 py-3 text-sm text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
            Clear
          </button>
        )}
      </div>

      {/* Search results info */}
      {searchResults !== null && (
        <p className="text-sm text-gray-600 font-medium">
          {totalResults} result{totalResults !== 1 ? "s" : ""} for &quot;{searchQuery}&quot;
        </p>
      )}

      {/* Recommended section (only when not searching) */}
      {searchResults === null && recommendedBooks.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900">Recommended</h2>
            {categories.length > 0 && (
              <button
                onClick={() => setActiveCategory(categories[0])}
                className="text-sm text-indigo-600 font-medium hover:text-indigo-700 border border-indigo-200 rounded-full px-4 py-1"
              >
                See All &rsaquo;
              </button>
            )}
          </div>
          <div className="flex gap-5 overflow-x-auto hide-scrollbar pb-2">
            {recommendedBooks.map((book, i) => (
              <a
                key={`rec-${i}`}
                href={book.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-shrink-0 w-[170px] group"
              >
                <div className="w-[170px] h-[220px] rounded-2xl overflow-hidden bg-gradient-to-br from-indigo-100 to-indigo-100 border border-gray-100 shadow-sm group-hover:shadow-md transition-shadow flex items-center justify-center">
                  {book.cover_url ? (
                    <img
                      src={book.cover_url}
                      alt={book.title}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                        (e.target as HTMLImageElement).parentElement!.innerHTML = `<div class="flex items-center justify-center w-full h-full p-4"><span class="text-sm font-semibold text-indigo-400 text-center">${book.title}</span></div>`;
                      }}
                    />
                  ) : (
                    <span className="text-sm font-semibold text-indigo-400 text-center px-4">{book.title}</span>
                  )}
                </div>
                <h3 className="mt-2.5 text-sm font-semibold text-gray-900 truncate">{book.title}</h3>
                <p className="text-xs text-gray-500 truncate">{book.author}</p>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* Categories section */}
      {searchResults === null && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900">Categories</h2>
          </div>
          <div className="flex gap-2 mb-5 overflow-x-auto hide-scrollbar pb-1">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-4 py-2 text-sm rounded-full whitespace-nowrap transition-colors font-medium border ${
                  activeCategory === cat
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Book grid */}
      {exploreLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="aspect-[3/4] rounded-2xl bg-gray-200" />
              <div className="mt-2 h-4 bg-gray-200 rounded w-3/4" />
              <div className="mt-1 h-3 bg-gray-100 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
        {displayBooks.length === 0 ? (
          <p className="col-span-full text-gray-400 text-sm text-center py-10">
            {searching ? "Searching..." : "No books found. Try a different search term."}
          </p>
        ) : (
          displayBooks.map((book, i) => (
            <a
              key={`${book.title}-${i}`}
              href={book.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group"
            >
              <div className="aspect-[3/4] rounded-2xl overflow-hidden bg-gradient-to-br from-gray-100 to-gray-50 border border-gray-100 shadow-sm group-hover:shadow-md group-hover:border-indigo-200 transition-all flex items-center justify-center">
                {book.cover_url ? (
                  <img
                    src={book.cover_url}
                    alt={book.title}
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <span className="text-xs font-semibold text-gray-400 text-center px-3">{book.title}</span>
                )}
              </div>
              <h3 className="mt-2 text-sm font-semibold text-gray-900 truncate">{book.title}</h3>
              <p className="text-xs text-gray-500 truncate">{book.author}</p>
              <div className="flex flex-wrap gap-1 mt-1">
                {book.source && (
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                    book.source === "curated" ? "bg-indigo-50 text-indigo-600" :
                    book.source === "gutenberg" ? "bg-amber-50 text-amber-600" :
                    "bg-green-50 text-green-600"
                  }`}>
                    {book.source === "curated" ? "Curated" :
                     book.source === "gutenberg" ? "Gutenberg" : "Open Library"}
                  </span>
                )}
                {book.tags?.slice(0, 2).map((tag) => (
                  <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                    {tag}
                  </span>
                ))}
              </div>
            </a>
          ))
        )}
      </div>
      )}
    </div>
  );
}
