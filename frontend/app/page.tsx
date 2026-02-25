"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import PdfUploader from "@/components/PdfUploader";
import ExplorePanel from "@/components/ExplorePanel";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";

interface PdfProgress {
  current_page: number;
  total_time_seconds: number;
  completed: boolean;
  last_read_at: string;
  started_at: string;
}

interface PdfAnalysis {
  book_type: string;
  tags: string[];
  chapters: { title: string; page: number }[];
  important_pages: { page: number; reason: string }[];
  chapter_source?: "bookmarks" | "heuristics" | "ai";
}

interface PdfItem {
  pdf_id: string;
  filename: string;
  total_pages: number;
  thumbnail_url: string | null;
  uploaded_at?: string;
  progress?: PdfProgress;
  analysis?: PdfAnalysis;
}

interface Voice {
  name: string;
  gender: string;
  locale: string;
}

interface WordTiming {
  word: string;
  start: number;
  end: number;
}

// Binary search for current word index
function findWordIndex(timings: WordTiming[], posMs: number): number {
  if (!timings.length) return -1;
  let lo = 0;
  let hi = timings.length - 1;
  if (posMs < timings[0].start) return -1;
  if (posMs >= timings[hi].start) return hi;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (posMs >= timings[mid].start && posMs < timings[mid].end) return mid;
    if (posMs < timings[mid].start) hi = mid - 1;
    else lo = mid + 1;
  }
  return Math.max(0, lo - 1);
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type View = "discover" | "library" | "audiobooks";

// ─── Nav icons ───────────────────────────────────────────
function IconDiscover({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5a17.916 17.916 0 0 1-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418" />
    </svg>
  );
}
function IconLibrary({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
    </svg>
  );
}
function IconAudio({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
    </svg>
  );
}
function IconLogout({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
    </svg>
  );
}

// ─── Sidebar Nav Item ────────────────────────────────────
function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
        active ? "bg-indigo-50 text-indigo-600" : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// ─── Reading Stats helpers ───────────────────────────────
function computeReadingStats(pdfs: PdfItem[]) {
  let totalSeconds = 0;
  let booksCompleted = 0;
  let pagesRead = 0;
  const readDays = new Set<string>();

  for (const pdf of pdfs) {
    if (pdf.progress) {
      totalSeconds += pdf.progress.total_time_seconds || 0;
      if (pdf.progress.completed) booksCompleted++;
      pagesRead += pdf.progress.current_page || 0;
      if (pdf.progress.last_read_at) {
        readDays.add(pdf.progress.last_read_at.slice(0, 10));
      }
    }
  }

  // Calculate streak (consecutive days ending today or yesterday)
  const today = new Date();
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (readDays.has(key)) {
      streak++;
    } else if (i > 0) {
      break;
    }
  }

  // Weekly hours
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);
  let weeklySeconds = 0;
  for (const pdf of pdfs) {
    if (pdf.progress?.last_read_at) {
      const lastRead = new Date(pdf.progress.last_read_at);
      if (lastRead >= weekAgo) {
        weeklySeconds += pdf.progress.total_time_seconds || 0;
      }
    }
  }

  return {
    streak,
    weeklyHours: Math.round((weeklySeconds / 3600) * 10) / 10,
    booksCompleted,
    pagesRead,
    totalHours: Math.round((totalSeconds / 3600) * 10) / 10,
  };
}

// ─── Main Content ────────────────────────────────────────
function HomeContent() {
  const { user, logout } = useAuth();
  const [activeView, setActiveView] = useState<View>("library");
  const [pdfs, setPdfs] = useState<PdfItem[]>([]);
  const [activePdf, setActivePdf] = useState<PdfItem | null>(null);
  const [showPdfViewer, setShowPdfViewer] = useState(false);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState("");
  const [speechRate, setSpeechRate] = useState("+0%");
  const [readPage, setReadPage] = useState(1);
  const [readPages, setReadPages] = useState(5);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [pdfSrc, setPdfSrc] = useState<string | null>(null);
  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState<PdfItem | null>(null);

  // TTS word tracking
  const [wordTimings, setWordTimings] = useState<WordTiming[]>([]);
  const [currentWordIndex, setCurrentWordIndex] = useState(-1);
  const [pagesRead, setPagesRead] = useState<number[]>([]);
  const [showReader, setShowReader] = useState(false);
  const [genProgress, setGenProgress] = useState(0);
  const readerRef = useRef<HTMLDivElement>(null);
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);

  // Player state
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);

  // Analysis state
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [activeAnalysis, setActiveAnalysis] = useState<PdfAnalysis | null>(null);

  // Favorites (localStorage)
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  // Right panel tab
  const [panelTab, setPanelTab] = useState<"info" | "chapters" | "controls">("info");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("readit-favorites");
      if (saved) setFavorites(new Set(JSON.parse(saved)));
    } catch {}
  }, []);

  const toggleFavorite = (pdfId: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(pdfId)) next.delete(pdfId);
      else next.add(pdfId);
      localStorage.setItem("readit-favorites", JSON.stringify(Array.from(next)));
      return next;
    });
  };

  // ─── Data loading ──────────────────────────────────────
  const refreshLibrary = useCallback(async () => {
    try {
      const data = await api.getLibrary();
      setPdfs(data.pdfs || []);
    } catch (e) {
      console.error("Failed to load library:", e);
    } finally {
      setLibraryLoading(false);
    }
  }, []);

  useEffect(() => { refreshLibrary(); }, [refreshLibrary]);

  useEffect(() => {
    api.getVoices()
      .then((data) => {
        if (data.voices) {
          setVoices(data.voices);
          const femaleEnUs = data.voices.find(
            (v: Voice) => v.locale.startsWith("en-US") && v.gender === "Female"
          );
          if (femaleEnUs && !selectedVoice) setSelectedVoice(femaleEnUs.name);
        }
      })
      .catch(() => {});
  }, []);

  // Load thumbnail URLs
  useEffect(() => {
    pdfs.forEach(async (pdf) => {
      if (pdf.thumbnail_url && !thumbUrls[pdf.pdf_id]) {
        const url = await api.getThumbnailUrl(pdf.pdf_id);
        setThumbUrls((prev) => ({ ...prev, [pdf.pdf_id]: url }));
      }
    });
  }, [pdfs]);

  // Load PDF viewer URL
  useEffect(() => {
    if (!activePdf) { setPdfSrc(null); return; }
    api.getPdfFileUrl(activePdf.pdf_id).then(setPdfSrc);
  }, [activePdf]);

  // Load analysis when activePdf changes
  useEffect(() => {
    if (!activePdf) { setActiveAnalysis(null); return; }
    if (activePdf.analysis) {
      setActiveAnalysis(activePdf.analysis);
      return;
    }
    setActiveAnalysis(null);
    setAnalysisLoading(true);
    api.getAnalysis(activePdf.pdf_id)
      .then((data) => {
        const analysis = data.analysis;
        setActiveAnalysis(analysis);
        // Update the pdf in state with cached analysis
        setPdfs((prev) => prev.map((p) => p.pdf_id === activePdf.pdf_id ? { ...p, analysis } : p));
      })
      .catch(() => {})
      .finally(() => setAnalysisLoading(false));
  }, [activePdf?.pdf_id]);

  // ─── Handlers ──────────────────────────────────────────
  const handleUploadSuccess = (data: { pdf_id: string; filename: string; total_pages: number; thumbnail_url: string | null }) => {
    const newPdf: PdfItem = { pdf_id: data.pdf_id, filename: data.filename, total_pages: data.total_pages, thumbnail_url: data.thumbnail_url };
    setPdfs((prev) => [...prev, newPdf]);
    setActivePdf(newPdf);
    setReadPage(1);
  };

  const handleDelete = async (pdf: PdfItem) => {
    try {
      await api.deletePdf(pdf.pdf_id);
      setPdfs((prev) => prev.filter((p) => p.pdf_id !== pdf.pdf_id));
      if (activePdf?.pdf_id === pdf.pdf_id) { setActivePdf(null); setShowPdfViewer(false); }
      setDeleteConfirm(null);
    } catch (e) {
      console.error("Failed to delete PDF:", e);
    }
  };

  const genProgressRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleRead = async () => {
    if (!activePdf) return;
    setLoading(true);
    setGenProgress(0);
    setStatus("Generating audio...");
    setCurrentWordIndex(-1);
    setWordTimings([]);
    setPagesRead([]);
    setShowReader(false);

    let prog = 0;
    genProgressRef.current = setInterval(() => {
      prog += (100 - prog) * 0.03;
      setGenProgress(Math.min(Math.round(prog), 95));
    }, 100);

    try {
      const data = await api.tts({
        pdf_id: activePdf.pdf_id,
        start_page: readPage,
        num_pages: readPages,
        voice: selectedVoice,
        rate: speechRate,
      });

      if (genProgressRef.current) clearInterval(genProgressRef.current);
      setGenProgress(100);

      const timings: WordTiming[] = data.word_timings || [];
      setWordTimings(timings);
      wordRefs.current = new Array(timings.length).fill(null);
      setPagesRead(data.pages_read || []);
      setAudioUrl(api.getAudioUrl(data.audio_url.replace("/audio/", "")));
      setStatus(`Reading pages ${(data.pages_read || []).join(", ")}`);
      setShowReader(true);

      // Save progress
      api.saveProgress(activePdf.pdf_id, {
        current_page: data.pages_read?.[data.pages_read.length - 1] || readPage,
        reading_time_seconds: 0,
      }).catch(() => {});

      if (data.has_more && data.next_page) setReadPage(data.next_page);
    } catch (e: unknown) {
      if (genProgressRef.current) clearInterval(genProgressRef.current);
      setGenProgress(0);
      setStatus(`Error: ${e instanceof Error ? e.message : "Failed"}`);
    } finally {
      setLoading(false);
      setTimeout(() => setGenProgress(0), 500);
    }
  };

  const handleStop = () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
    setAudioUrl(null);
    setStatus("");
    setWordTimings([]);
    setCurrentWordIndex(-1);
    setPagesRead([]);
    setShowReader(false);
    setIsPlaying(false);
  };

  const togglePlayPause = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
  };

  // Audio timeupdate -> track current word
  const handleTimeUpdate = useCallback(() => {
    if (!audioRef.current || !wordTimings.length) return;
    const posMs = audioRef.current.currentTime * 1000;
    const idx = findWordIndex(wordTimings, posMs);
    if (idx !== currentWordIndex) setCurrentWordIndex(idx);
    setAudioCurrentTime(audioRef.current.currentTime);
  }, [wordTimings, currentWordIndex]);

  // Auto-scroll reader to current word
  useEffect(() => {
    if (currentWordIndex < 0 || !showReader) return;
    const el = wordRefs.current[currentWordIndex];
    if (el && readerRef.current) {
      const containerRect = readerRef.current.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const midTop = containerRect.top + containerRect.height * 0.3;
      const midBot = containerRect.top + containerRect.height * 0.7;
      if (elRect.top < midTop || elRect.top > midBot) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [currentWordIndex, showReader]);

  useEffect(() => {
    if (audioUrl && audioRef.current) {
      audioRef.current.load();
      audioRef.current.play().catch(() => setStatus("Click play on the audio player below"));
    }
  }, [audioUrl]);

  // Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (deleteConfirm) setDeleteConfirm(null);
        else if (showPdfViewer) setShowPdfViewer(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleteConfirm, showPdfViewer]);

  const selectPdf = (pdf: PdfItem) => {
    setActivePdf(pdf);
    setReadPage(pdf.progress?.current_page || 1);
    setPanelTab("info");
  };

  const filteredPdfs = librarySearch
    ? pdfs.filter((p) => p.filename.toLowerCase().includes(librarySearch.toLowerCase()))
    : pdfs;

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const userInitial = user?.email?.[0]?.toUpperCase() || "U";
  const userName = user?.displayName || user?.email?.split("@")[0] || "User";

  const stats = computeReadingStats(pdfs);

  const speedRates = [
    { label: "1x", value: "+0%" },
    { label: "1.25x", value: "+25%" },
    { label: "1.5x", value: "+50%" },
    { label: "2x", value: "+100%" },
  ];

  // ─── Render ────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#F0F3F8] flex">
      {/* ── Mobile sidebar backdrop ── */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/30 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ── Sidebar ── */}
      <aside className={`w-[220px] bg-white flex flex-col flex-shrink-0 border-r border-gray-100 fixed lg:static inset-y-0 left-0 z-40 transform transition-transform duration-200 ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}>
        {/* Logo */}
        <div className="px-5 py-5 border-b border-gray-100">
          <h1 className="text-base font-bold text-gray-900 flex items-center gap-2.5">
            <span className="w-8 h-8 bg-gradient-to-br from-indigo-600 to-purple-700 rounded-lg flex items-center justify-center">
              <svg className="w-4.5 h-4.5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
              </svg>
            </span>
            Readit
          </h1>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          <NavItem icon={<IconDiscover />} label="Discover" active={activeView === "discover"} onClick={() => { setActiveView("discover"); setSidebarOpen(false); }} />
          <NavItem icon={<IconLibrary />} label="My Library" active={activeView === "library"} onClick={() => { setActiveView("library"); setSidebarOpen(false); }} />
          <NavItem icon={<IconAudio />} label="Audio Books" active={activeView === "audiobooks"} onClick={() => { setActiveView("audiobooks"); setSidebarOpen(false); }} />
        </nav>

        {/* Reading Stats */}
        {pdfs.length > 0 && (
          <div className="px-4 py-3 border-t border-gray-100">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold mb-3">Reading Stats</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-lg font-bold text-indigo-600">{stats.streak}</p>
                <p className="text-[10px] text-gray-400">Day Streak</p>
              </div>
              <div>
                <p className="text-lg font-bold text-amber-500">{stats.weeklyHours}h</p>
                <p className="text-[10px] text-gray-400">This Week</p>
              </div>
              <div>
                <p className="text-lg font-bold text-green-600">{stats.booksCompleted}</p>
                <p className="text-[10px] text-gray-400">Completed</p>
              </div>
              <div>
                <p className="text-lg font-bold text-gray-700">{stats.pagesRead}</p>
                <p className="text-[10px] text-gray-400">Pages Read</p>
              </div>
            </div>
          </div>
        )}

        {/* Bottom */}
        <div className="px-3 pb-4 space-y-1 border-t border-gray-100 pt-3">
          <NavItem icon={<IconLogout />} label="Logout" onClick={logout} />
        </div>
      </aside>

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* ── Header ── */}
        <header className="bg-white px-4 lg:px-6 py-3 flex items-center gap-3 lg:gap-4 border-b border-gray-100">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
          {activeView === "library" ? (
            <div className="flex-1 max-w-lg relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
              <input
                type="text"
                value={librarySearch}
                onChange={(e) => setLibrarySearch(e.target.value)}
                placeholder="Search your PDFs..."
                className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
          ) : (
            <div className="flex-1" />
          )}
          <div className="flex items-center gap-3 ml-auto">
            <span className="text-sm text-gray-700 font-medium hidden sm:block">{userName}</span>
            <div className="w-9 h-9 rounded-full bg-indigo-600 text-white flex items-center justify-center text-sm font-semibold flex-shrink-0">
              {userInitial}
            </div>
          </div>
        </header>

        {/* ── Content + Detail Panel ── */}
        <div className="flex-1 flex overflow-hidden">
          {/* Main content */}
          <main className="flex-1 overflow-y-auto p-6">
            {activeView === "discover" && <ExplorePanel />}
            {activeView === "library" && (
              <div>
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-bold text-gray-900">My Library</h2>
                  <div className="w-40">
                    <PdfUploader onUploadSuccess={handleUploadSuccess} />
                  </div>
                </div>

                {libraryLoading ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="animate-pulse">
                        <div className="aspect-[3/4] rounded-2xl bg-gray-200" />
                        <div className="mt-2 h-4 bg-gray-200 rounded w-3/4" />
                        <div className="mt-1 h-3 bg-gray-100 rounded w-1/2" />
                      </div>
                    ))}
                  </div>
                ) : filteredPdfs.length === 0 ? (
                  <div className="text-center py-20">
                    <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                      <IconLibrary className="w-7 h-7 text-gray-400" />
                    </div>
                    <p className="text-gray-500 text-sm mb-1">
                      {librarySearch ? "No PDFs match your search" : "Your library is empty"}
                    </p>
                    {!librarySearch && <p className="text-gray-400 text-xs">Upload a PDF to get started</p>}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
                    {filteredPdfs.map((pdf) => (
                      <div
                        key={pdf.pdf_id}
                        className={`cursor-pointer group relative ${
                          activePdf?.pdf_id === pdf.pdf_id ? "ring-2 ring-indigo-500 rounded-2xl" : ""
                        }`}
                      >
                        <div
                          onClick={() => selectPdf(pdf)}
                          className="aspect-[3/4] rounded-2xl overflow-hidden bg-gradient-to-br from-indigo-50 to-indigo-50 border border-gray-100 shadow-sm group-hover:shadow-md group-hover:border-indigo-200 transition-all flex items-center justify-center relative"
                        >
                          {thumbUrls[pdf.pdf_id] ? (
                            <img src={thumbUrls[pdf.pdf_id]} alt={pdf.filename} className="w-full h-full object-cover object-top" />
                          ) : (
                            <div className="flex flex-col items-center justify-center p-4">
                              <svg className="w-10 h-10 text-indigo-300 mb-2" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                              </svg>
                              <span className="text-xs text-indigo-400 text-center font-medium truncate w-full">{pdf.filename}</span>
                            </div>
                          )}

                          {/* Completed badge */}
                          {pdf.progress?.completed && (
                            <div className="absolute top-2 right-2 bg-green-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">Done</div>
                          )}

                          {/* Hover overlay with actions */}
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                            <button
                              onClick={(e) => { e.stopPropagation(); selectPdf(pdf); setActiveView("audiobooks"); }}
                              className="w-10 h-10 bg-white/90 rounded-full flex items-center justify-center shadow-lg hover:bg-white transition-colors"
                              title="Listen"
                            >
                              <svg className="w-4 h-4 text-indigo-600 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleFavorite(pdf.pdf_id); }}
                              className="w-10 h-10 bg-white/90 rounded-full flex items-center justify-center shadow-lg hover:bg-white transition-colors"
                              title="Favorite"
                            >
                              <svg className={`w-4 h-4 ${favorites.has(pdf.pdf_id) ? "text-amber-500 fill-amber-500" : "text-gray-500"}`} fill={favorites.has(pdf.pdf_id) ? "currentColor" : "none"} viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
                              </svg>
                            </button>
                          </div>

                          {/* Progress bar at bottom */}
                          {pdf.progress && !pdf.progress.completed && pdf.progress.current_page > 1 && (
                            <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/20">
                              <div
                                className="h-full bg-indigo-500 rounded-full"
                                style={{ width: `${Math.min(100, (pdf.progress.current_page / pdf.total_pages) * 100)}%` }}
                              />
                            </div>
                          )}
                        </div>
                        <h3 className="mt-2 text-sm font-semibold text-gray-900 truncate">{pdf.filename.replace(/\.pdf$/i, "")}</h3>
                        <p className="text-xs text-gray-500">{pdf.total_pages} pages</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeView === "audiobooks" && (
              <div>
                <h2 className="text-lg font-bold text-gray-900 mb-6">Audio Books</h2>
                {pdfs.length === 0 ? (
                  <div className="text-center py-20">
                    <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                      <IconAudio className="w-7 h-7 text-gray-400" />
                    </div>
                    <p className="text-gray-500 text-sm">Upload PDFs in My Library to listen to them</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
                    {pdfs.map((pdf) => (
                      <div
                        key={pdf.pdf_id}
                        onClick={() => selectPdf(pdf)}
                        className={`cursor-pointer group ${activePdf?.pdf_id === pdf.pdf_id ? "ring-2 ring-indigo-500 rounded-2xl" : ""}`}
                      >
                        <div className="aspect-[3/4] rounded-2xl overflow-hidden bg-gradient-to-br from-amber-50 to-orange-50 border border-gray-100 shadow-sm group-hover:shadow-md group-hover:border-amber-200 transition-all flex items-center justify-center relative">
                          {thumbUrls[pdf.pdf_id] ? (
                            <img src={thumbUrls[pdf.pdf_id]} alt={pdf.filename} className="w-full h-full object-cover object-top" />
                          ) : (
                            <div className="flex flex-col items-center justify-center p-4">
                              <IconAudio className="w-10 h-10 text-amber-300 mb-2" />
                              <span className="text-xs text-amber-400 text-center font-medium truncate w-full">{pdf.filename}</span>
                            </div>
                          )}
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                            <div className="w-12 h-12 bg-white/90 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
                              <svg className="w-5 h-5 text-amber-600 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                            </div>
                          </div>
                        </div>
                        <h3 className="mt-2 text-sm font-semibold text-gray-900 truncate">{pdf.filename.replace(/\.pdf$/i, "")}</h3>
                        <p className="text-xs text-gray-500">{pdf.total_pages} pages</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </main>

          {/* ── Right Detail Panel (Redesigned) ── */}
          {activePdf && (activeView === "library" || activeView === "audiobooks") && (
            <aside className="w-[320px] bg-white border-l border-gray-100 flex-shrink-0 overflow-y-auto">
              <div className="p-5">
                {/* Close */}
                <button onClick={() => setActivePdf(null)} className="float-right text-gray-400 hover:text-gray-600 transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>

                {/* ── Section 1: Book Info ── */}
                <div className="flex flex-col items-center mb-5">
                  <div className="w-[160px] h-[210px] rounded-2xl overflow-hidden bg-gradient-to-br from-indigo-50 to-indigo-50 border border-gray-100 shadow-md flex items-center justify-center">
                    {thumbUrls[activePdf.pdf_id] ? (
                      <img src={thumbUrls[activePdf.pdf_id]} alt={activePdf.filename} className="w-full h-full object-cover object-top" />
                    ) : (
                      <svg className="w-12 h-12 text-indigo-200" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                      </svg>
                    )}
                  </div>
                  <h3 className="text-base font-bold text-gray-900 text-center mt-3">
                    {activePdf.filename.replace(/\.pdf$/i, "")}
                  </h3>

                  {/* Tags from analysis */}
                  {activeAnalysis?.tags && activeAnalysis.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2 justify-center">
                      {activeAnalysis.book_type && activeAnalysis.book_type !== "other" && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium capitalize">
                          {activeAnalysis.book_type.replace("-", " ")}
                        </span>
                      )}
                      {activeAnalysis.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 capitalize">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  {analysisLoading && (
                    <div className="flex items-center gap-1.5 mt-2">
                      <div className="animate-spin w-3 h-3 border-2 border-indigo-200 border-t-indigo-500 rounded-full" />
                      <span className="text-[10px] text-gray-400">Analyzing...</span>
                    </div>
                  )}

                  {/* Stats row */}
                  <div className="flex items-center gap-5 mt-3 text-center">
                    <div>
                      <p className="text-sm font-bold text-gray-900">{activePdf.total_pages}</p>
                      <p className="text-[10px] text-gray-400 uppercase tracking-wide">Pages</p>
                    </div>
                    {activePdf.uploaded_at && (
                      <div>
                        <p className="text-sm font-bold text-gray-900">{new Date(activePdf.uploaded_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</p>
                        <p className="text-[10px] text-gray-400 uppercase tracking-wide">Uploaded</p>
                      </div>
                    )}
                    {activePdf.progress && (
                      <div>
                        <p className="text-sm font-bold text-gray-900">p.{activePdf.progress.current_page}</p>
                        <p className="text-[10px] text-gray-400 uppercase tracking-wide">Last Read</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Tab bar ── */}
                <div className="flex border-b border-gray-100 mb-4">
                  {(["info", "chapters", "controls"] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setPanelTab(tab)}
                      className={`flex-1 py-2 text-xs font-semibold text-center capitalize transition-colors border-b-2 ${
                        panelTab === tab ? "border-indigo-600 text-indigo-600" : "border-transparent text-gray-400 hover:text-gray-600"
                      }`}
                    >
                      {tab === "info" ? "Overview" : tab === "chapters" ? "Chapters" : "Listen"}
                    </button>
                  ))}
                </div>

                {/* ── Tab: Overview ── */}
                {panelTab === "info" && (
                  <div className="space-y-4">
                    {/* Most Important Pages */}
                    {activeAnalysis?.important_pages && activeAnalysis.important_pages.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-gray-900 uppercase tracking-wide mb-2">Most Important Pages</h4>
                        <div className="space-y-1.5">
                          {activeAnalysis.important_pages.map((ip, i) => (
                            <button
                              key={i}
                              onClick={() => { setReadPage(ip.page); setPanelTab("controls"); }}
                              className="w-full text-left flex items-start gap-2 px-3 py-2 rounded-lg hover:bg-indigo-50 transition-colors group"
                            >
                              <span className="text-xs font-bold text-indigo-600 mt-0.5 flex-shrink-0">p.{ip.page}</span>
                              <span className="text-xs text-gray-600 group-hover:text-gray-900">{ip.reason}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Quick actions */}
                    <button
                      onClick={() => setShowPdfViewer(true)}
                      className="w-full py-2.5 text-sm font-medium text-indigo-600 border border-indigo-200 rounded-xl hover:bg-indigo-50 transition-colors flex items-center justify-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                      </svg>
                      View PDF
                    </button>

                    <button
                      onClick={() => setDeleteConfirm(activePdf)}
                      className="w-full py-2 text-xs text-red-400 hover:text-red-600 transition-colors font-medium"
                    >
                      Delete PDF
                    </button>
                  </div>
                )}

                {/* ── Tab: Chapters ── */}
                {panelTab === "chapters" && (
                  <div className="space-y-4">
                    {analysisLoading ? (
                      <div className="text-center py-8">
                        <div className="animate-spin w-6 h-6 border-2 border-indigo-200 border-t-indigo-500 rounded-full mx-auto mb-2" />
                        <p className="text-xs text-gray-400">Detecting chapters...</p>
                      </div>
                    ) : activeAnalysis?.chapters && activeAnalysis.chapters.length > 0 ? (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-xs font-semibold text-gray-900 uppercase tracking-wide">Table of Contents</h4>
                          {activeAnalysis.chapter_source && (
                            <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                              activeAnalysis.chapter_source === "bookmarks" ? "bg-green-50 text-green-600" :
                              activeAnalysis.chapter_source === "heuristics" ? "bg-amber-50 text-amber-600" :
                              "bg-indigo-50 text-indigo-600"
                            }`}>
                              {activeAnalysis.chapter_source === "bookmarks" ? "From PDF" :
                               activeAnalysis.chapter_source === "heuristics" ? "Detected" : "AI-detected"}
                            </span>
                          )}
                        </div>
                        <div className="space-y-0.5">
                          {activeAnalysis.chapters.map((ch, i) => (
                            <button
                              key={i}
                              onClick={() => { setReadPage(ch.page); setPanelTab("controls"); }}
                              className="w-full text-left flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-indigo-50 transition-colors group"
                            >
                              <span className="text-sm text-gray-700 group-hover:text-gray-900 truncate pr-2">{ch.title}</span>
                              <span className="text-xs text-gray-400 flex-shrink-0">p.{ch.page}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-8">
                        <p className="text-xs text-gray-400">No chapters detected in this document.</p>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Tab: Listen (Controls) ── */}
                {panelTab === "controls" && (
                  <div className="space-y-4">
                    {/* BIG Start Listening CTA */}
                    <button
                      onClick={handleRead}
                      disabled={loading}
                      className="w-full py-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-base font-bold rounded-2xl hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 transition-all flex items-center justify-center gap-3 shadow-lg shadow-indigo-200"
                    >
                      <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                      {loading ? "Generating..." : "Start Listening"}
                    </button>

                    {status && <p className="text-xs text-gray-500 text-center">{status}</p>}

                    {/* Controls */}
                    <div className="space-y-3">
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="text-[10px] text-gray-400 uppercase tracking-wide mb-1 block">Start page</label>
                          <input
                            type="number"
                            min={1}
                            max={activePdf.total_pages}
                            value={readPage}
                            onChange={(e) => setReadPage(parseInt(e.target.value) || 1)}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="text-[10px] text-gray-400 uppercase tracking-wide mb-1 block">Pages</label>
                          <select
                            value={readPages}
                            onChange={(e) => setReadPages(parseInt(e.target.value))}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white"
                          >
                            <option value={3}>3</option>
                            <option value={5}>5</option>
                            <option value={10}>10</option>
                            <option value={20}>20</option>
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="text-[10px] text-gray-400 uppercase tracking-wide mb-1 block">Voice</label>
                        <select
                          value={selectedVoice}
                          onChange={(e) => setSelectedVoice(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white"
                        >
                          {voices.length > 0 ? voices.map((v) => (
                            <option key={v.name} value={v.name}>
                              {v.name.split(",")[0].replace("Microsoft Server Speech Text to Speech Voice (", "")} ({v.gender})
                            </option>
                          )) : <option value="">Loading voices...</option>}
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] text-gray-400 uppercase tracking-wide mb-1 block">Speed</label>
                        <div className="flex gap-1.5">
                          {speedRates.map((r) => (
                            <button
                              key={r.value}
                              onClick={() => setSpeechRate(r.value)}
                              className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors ${
                                speechRate === r.value
                                  ? "bg-indigo-600 text-white"
                                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                              }`}
                            >
                              {r.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* View PDF secondary */}
                    <button
                      onClick={() => setShowPdfViewer(true)}
                      className="w-full py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
                    >
                      View PDF
                    </button>
                  </div>
                )}
              </div>
            </aside>
          )}
        </div>
      </div>

      {/* ── Generation Progress Bar ── */}
      {loading && genProgress > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-6 py-4 shadow-lg z-40">
          <div className="flex items-center gap-3 mb-2">
            <div className="animate-spin w-5 h-5 border-2 border-indigo-200 border-t-indigo-600 rounded-full flex-shrink-0" />
            <p className="text-sm font-medium text-gray-900">Generating audio... {genProgress}%</p>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-indigo-500 rounded-full transition-all duration-300 ease-out" style={{ width: `${genProgress}%` }} />
          </div>
        </div>
      )}

      {/* ── Premium Audio Player Bar + Reader ── */}
      {audioUrl && !loading && (
        <div className="fixed bottom-0 left-0 right-0 z-40 flex flex-col" style={{ maxHeight: showReader ? "60vh" : "auto" }}>
          {/* Word reader panel */}
          {showReader && wordTimings.length > 0 && (
            <div className="bg-amber-50 border-t border-amber-200 flex-1 overflow-hidden flex flex-col" style={{ maxHeight: "calc(60vh - 80px)" }}>
              <div className="flex items-center justify-between px-5 py-2 border-b border-amber-200 bg-amber-100/50 flex-shrink-0">
                <span className="text-xs font-semibold text-amber-800">Pages {pagesRead.join(", ")}</span>
                <button onClick={() => setShowReader(false)} className="text-xs font-medium text-amber-700 hover:text-amber-900 px-2 py-1 rounded hover:bg-amber-200/50 transition-colors">
                  Minimize
                </button>
              </div>
              <div ref={readerRef} className="flex-1 overflow-y-auto px-6 py-4">
                <div className="flex flex-wrap gap-y-1 leading-relaxed">
                  {wordTimings.map((wt, i) => (
                    <span
                      key={i}
                      ref={(el) => { wordRefs.current[i] = el; }}
                      className={`text-lg transition-colors duration-100 ${
                        i === currentWordIndex
                          ? "text-gray-900 font-bold bg-amber-300 rounded px-0.5"
                          : i < currentWordIndex
                          ? "text-stone-600"
                          : "text-stone-400"
                      }`}
                    >
                      {wt.word}{" "}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Premium player controls */}
          <div className="bg-white border-t border-gray-200 px-5 py-3 shadow-lg">
            <div className="flex items-center gap-4">
              {/* Mini cover */}
              <div className="w-11 h-11 rounded-lg overflow-hidden bg-indigo-100 flex-shrink-0 flex items-center justify-center">
                {activePdf && thumbUrls[activePdf.pdf_id] ? (
                  <img src={thumbUrls[activePdf.pdf_id]} alt="" className="w-full h-full object-cover" />
                ) : (
                  <IconAudio className="w-5 h-5 text-indigo-400" />
                )}
              </div>

              {/* Title + page info */}
              <div className="min-w-0 flex-shrink-0 w-36">
                <p className="text-sm font-semibold text-gray-900 truncate">{activePdf?.filename.replace(/\.pdf$/i, "")}</p>
                <p className="text-[11px] text-gray-500">
                  {pagesRead.length > 0 ? `Pages ${pagesRead[0]}-${pagesRead[pagesRead.length - 1]}` : "Playing..."}
                </p>
              </div>

              {/* Play/Pause */}
              <button
                onClick={togglePlayPause}
                className="w-10 h-10 rounded-full bg-indigo-600 text-white flex items-center justify-center flex-shrink-0 hover:bg-indigo-700 transition-colors shadow-md"
              >
                {isPlaying ? (
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>
                ) : (
                  <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                )}
              </button>

              {/* Progress bar */}
              <div className="flex-1 flex items-center gap-2 min-w-0">
                <span className="text-[11px] text-gray-400 tabular-nums w-10 text-right flex-shrink-0">{formatTime(audioCurrentTime)}</span>
                <div
                  className="flex-1 h-1.5 bg-gray-200 rounded-full cursor-pointer relative group"
                  onClick={(e) => {
                    if (!audioRef.current || !audioDuration) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const pct = (e.clientX - rect.left) / rect.width;
                    audioRef.current.currentTime = pct * audioDuration;
                  }}
                >
                  <div
                    className="h-full bg-indigo-500 rounded-full transition-all duration-150"
                    style={{ width: audioDuration ? `${(audioCurrentTime / audioDuration) * 100}%` : "0%" }}
                  />
                </div>
                <span className="text-[11px] text-gray-400 tabular-nums w-10 flex-shrink-0">
                  {audioDuration ? `-${formatTime(audioDuration - audioCurrentTime)}` : "--:--"}
                </span>
              </div>

              {/* Speed toggle */}
              <div className="flex gap-0.5 flex-shrink-0">
                {speedRates.map((r) => (
                  <button
                    key={r.value}
                    onClick={() => {
                      setSpeechRate(r.value);
                      if (audioRef.current) {
                        const rateNum = parseFloat(r.label.replace("x", ""));
                        audioRef.current.playbackRate = rateNum;
                      }
                    }}
                    className={`px-2 py-1 text-[10px] font-medium rounded transition-colors ${
                      speechRate === r.value ? "bg-indigo-100 text-indigo-700" : "text-gray-400 hover:text-gray-600"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>

              {/* Show text / Close */}
              {!showReader && wordTimings.length > 0 && (
                <button onClick={() => setShowReader(true)}
                  className="px-3 py-1.5 text-xs bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200 transition-colors font-medium flex-shrink-0">
                  Text
                </button>
              )}
              <button onClick={handleStop}
                className="px-3 py-1.5 text-xs bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors font-medium flex-shrink-0">
                Close
              </button>
            </div>

            {/* Hidden audio element */}
            <audio
              ref={audioRef}
              src={audioUrl}
              className="hidden"
              onTimeUpdate={handleTimeUpdate}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onLoadedMetadata={() => {
                if (audioRef.current) setAudioDuration(audioRef.current.duration);
              }}
              onEnded={() => {
                setStatus("Finished. Click Start Listening for next pages.");
                setCurrentWordIndex(-1);
                setIsPlaying(false);
                // Save reading time
                if (activePdf && audioDuration) {
                  api.saveProgress(activePdf.pdf_id, {
                    current_page: pagesRead[pagesRead.length - 1] || readPage,
                    reading_time_seconds: Math.round(audioDuration),
                  }).catch(() => {});
                }
              }}
            />
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Dialog ── */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 mb-2">Delete PDF?</h3>
            <p className="text-sm text-gray-500 mb-6">
              Are you sure you want to delete &ldquo;{deleteConfirm.filename}&rdquo;? This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors">
                Cancel
              </button>
              <button onClick={() => handleDelete(deleteConfirm)} className="px-4 py-2.5 text-sm font-medium text-white bg-red-500 rounded-xl hover:bg-red-600 transition-colors">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Full-screen PDF Viewer ── */}
      {showPdfViewer && activePdf && pdfSrc && (
        <div className="fixed inset-0 bg-black/50 z-50 flex flex-col">
          <div className="bg-white px-6 py-3 flex items-center justify-between border-b">
            <div className="flex items-center gap-3">
              <button onClick={() => setShowPdfViewer(false)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                </svg>
              </button>
              <h2 className="text-sm font-semibold text-gray-900">{activePdf.filename}</h2>
            </div>
            <button onClick={() => setShowPdfViewer(false)} className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-colors font-medium">
              Close
            </button>
          </div>
          <iframe src={pdfSrc} className="flex-1 bg-gray-100" title={activePdf.filename} />
        </div>
      )}
    </div>
  );
}

export default function Home() {
  return (
    <ProtectedRoute>
      <HomeContent />
    </ProtectedRoute>
  );
}
