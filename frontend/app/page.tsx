"use client";

import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from "react";
import PdfUploader from "@/components/PdfUploader";
const ExplorePanel = lazy(() => import("@/components/ExplorePanel"));
import ProtectedRoute from "@/components/ProtectedRoute";
import { LogoIcon } from "@/components/Logo";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { thumbnailPublicUrl } from "@/lib/supabase";

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

interface AccountInfo {
  subscription: {
    tier: "free" | "pro";
    status: string;
    current_period_end?: string;
  };
  usage: {
    books: number;
    storage_mb: number;
  };
  limits: {
    books: number | null;
    storage_mb: number | null;
  };
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
/* eslint-disable @typescript-eslint/no-unused-vars */
function HomeContent() {
  const { user, logout } = useAuth();
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
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  // thumbUrls derived from pdfs — no separate state needed (see useMemo below)
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
  const [hasMore, setHasMore] = useState(false);
  const hasMoreRef = useRef(false);
  const readerRef = useRef<HTMLDivElement>(null);
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);

  // Reader font size
  const [readerFontSize, setReaderFontSize] = useState(50);

  // TTS cancel support
  const ttsAbortRef = useRef<AbortController | null>(null);

  // Player state
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);

  // Analysis state
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [activeAnalysis, setActiveAnalysis] = useState<PdfAnalysis | null>(null);

  // Favorites (localStorage)
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  // ── Killer Features ──────────────────────────────────
  // AI Chat with book
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ role: "user" | "ai"; text: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Bionic reading mode
  const [bionicMode, setBionicMode] = useState(false);

  // Sleep timer
  const [sleepTimer, setSleepTimer] = useState(0); // minutes remaining
  const [sleepTimerActive, setSleepTimerActive] = useState(false);
  const sleepIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Smart bookmarks
  const [bookmarks, setBookmarks] = useState<{ wordIndex: number; word: string; timestamp: number }[]>([]);

  // Sidebar category filter
  const [sidebarCategory, setSidebarCategory] = useState<string | null>(null);

  // Unified search (header bar → explore + library)
  const [exploreSearch, setExploreSearch] = useState("");

  // Account & subscription
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [showUpgradeHint, setShowUpgradeHint] = useState(false);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [showPricing, setShowPricing] = useState(false);

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
  // Try Supabase direct query first (fast, no backend needed).
  // Fall back to backend /library endpoint if Supabase returns empty or errors.
  const refreshLibrary = useCallback(async () => {
    if (!user) return;

    let items: PdfItem[] = [];

    try {
      const fbUser = (await import("@/lib/firebase")).auth.currentUser;
      const fbToken = fbUser ? await fbUser.getIdToken(false) : null;
      console.log("[Library] Firebase user:", fbUser?.uid, "| token available:", !!fbToken);

      // Decode JWT payload to check claims
      if (fbToken) {
        try {
          const payload = JSON.parse(atob(fbToken.split(".")[1]));
          console.log("[Library] JWT claims:", { sub: payload.sub, iss: payload.iss, aud: payload.aud, exp: new Date(payload.exp * 1000).toISOString() });
        } catch {}
      }

      // Raw fetch to Supabase REST API to bypass JS client
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
      const rawRes = await fetch(`${supabaseUrl}/rest/v1/pdfs?select=id,user_id,filename,total_pages,has_thumbnail,uploaded_at&order=uploaded_at.desc`, {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${fbToken}`,
        },
      });
      const rawData = await rawRes.json();
      console.log("[Library] Raw Supabase REST:", { status: rawRes.status, count: Array.isArray(rawData) ? rawData.length : "N/A", data: rawData });

      if (Array.isArray(rawData) && rawData.length > 0) {
        items = rawData.map((row: { id: string; user_id: string; filename: string; total_pages: number; has_thumbnail: boolean; uploaded_at: string }) => ({
          pdf_id: row.id,
          filename: row.filename,
          total_pages: row.total_pages,
          thumbnail_url: row.has_thumbnail ? thumbnailPublicUrl(row.user_id, row.id) : null,
          uploaded_at: row.uploaded_at,
        }));
      }
    } catch (e) {
      console.error("[Library] Supabase query failed:", e);
    }

    // Fallback: server-side API route (bypasses RLS with service role)
    if (items.length === 0) {
      try {
        console.log("[Library] Falling back to /api/library...");
        const fbUser = (await import("@/lib/firebase")).auth.currentUser;
        const token = fbUser ? await fbUser.getIdToken(false) : null;
        const res = await fetch("/api/library", {
          headers: token ? { "Authorization": `Bearer ${token}` } : {},
        });
        const data = await res.json();
        console.log("[Library] API route returned:", { count: data.pdfs?.length ?? 0 });
        if (data.pdfs && data.pdfs.length > 0) {
          items = data.pdfs.map((p: { pdf_id: string; filename: string; total_pages: number; thumbnail_url: string | null; uploaded_at?: string; user_id?: string }) => ({
            pdf_id: p.pdf_id,
            filename: p.filename,
            total_pages: p.total_pages,
            thumbnail_url: p.thumbnail_url,
            uploaded_at: p.uploaded_at,
          }));
        }
      } catch (e) {
        console.error("[Library] API route fallback failed:", e);
      }
    }

    console.log("[Library] Final result:", items.length, "PDFs loaded");
    setPdfs(items);
    setLibraryLoading(false);
  }, [user]);

  useEffect(() => { refreshLibrary(); }, [refreshLibrary]);

  // Load account info
  const refreshAccount = useCallback(async () => {
    try {
      const data = await api.getAccount();
      setAccount(data);
    } catch {}
  }, []);

  useEffect(() => { refreshAccount(); }, [refreshAccount]);

  // Check for ?upgraded=true in URL (post-checkout redirect)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("upgraded") === "true") {
      refreshAccount();
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [refreshAccount]);

  // Wake backend + keep alive (Render free tier hibernates after 15min idle)
  useEffect(() => {
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    const ping = () => fetch(`${backendUrl}/health`).catch(() => {});
    ping(); // immediate wake
    const interval = setInterval(ping, 5 * 60 * 1000); // every 5 min while tab is open
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // Load cached voices instantly so UI is ready before backend responds
    try {
      const cached = localStorage.getItem("reade-voices-cache");
      if (cached) {
        const voices = JSON.parse(cached);
        setVoices(voices);
        const femaleEnUs = voices.find(
          (v: Voice) => v.locale.startsWith("en-US") && v.gender === "Female"
        );
        if (femaleEnUs && !selectedVoice) setSelectedVoice(femaleEnUs.name);
      }
    } catch {}

    api.getVoices()
      .then((data) => {
        if (data.voices) {
          setVoices(data.voices);
          try { localStorage.setItem("reade-voices-cache", JSON.stringify(data.voices)); } catch {}
          const femaleEnUs = data.voices.find(
            (v: Voice) => v.locale.startsWith("en-US") && v.gender === "Female"
          );
          if (femaleEnUs && !selectedVoice) setSelectedVoice(femaleEnUs.name);
        }
      })
      .catch(() => {});
  }, []);

  // Thumbnail URLs derived from pdfs — memoized to avoid re-renders
  const thumbUrls = useMemo(() => {
    const urls: Record<string, string> = {};
    for (const pdf of pdfs) {
      if (pdf.thumbnail_url) urls[pdf.pdf_id] = pdf.thumbnail_url;
    }
    return urls;
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
        setPdfs((prev) => prev.map((p) => p.pdf_id === activePdf.pdf_id ? { ...p, analysis } : p));
      })
      .catch(() => {})
      .finally(() => setAnalysisLoading(false));
  }, [activePdf?.pdf_id]);

  // ─── Handlers ──────────────────────────────────────────
  const handleUpgrade = async () => {
    setUpgradeLoading(true);
    try {
      const { checkout_url } = await api.createCheckoutSession();
      if (checkout_url) window.location.href = checkout_url;
    } catch (e) {
      console.error("Failed to create checkout session:", e);
    } finally {
      setUpgradeLoading(false);
    }
  };

  const handleManageSubscription = async () => {
    try {
      const { portal_url } = await api.createPortalSession();
      if (portal_url) window.location.href = portal_url;
    } catch (e) {
      console.error("Failed to open portal:", e);
    }
  };

  const handleUploadSuccess = (data: { pdf_id: string; filename: string; total_pages: number; thumbnail_url: string | null }) => {
    const newPdf: PdfItem = { pdf_id: data.pdf_id, filename: data.filename, total_pages: data.total_pages, thumbnail_url: data.thumbnail_url };
    setPdfs((prev) => [...prev, newPdf]);
    setActivePdf(newPdf);
    setReadPage(1);
    refreshAccount();
  };

  const handleUploadError = (error: string) => {
    try {
      const parsed = JSON.parse(error);
      if (parsed.error === "upgrade_required") {
        setShowUpgradeHint(true);
        return;
      }
    } catch {}
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

  const handleCancelGeneration = () => {
    ttsAbortRef.current?.abort();
    ttsAbortRef.current = null;
    setLoading(false);
    setGenProgress(0);
    setStatus("");
  };

  const handleRead = async () => {
    if (!activePdf) return;
    const controller = new AbortController();
    ttsAbortRef.current = controller;
    setLoading(true);
    setTtsError(null);
    setGenProgress(5);
    setStatus("Starting audio generation...");
    setCurrentWordIndex(-1);
    setWordTimings([]);
    setPagesRead([]);
    setShowReader(false);

    try {
      let firstPagePlaying = false;

      const data = await api.tts(
        {
          pdf_id: activePdf.pdf_id,
          start_page: readPage,
          num_pages: readPages,
          voice: selectedVoice,
          rate: speechRate,
        },
        (progressStatus) => {
          setStatus(progressStatus);
          const match = progressStatus.match(/(\d+)%/);
          if (match) setGenProgress(parseInt(match[1]));
        },
        controller.signal,
        // Stream first page immediately for instant playback
        (firstPage) => {
          firstPagePlaying = true;
          const timings: WordTiming[] = firstPage.word_timings || [];
          setWordTimings(timings);
          wordRefs.current = new Array(timings.length).fill(null);
          setAudioUrl(api.getAudioUrl(firstPage.audio_url.replace("/audio/", "")));
          setShowReader(true);
          setGenProgress(30);
          setStatus("Playing — generating remaining pages...");
        }
      );

      setGenProgress(100);

      // Full audio is ready — swap to complete version
      const timings: WordTiming[] = data.word_timings || [];
      const currentTime = audioRef.current?.currentTime || 0;

      setWordTimings(timings);
      wordRefs.current = new Array(timings.length).fill(null);
      setPagesRead(data.pages_read || []);
      const fullAudioUrl = api.getAudioUrl(data.audio_url.replace("/audio/", ""));

      if (firstPagePlaying) {
        // Seamlessly swap to full audio, preserving playback position
        const wasPlaying = !audioRef.current?.paused;
        setAudioUrl(fullAudioUrl);
        // After React updates the audio src, seek to where we were
        requestAnimationFrame(() => {
          if (audioRef.current) {
            audioRef.current.currentTime = currentTime;
            if (wasPlaying) audioRef.current.play().catch(() => {});
          }
        });
      } else {
        setAudioUrl(fullAudioUrl);
        setShowReader(true);
      }

      setStatus(`Reading pages ${(data.pages_read || []).join(", ")}`);

      api.saveProgress(activePdf.pdf_id, {
        current_page: data.pages_read?.[data.pages_read.length - 1] || readPage,
        reading_time_seconds: 0,
      }).catch(() => {});

      const more = !!(data.has_more && data.next_page);
      setHasMore(more);
      hasMoreRef.current = more;
      if (data.next_page) setReadPage(data.next_page);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed";
      console.error("[TTS] Error:", msg, e);
      if (msg === "Cancelled") {
        // User cancelled — already cleaned up by handleCancelGeneration
        return;
      }
      setGenProgress(0);
      setTtsError(msg);
      setStatus(`Error: ${msg}`);
    } finally {
      ttsAbortRef.current = null;
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
    setHasMore(false);
    hasMoreRef.current = false;
    setBookmarks([]);
    setShowChat(false);
    cancelSleepTimer();
  };

  // ── AI Chat handler ──
  const handleChatSend = async () => {
    if (!chatInput.trim() || !activePdf || chatLoading) return;
    const question = chatInput.trim();
    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", text: question }]);
    setChatLoading(true);
    try {
      const data = await api.ask({ pdf_id: activePdf.pdf_id, question });
      setChatMessages((prev) => [...prev, { role: "ai", text: data.answer }]);
    } catch {
      setChatMessages((prev) => [...prev, { role: "ai", text: "Sorry, I couldn't answer that. Try again." }]);
    } finally {
      setChatLoading(false);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }
  };

  // ── Sleep Timer ──
  const startSleepTimer = (minutes: number) => {
    if (sleepIntervalRef.current) clearInterval(sleepIntervalRef.current);
    setSleepTimer(minutes);
    setSleepTimerActive(true);
    sleepIntervalRef.current = setInterval(() => {
      setSleepTimer((prev) => {
        if (prev <= 1) {
          // Time's up — pause audio
          if (audioRef.current) audioRef.current.pause();
          setSleepTimerActive(false);
          if (sleepIntervalRef.current) clearInterval(sleepIntervalRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 60000); // every minute
  };

  const cancelSleepTimer = () => {
    if (sleepIntervalRef.current) clearInterval(sleepIntervalRef.current);
    setSleepTimer(0);
    setSleepTimerActive(false);
  };

  // ── Smart Bookmark ──
  const addBookmark = () => {
    if (currentWordIndex < 0 || !wordTimings[currentWordIndex]) return;
    const wt = wordTimings[currentWordIndex];
    // Don't add duplicate nearby bookmarks
    if (bookmarks.some((b) => Math.abs(b.wordIndex - currentWordIndex) < 5)) return;
    setBookmarks((prev) => [...prev, {
      wordIndex: currentWordIndex,
      word: wordTimings.slice(Math.max(0, currentWordIndex - 2), currentWordIndex + 5).map((w) => w.word).join(" "),
      timestamp: audioCurrentTime,
    }]);
  };

  const togglePlayPause = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
  };

  const handleTimeUpdate = useCallback(() => {
    if (!audioRef.current || !wordTimings.length) return;
    const posMs = audioRef.current.currentTime * 1000;
    const idx = findWordIndex(wordTimings, posMs);
    if (idx !== currentWordIndex) setCurrentWordIndex(idx);
    setAudioCurrentTime(audioRef.current.currentTime);
  }, [wordTimings, currentWordIndex]);

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      if (e.key === "Escape") {
        if (showPricing) setShowPricing(false);
        else if (deleteConfirm) setDeleteConfirm(null);
        else if (showReader) setShowReader(false);
        else if (showPdfViewer) setShowPdfViewer(false);
      }
      // Player keyboard shortcuts (only when not typing in an input)
      if (!isInput && audioUrl && audioRef.current) {
        if (e.key === " " || e.code === "Space") {
          e.preventDefault();
          togglePlayPause();
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          audioRef.current.currentTime = Math.min(audioDuration, audioRef.current.currentTime + 10);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 10);
        } else if (e.key === "b" || e.key === "B") {
          addBookmark();
        }
      }
      // Toggle chat with 'c' when not in input
      if (!isInput && e.key === "c" && showReader) {
        setShowChat((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleteConfirm, showPdfViewer, showReader, showPricing, audioUrl, audioDuration]);

  const selectPdf = (pdf: PdfItem) => {
    setActivePdf(pdf);
    setReadPage(pdf.progress?.current_page || 1);
  };

  const filteredPdfs = useMemo(() => {
    if (librarySearch) {
      const q = librarySearch.toLowerCase();
      return pdfs.filter((p) => p.filename.toLowerCase().includes(q));
    }
    if (sidebarCategory) {
      const cat = sidebarCategory.toLowerCase();
      return pdfs.filter((p) => p.analysis?.tags?.some((t) => t.toLowerCase().includes(cat)));
    }
    return pdfs;
  }, [pdfs, librarySearch, sidebarCategory]);

  const userInitial = user?.email?.[0]?.toUpperCase() || "U";

  const stats = computeReadingStats(pdfs);

  const speedRates = [
    { label: "1x", value: "+0%" },
    { label: "1.25x", value: "+25%" },
    { label: "1.5x", value: "+50%" },
    { label: "2x", value: "+100%" },
  ];

  // Get unique tags from all PDFs for sidebar filter
  const allTags = Array.from(new Set(pdfs.flatMap((p) => p.analysis?.tags || []))).slice(0, 5);

  // Get voice display name
  const getVoiceDisplay = () => {
    const v = voices.find((v) => v.name === selectedVoice);
    if (!v) return "Loading...";
    return `${v.locale} (${v.gender})`;
  };

  // ─── Render ────────────────────────────────────────────
  return (
    <div className="h-screen bg-black flex flex-col overflow-hidden">
      {/* ── Top bar: Logo + Search + Avatar ── */}
      <header className="flex items-center justify-between px-5 h-[70px] flex-shrink-0">
        {/* Logo */}
        <div className="flex-shrink-0 w-[120px]">
          <LogoIcon className="w-[43px] h-auto text-white" />
        </div>

        {/* Search bar - centered */}
        <div className="flex-1 max-w-[545px]">
          <div className="relative">
            <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/50" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
            <input
              type="text"
              value={librarySearch}
              onChange={(e) => {
                setLibrarySearch(e.target.value);
                if (!e.target.value.trim()) setExploreSearch("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && librarySearch.trim()) {
                  setExploreSearch(librarySearch.trim());
                }
              }}
              placeholder="What book you want to read / listen?"
              className="w-full pl-12 pr-4 py-3 bg-white/5 rounded-full text-sm text-white placeholder-white/50 focus:outline-none focus:ring-1 focus:ring-white/20"
            />
          </div>
        </div>

        {/* Right: Upgrade + Avatar */}
        <div className="flex-shrink-0 w-[120px] flex justify-end items-center gap-2">
          {account?.subscription.tier !== "pro" && (
            <button
              onClick={() => setShowPricing(true)}
              className="px-3 py-1.5 text-[11px] font-medium text-white bg-white/10 rounded-full hover:bg-white/20 transition-colors"
            >
              Upgrade
            </button>
          )}
          <button onClick={logout} className="text-white/50 hover:text-white transition-colors p-2" title="Logout">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
            </svg>
          </button>
          <div className="w-11 h-11 rounded-full bg-white/10 ring-[3px] ring-white/10 flex items-center justify-center text-sm font-semibold text-white overflow-hidden">
            {userInitial}
          </div>
        </div>
      </header>

      {/* ── 3-column layout ── */}
      <div className="flex-1 flex overflow-hidden">
        {/* ── LEFT SIDEBAR: Your Books ── */}
        <aside className="w-[384px] flex-shrink-0 px-2 pb-2">
          <div className="h-full bg-white/5 rounded-2xl flex flex-col overflow-hidden">
            <div className="p-6 pb-0 space-y-5">
              {/* Header */}
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-white tracking-wide">Your books</h2>
                <PdfUploader onUploadSuccess={handleUploadSuccess} onUploadError={handleUploadError} />
              </div>

              {/* Category pills */}
              <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-1">
                {allTags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => setSidebarCategory(sidebarCategory === tag ? null : tag)}
                    className={`px-4 py-2 text-sm rounded-full whitespace-nowrap transition-colors font-normal ${
                      sidebarCategory === tag
                        ? "bg-white/85 text-black"
                        : "bg-white/5 text-white"
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            {/* Book list */}
            <div className="flex-1 overflow-y-auto px-6 pt-4 pb-4 space-y-1 stagger-children">
              {libraryLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="animate-pulse flex gap-3 p-2">
                      <div className="w-[53px] h-[53px] rounded-lg bg-white/10" />
                      <div className="flex-1 space-y-2 py-1">
                        <div className="h-4 bg-white/10 rounded w-3/4" />
                        <div className="h-3 bg-white/5 rounded w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : filteredPdfs.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-white/50 text-sm">
                    {librarySearch ? "No PDFs match your search" : "Your library is empty"}
                  </p>
                  {!librarySearch && <p className="text-white/30 text-xs mt-1">Upload a PDF to get started</p>}
                </div>
              ) : (
                filteredPdfs.map((pdf) => (
                  <button
                    key={pdf.pdf_id}
                    onClick={() => selectPdf(pdf)}
                    className={`w-full flex items-center gap-3 p-2 rounded-lg transition-all duration-200 text-left animate-fadeIn ${
                      activePdf?.pdf_id === pdf.pdf_id
                        ? "bg-white/10"
                        : "hover:bg-white/5 active:scale-[0.98]"
                    }`}
                  >
                    {/* Thumbnail */}
                    <div className="w-[53px] h-[53px] rounded-lg overflow-hidden bg-white/5 flex-shrink-0 flex items-center justify-center">
                      {thumbUrls[pdf.pdf_id] ? (
                        <img src={thumbUrls[pdf.pdf_id]} alt="" className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <svg className="w-6 h-6 text-white/20" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                        </svg>
                      )}
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-lg font-medium truncate">{pdf.filename.replace(/\.pdf$/i, "")}</p>
                      <div className="flex items-center gap-1.5 text-white/50 text-[10px]">
                        <span>{pdf.analysis?.tags?.[0] || "PDF"}</span>
                        <span className="mx-1">·</span>
                        <span>{pdf.total_pages} Pages</span>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>

            {/* Account & Plan — subtle, bottom of sidebar */}
            {account && (
              <div className="px-6 py-4 border-t border-white/5">
                {account.subscription.tier === "pro" ? (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#769BFF]/20 text-[#769BFF] font-medium">Pro</span>
                      <span className="text-white/40 text-xs">{account.usage.books} books</span>
                    </div>
                    <button
                      onClick={handleManageSubscription}
                      className="text-white/30 text-[10px] hover:text-white/60 transition-colors"
                    >
                      Manage
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-white/40 text-xs">{account.usage.books} of {account.limits.books} books</span>
                      <span className="text-white/30 text-xs">{account.usage.storage_mb} / {account.limits.storage_mb} MB</span>
                    </div>
                    <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.min(100, (account.usage.books / (account.limits.books || 1)) * 100)}%`,
                          backgroundColor: account.usage.books >= (account.limits.books || 5) ? "#f87171" : "rgba(255,255,255,0.2)",
                        }}
                      />
                    </div>
                    <button
                      onClick={() => setShowPricing(true)}
                      className="w-full py-2 text-xs text-white/50 hover:text-white/80 transition-colors"
                    >
                      Unlimited books for $5/mo →
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>

        {/* ── CENTER: Discover / Explore ── */}
        <main className="flex-1 overflow-y-auto py-2 min-w-0">
          <Suspense fallback={
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full" />
            </div>
          }>
            <ExplorePanel externalSearch={exploreSearch} onImportSuccess={(data) => {
              const newPdf: PdfItem = {
                pdf_id: data.pdf_id,
                filename: data.filename,
                total_pages: data.total_pages,
                thumbnail_url: data.thumbnail_url,
              };
              setPdfs((prev) => [...prev, newPdf]);
              setActivePdf(newPdf);
              setReadPage(1);
            }} />
          </Suspense>
        </main>

        {/* ── RIGHT PANEL: Book Detail ── */}
        {activePdf && (
          <aside className="w-[400px] flex-shrink-0 px-2 pb-2 animate-slideInRight">
            <div className="h-full bg-white/5 rounded-2xl overflow-y-auto">
              <div className="p-6 space-y-5">
                {/* Cover image */}
                <div className="w-full aspect-[3/2] rounded-lg overflow-hidden bg-white/5 flex items-center justify-center">
                  {thumbUrls[activePdf.pdf_id] ? (
                    <img src={thumbUrls[activePdf.pdf_id]} alt={activePdf.filename} className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <svg className="w-16 h-16 text-white/10" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                    </svg>
                  )}
                </div>

                {/* Title + Author */}
                <div>
                  <h3 className="text-2xl font-normal text-white leading-tight">
                    {activePdf.filename.replace(/\.pdf$/i, "")}
                  </h3>
                  <p className="text-white/50 text-xs mt-1">
                    {activePdf.total_pages} pages
                    {activePdf.uploaded_at && ` · ${new Date(activePdf.uploaded_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                  </p>
                </div>

                {/* Tags */}
                {activeAnalysis?.tags && activeAnalysis.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {activeAnalysis.book_type && activeAnalysis.book_type !== "other" && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-white/80 font-medium capitalize">
                        {activeAnalysis.book_type.replace("-", " ")}
                      </span>
                    )}
                    {activeAnalysis.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-white/50 capitalize">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* What you will get - insights */}
                {activeAnalysis?.important_pages && activeAnalysis.important_pages.length > 0 && (
                  <div className="space-y-1">
                    <h4 className="text-white/50 text-[10px] tracking-wide">What you will get</h4>
                    {activeAnalysis.important_pages.slice(0, 3).map((ip, i) => (
                      <button
                        key={i}
                        onClick={() => setReadPage(ip.page)}
                        className="w-full text-left px-3.5 py-2 rounded-[10px] bg-white/10 transition-colors hover:bg-white/15"
                      >
                        <span className="text-[#769BFF] text-xs">{ip.reason}</span>
                      </button>
                    ))}
                  </div>
                )}
                {analysisLoading && (
                  <div className="flex items-center gap-2">
                    <div className="animate-spin w-3 h-3 border-2 border-white/20 border-t-white/60 rounded-full" />
                    <span className="text-white/40 text-xs">Analyzing...</span>
                  </div>
                )}

                {/* Summary (from chapters panel) */}
                {activeAnalysis?.chapters && activeAnalysis.chapters.length > 0 && (
                  <div className="bg-white/5 rounded-2xl p-4 space-y-2">
                    <p className="text-white/50 text-[10px] tracking-wide">Summary</p>
                    <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                      {activeAnalysis.chapters.slice(0, 8).map((ch, i) => (
                        <button
                          key={i}
                          onClick={() => setReadPage(ch.page)}
                          className="w-full text-left text-white/70 text-xs hover:text-white transition-colors flex justify-between items-baseline gap-2"
                        >
                          <span className="truncate">{ch.title}</span>
                          <span className="text-white/30 text-[10px] flex-shrink-0">p.{ch.page}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowPdfViewer(true)}
                    className="flex-1 py-2.5 text-sm font-medium text-white/80 bg-white/10 rounded-xl hover:bg-white/15 transition-colors"
                  >
                    View PDF
                  </button>
                  <button
                    onClick={() => { setShowChat(true); setShowReader(true); }}
                    className="flex-1 py-2.5 text-sm font-medium text-white/80 bg-white/10 rounded-xl hover:bg-white/15 transition-colors flex items-center justify-center gap-1.5"
                    title="Ask AI about this book"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
                    </svg>
                    Ask AI
                  </button>
                </div>

                <button
                  onClick={() => setDeleteConfirm(activePdf)}
                  className="w-full py-2 text-xs text-red-400/60 hover:text-red-400 transition-colors font-medium"
                >
                  Delete PDF
                </button>
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* ── Full-screen Reading View ── */}
      {showReader && ((wordTimings.length > 0 && audioUrl) || showChat) && !loading && activePdf && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col animate-slideUp">
          {/* Top controls bar */}
          <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-10 pt-6 pb-16 bg-gradient-to-b from-black via-black/80 to-transparent animate-slideDown">
            {/* Left: page info */}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg overflow-hidden bg-white/10 flex-shrink-0">
                {thumbUrls[activePdf.pdf_id] && (
                  <img src={thumbUrls[activePdf.pdf_id]} alt="" className="w-full h-full object-cover" />
                )}
              </div>
              <div>
                <p className="text-white/60 text-xs font-medium truncate max-w-[200px]">{activePdf.filename.replace(/\.pdf$/i, "")}</p>
                <p className="text-white/30 text-[10px]">
                  {pagesRead.length > 0 ? `Pages ${pagesRead[0]}–${pagesRead[pagesRead.length - 1]}` : `Page ${readPage}`}
                  {audioDuration > 0 && ` · ${formatTime(audioDuration - audioCurrentTime)} left`}
                </p>
              </div>
            </div>

            {/* Center: reading progress bar */}
            <div className="flex-1 max-w-[400px] mx-8">
              <div className="h-[2px] bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-white/40 rounded-full transition-all duration-300"
                  style={{ width: audioDuration ? `${(audioCurrentTime / audioDuration) * 100}%` : "0%" }}
                />
              </div>
            </div>

            {/* Right: features + text size + minimize */}
            <div className="flex items-center gap-2">
              {/* Bionic reading toggle */}
              <button
                onClick={() => setBionicMode((b) => !b)}
                className={`px-3 py-1.5 text-xs font-medium rounded-full transition-all ${
                  bionicMode ? "bg-white text-black" : "bg-white/10 text-white/60 hover:bg-white/20"
                }`}
                title="Bionic reading mode"
              >
                <span className="font-bold">Bio</span>nic
              </button>

              {/* Bookmark button */}
              <button
                onClick={addBookmark}
                className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/20 transition-all active:scale-90"
                title="Bookmark this moment"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" />
                </svg>
              </button>

              {/* Sleep timer */}
              <div className="relative group">
                <button
                  className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${
                    sleepTimerActive ? "bg-white/20 text-white" : "bg-white/10 text-white/60 hover:text-white hover:bg-white/20"
                  }`}
                  title="Sleep timer"
                >
                  {sleepTimerActive ? (
                    <span className="text-[10px] font-bold tabular-nums">{sleepTimer}</span>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" />
                    </svg>
                  )}
                </button>
                {/* Dropdown */}
                <div className="absolute top-full right-0 mt-2 w-36 bg-[#1a1a1a] border border-white/10 rounded-xl overflow-hidden shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-20">
                  {sleepTimerActive ? (
                    <button
                      onClick={cancelSleepTimer}
                      className="w-full px-4 py-2.5 text-left text-xs text-red-400 hover:bg-white/5 transition-colors"
                    >
                      Cancel timer ({sleepTimer}m left)
                    </button>
                  ) : (
                    [15, 30, 45, 60].map((m) => (
                      <button
                        key={m}
                        onClick={() => startSleepTimer(m)}
                        className="w-full px-4 py-2.5 text-left text-xs text-white/70 hover:bg-white/10 hover:text-white transition-colors"
                      >
                        {m} minutes
                      </button>
                    ))
                  )}
                </div>
              </div>

              {/* AI Chat toggle */}
              <button
                onClick={() => setShowChat((c) => !c)}
                className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${
                  showChat ? "bg-white text-black" : "bg-white/10 text-white/60 hover:text-white hover:bg-white/20"
                }`}
                title="Ask AI about this book"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
                </svg>
              </button>

              {/* Divider */}
              <div className="w-px h-5 bg-white/10" />

              {/* Text size controls */}
              <div className="flex items-center gap-1 bg-white/10 rounded-full px-1 py-1">
                <button
                  onClick={() => setReaderFontSize((s) => Math.max(24, s - 4))}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors text-lg font-medium"
                  title="Smaller text"
                >
                  −
                </button>
                <span className="text-white/50 text-xs tabular-nums w-8 text-center">{readerFontSize}</span>
                <button
                  onClick={() => setReaderFontSize((s) => Math.min(80, s + 4))}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors text-lg font-medium"
                  title="Larger text"
                >
                  +
                </button>
              </div>

              <button
                onClick={() => setShowReader(false)}
                className="text-white/60 hover:text-white transition-colors p-1"
                title="Minimize"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9 3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5 5.25 5.25" />
                </svg>
              </button>
            </div>
          </div>

          {/* Bottom fade gradient */}
          <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-black to-transparent z-[5] pointer-events-none" />

          {/* Reading text area */}
          <div ref={readerRef} className={`flex-1 overflow-y-auto px-16 pt-28 pb-[140px] transition-all ${showChat ? "mr-[380px]" : ""}`}>
            <div className="max-w-[1315px] mx-auto">
              <div className="leading-[1.3]">
                {wordTimings.map((wt, i) => {
                  const colorClass = i === currentWordIndex
                    ? "text-white"
                    : i < currentWordIndex
                    ? "text-white/70"
                    : "text-white/15";
                  const isBookmarked = bookmarks.some((b) => Math.abs(b.wordIndex - i) < 2);
                  const bionicSplit = bionicMode ? Math.ceil(wt.word.length / 2) : 0;
                  return (
                    <span
                      key={i}
                      ref={(el) => { wordRefs.current[i] = el; }}
                      className={`transition-colors duration-200 ${colorClass} ${isBookmarked ? "underline decoration-white/30 underline-offset-4" : ""}`}
                      style={{ fontSize: `${readerFontSize}px`, letterSpacing: "0.22px" }}
                    >
                      {bionicMode ? (
                        <><span className="font-bold">{wt.word.slice(0, bionicSplit)}</span><span className="font-normal">{wt.word.slice(bionicSplit)}</span></>
                      ) : (
                        <span className="font-normal">{wt.word}</span>
                      )}{" "}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── AI Chat Panel (right drawer) ── */}
          {showChat && (
            <div className="absolute top-0 right-0 bottom-0 w-[380px] bg-[#0a0a0a] border-l border-white/10 z-20 flex flex-col animate-slideInRight">
              {/* Chat header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center">
                    <svg className="w-3.5 h-3.5 text-white/70" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456Z" />
                    </svg>
                  </div>
                  <span className="text-sm font-medium text-white">Ask about this book</span>
                </div>
                <button onClick={() => setShowChat(false)} className="text-white/40 hover:text-white transition-colors p-1">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Chat messages */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                {chatMessages.length === 0 && (
                  <div className="text-center py-12 space-y-3">
                    <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mx-auto">
                      <svg className="w-6 h-6 text-white/20" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456Z" />
                      </svg>
                    </div>
                    <p className="text-white/30 text-xs">Ask anything about this book</p>
                    <div className="space-y-1.5">
                      {["What are the key takeaways?", "Summarize this section", "Explain the main argument"].map((q) => (
                        <button
                          key={q}
                          onClick={() => { setChatInput(q); }}
                          className="block w-full text-left px-3 py-2 text-xs text-white/50 bg-white/5 rounded-lg hover:bg-white/10 hover:text-white/70 transition-colors"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {chatMessages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                      msg.role === "user"
                        ? "bg-white text-black rounded-br-md"
                        : "bg-white/10 text-white/80 rounded-bl-md"
                    }`}>
                      {msg.text}
                    </div>
                  </div>
                ))}
                {chatLoading && (
                  <div className="flex justify-start">
                    <div className="bg-white/10 rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-white/40 animate-pulse" />
                      <div className="w-1.5 h-1.5 rounded-full bg-white/40 animate-pulse" style={{ animationDelay: "0.2s" }} />
                      <div className="w-1.5 h-1.5 rounded-full bg-white/40 animate-pulse" style={{ animationDelay: "0.4s" }} />
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Chat input */}
              <div className="px-4 py-3 border-t border-white/5">
                <div className="flex items-center gap-2 bg-white/5 rounded-xl px-4 py-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleChatSend(); }}
                    placeholder="Ask a question..."
                    className="flex-1 bg-transparent text-sm text-white placeholder-white/30 outline-none"
                    disabled={chatLoading}
                  />
                  <button
                    onClick={handleChatSend}
                    disabled={!chatInput.trim() || chatLoading}
                    className="w-7 h-7 rounded-full bg-white flex items-center justify-center flex-shrink-0 disabled:opacity-30 disabled:cursor-not-allowed transition-opacity"
                  >
                    <svg className="w-3.5 h-3.5 text-black" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Bookmarks Drawer (left side, slides in when bookmarks exist) ── */}
          {bookmarks.length > 0 && (
            <div className="absolute top-20 left-6 z-20 w-[260px] animate-fadeIn">
              <div className="bg-[#111]/95 backdrop-blur-sm border border-white/10 rounded-xl overflow-hidden shadow-2xl">
                <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
                  <span className="text-xs font-medium text-white/70">Bookmarks ({bookmarks.length})</span>
                  <button
                    onClick={() => setBookmarks([])}
                    className="text-white/30 hover:text-white/60 text-[10px] transition-colors"
                  >
                    Clear all
                  </button>
                </div>
                <div className="max-h-[300px] overflow-y-auto">
                  {bookmarks.map((bm, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        if (audioRef.current) {
                          audioRef.current.currentTime = bm.timestamp;
                        }
                      }}
                      className="w-full text-left px-4 py-2.5 hover:bg-white/5 transition-colors border-b border-white/5 last:border-0"
                    >
                      <p className="text-white/70 text-xs truncate">&ldquo;{bm.word}&rdquo;</p>
                      <p className="text-white/30 text-[10px] mt-0.5">{formatTime(bm.timestamp)}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Upgrade hint — appears when free tier limit is hit ── */}
      {showUpgradeHint && (
        <div className="fixed bottom-[100px] left-1/2 -translate-x-1/2 z-[61] max-w-md w-full px-4 animate-scaleIn">
          <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1.5">
                <p className="text-sm text-white font-medium">You&apos;ve filled your free library</p>
                <p className="text-xs text-white/50 leading-relaxed">
                  Pro gives you unlimited books and storage for $5/mo. Cancel anytime.
                </p>
              </div>
              <button onClick={() => setShowUpgradeHint(false)} className="text-white/30 hover:text-white/60 transition-colors p-1 -mt-1 -mr-1">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setShowUpgradeHint(false)}
                className="flex-1 py-2 text-xs text-white/50 bg-white/5 rounded-xl hover:bg-white/10 transition-colors"
              >
                Not now
              </button>
              <button
                onClick={() => { setShowUpgradeHint(false); setShowPricing(true); }}
                className="flex-1 py-2 text-xs text-white font-medium bg-white/15 rounded-xl hover:bg-white/20 transition-colors"
              >
                Upgrade to Pro
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bottom Bar — always visible when a book is selected ── */}
      {activePdf && (
        <div className="fixed bottom-0 left-0 right-0 z-[60] flex flex-col">

          {/* Player bar */}
          <div className="bg-black border-t border-white/10 px-5 h-[92px] flex items-center">
            <div className="flex items-center gap-4 w-full">
              {/* Mini cover */}
              <div className="w-[53px] h-[53px] rounded-xl overflow-hidden bg-white/5 flex-shrink-0 flex items-center justify-center">
                {thumbUrls[activePdf.pdf_id] ? (
                  <img src={thumbUrls[activePdf.pdf_id]} alt="" className="w-full h-full object-cover" />
                ) : (
                  <svg className="w-5 h-5 text-white/20" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                  </svg>
                )}
              </div>

              {/* Title + author + equalizer */}
              <div className="min-w-0 w-24 flex-shrink-0">
                <div className="flex items-center gap-2">
                  <p className="text-lg font-medium text-white truncate">{activePdf.filename.replace(/\.pdf$/i, "")}</p>
                  {isPlaying && (
                    <div className="flex items-end gap-[2px] h-3 flex-shrink-0">
                      <div className="equalizer-bar" />
                      <div className="equalizer-bar" />
                      <div className="equalizer-bar" />
                    </div>
                  )}
                </div>
                <p className="text-white/50 text-[10px]">
                  {activePdf.total_pages} pages
                </p>
              </div>

              {/* TTS error banner */}
              {ttsError && !loading && (
                <div className="w-full px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2 mb-2">
                  <span className="text-red-400 text-xs flex-1">Failed: {ttsError}</span>
                  <button onClick={() => setTtsError(null)} className="text-red-400/60 hover:text-red-400 text-xs">dismiss</button>
                </div>
              )}

              {/* ── STATE 1: Page selection (no audio, not loading) ── */}
              {!audioUrl && !loading && (
                <div className="flex-1 flex items-center justify-center gap-4">
                  {/* Start page */}
                  <div className="flex items-center gap-2">
                    <label className="text-white/50 text-xs">From</label>
                    <select
                      value={readPage}
                      onChange={(e) => setReadPage(Number(e.target.value))}
                      className="bg-white/10 text-white text-sm rounded-lg px-3 py-1.5 border-none outline-none cursor-pointer appearance-none min-w-[60px] text-center"
                    >
                      {Array.from({ length: activePdf.total_pages }, (_, i) => i + 1).map((p) => (
                        <option key={p} value={p} className="bg-black text-white">
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>

                  <span className="text-white/20 text-xs">→</span>

                  {/* End page (derived from readPage + readPages) */}
                  <div className="flex items-center gap-2">
                    <label className="text-white/50 text-xs">To</label>
                    <select
                      value={Math.min(readPage + readPages - 1, activePdf.total_pages)}
                      onChange={(e) => setReadPages(Math.max(1, Number(e.target.value) - readPage + 1))}
                      className="bg-white/10 text-white text-sm rounded-lg px-3 py-1.5 border-none outline-none cursor-pointer appearance-none min-w-[60px] text-center"
                    >
                      {Array.from(
                        { length: activePdf.total_pages - readPage + 1 },
                        (_, i) => readPage + i
                      ).map((p) => (
                        <option key={p} value={p} className="bg-black text-white">
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>

                  <span className="text-white/30 text-xs">
                    ({Math.min(readPages, activePdf.total_pages - readPage + 1)} {Math.min(readPages, activePdf.total_pages - readPage + 1) === 1 ? "page" : "pages"})
                  </span>

                  <button
                    onClick={handleRead}
                    className="ml-2 px-5 py-2 text-sm font-medium text-black bg-white rounded-full hover:bg-white/90 active:scale-95 transition-all flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    Listen
                  </button>
                </div>
              )}

              {/* ── STATE 2: Generating (loading) ── */}
              {loading && (
                <div className="flex-1 flex flex-col items-center justify-center gap-2 px-8 animate-fadeIn">
                  <div className="flex items-center gap-3 w-full max-w-md">
                    <div className="animate-spin w-4 h-4 border-2 border-white/20 border-t-white/60 rounded-full flex-shrink-0" />
                    <span className="text-sm text-white font-medium">{status || "Generating..."}</span>
                    <span className="text-white/50 text-xs ml-auto tabular-nums">{genProgress}%</span>
                    <button
                      onClick={handleCancelGeneration}
                      className="ml-2 px-3 py-1 text-xs font-medium text-white/70 bg-white/10 rounded-full hover:bg-white/20 hover:text-white transition-all active:scale-95 flex-shrink-0"
                    >
                      Cancel
                    </button>
                  </div>
                  <div className="w-full max-w-md h-1 bg-white/10 rounded-full overflow-hidden relative">
                    <div className="h-full bg-white rounded-full transition-all duration-500 ease-out" style={{ width: `${genProgress}%` }} />
                    {genProgress < 100 && <div className="absolute inset-0 shimmer-bar rounded-full" />}
                  </div>
                </div>
              )}

              {/* ── STATE 3: Playing (audio ready) ── */}
              {audioUrl && !loading && (
                <>
                  {/* Play/Pause button */}
                  <button
                    onClick={togglePlayPause}
                    className="w-9 h-9 rounded-full bg-white text-black flex items-center justify-center flex-shrink-0 hover:bg-white/90 active:scale-90 transition-all"
                  >
                    {isPlaying ? (
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>
                    ) : (
                      <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    )}
                  </button>

                  {/* Current page info */}
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="bg-white/10 rounded-lg px-3 py-1.5 text-center">
                      <p className="text-white/40 text-[9px] leading-tight">Page</p>
                      <p className="text-white text-sm font-medium leading-tight">
                        {pagesRead.length > 0 ? `${pagesRead[0]}–${pagesRead[pagesRead.length - 1]}` : readPage}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-white/40 text-[9px] leading-tight">of</p>
                      <p className="text-white/60 text-sm leading-tight">{activePdf.total_pages}</p>
                    </div>
                  </div>

                  {/* Compact progress gauge with times */}
                  <div className="flex items-center gap-2 flex-1 min-w-0 group/progress">
                    <span className="text-white/50 text-[10px] tabular-nums flex-shrink-0 w-8 text-right">{formatTime(audioCurrentTime)}</span>
                    <div
                      className="flex-1 h-1 group-hover/progress:h-1.5 bg-white/10 rounded-full cursor-pointer relative min-w-0 transition-all"
                      onClick={(e) => {
                        if (!audioRef.current || !audioDuration) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const pct = (e.clientX - rect.left) / rect.width;
                        audioRef.current.currentTime = pct * audioDuration;
                      }}
                    >
                      <div
                        className="h-full bg-white rounded-full transition-all duration-150"
                        style={{ width: audioDuration ? `${(audioCurrentTime / audioDuration) * 100}%` : "0%" }}
                      />
                      {/* Scrub handle */}
                      <div
                        className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-md opacity-0 group-hover/progress:opacity-100 transition-opacity pointer-events-none"
                        style={{ left: audioDuration ? `calc(${(audioCurrentTime / audioDuration) * 100}% - 6px)` : "0" }}
                      />
                    </div>
                    <span className="text-white/50 text-[10px] tabular-nums flex-shrink-0 w-8">
                      {audioDuration ? formatTime(audioDuration) : "--:--"}
                    </span>
                  </div>

                  {/* Auto-continue indicator */}
                  {hasMore && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                      <span className="text-green-400/70 text-[9px]">Auto</span>
                    </div>
                  )}

                  {/* Speed badge */}
                  <button
                    onClick={() => {
                      const currentIdx = speedRates.findIndex((r) => r.value === speechRate);
                      const next = speedRates[(currentIdx + 1) % speedRates.length];
                      setSpeechRate(next.value);
                      if (audioRef.current) {
                        audioRef.current.playbackRate = parseFloat(next.label.replace("x", ""));
                      }
                    }}
                    className="px-2 py-1 text-[10px] font-medium text-white bg-white/10 rounded-lg hover:bg-white/20 transition-colors flex-shrink-0"
                  >
                    {speedRates.find((r) => r.value === speechRate)?.label || "1x"}
                  </button>

                  {/* Voice selector */}
                  <div className="bg-white/10 rounded-lg px-4 py-1.5 min-w-[200px] relative flex-shrink-0">
                    <p className="text-white/50 text-[10px]">Voice</p>
                    <select
                      value={selectedVoice}
                      onChange={(e) => setSelectedVoice(e.target.value)}
                      className="w-full text-white text-sm bg-transparent border-none outline-none cursor-pointer appearance-none"
                    >
                      {voices.length > 0 ? voices.map((v) => (
                        <option key={v.name} value={v.name} className="bg-black text-white">
                          {v.locale} ({v.gender})
                        </option>
                      )) : <option value="">Loading...</option>}
                    </select>
                  </div>

                  {/* Sleep timer indicator (bottom bar) */}
                  {sleepTimerActive && (
                    <div className="flex items-center gap-1.5 flex-shrink-0 bg-white/5 rounded-lg px-2.5 py-1.5">
                      <svg className="w-3.5 h-3.5 text-white/50" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" />
                      </svg>
                      <span className="text-white/50 text-[10px] tabular-nums">{sleepTimer}m</span>
                    </div>
                  )}

                  {/* Bookmark button (bottom bar) */}
                  <button
                    onClick={addBookmark}
                    className="p-2 text-white/40 hover:text-white transition-colors flex-shrink-0 relative"
                    title="Bookmark this moment"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" />
                    </svg>
                    {bookmarks.length > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-white text-black text-[9px] font-bold flex items-center justify-center">
                        {bookmarks.length}
                      </span>
                    )}
                  </button>

                  {/* AI Chat (bottom bar) */}
                  <button
                    onClick={() => { setShowReader(true); setShowChat(true); }}
                    className="p-2 text-white/40 hover:text-white transition-colors flex-shrink-0"
                    title="Ask AI about this book"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
                    </svg>
                  </button>

                  {/* Show text */}
                  {!showReader && wordTimings.length > 0 && (
                    <button onClick={() => setShowReader(true)}
                      className="p-2 text-white/60 hover:text-white transition-colors flex-shrink-0" title="Show text">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                      </svg>
                    </button>
                  )}

                  {/* Stop */}
                  <button onClick={handleStop}
                    className="p-2 text-white/40 hover:text-white/70 transition-colors flex-shrink-0" title="Stop">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                </>
              )}
            </div>

            {/* Hidden audio element */}
            <audio
              ref={audioRef}
              src={audioUrl || undefined}
              className="hidden"
              onTimeUpdate={handleTimeUpdate}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onLoadedMetadata={() => {
                if (audioRef.current) setAudioDuration(audioRef.current.duration);
              }}
              onEnded={() => {
                setCurrentWordIndex(-1);
                setIsPlaying(false);
                if (activePdf && audioDuration) {
                  api.saveProgress(activePdf.pdf_id, {
                    current_page: pagesRead[pagesRead.length - 1] || readPage,
                    reading_time_seconds: Math.round(audioDuration),
                  }).catch(() => {});
                }
                // Auto-continue to next batch if more pages remain
                if (hasMoreRef.current) {
                  setStatus("Loading next pages...");
                  setAudioUrl(null);
                  setTimeout(() => handleRead(), 500);
                } else {
                  setStatus("Finished — no more pages.");
                }
              }}
            />
          </div>
        </div>
      )}

      {/* ── Pricing Modal ── */}
      {showPricing && (
        <div className="fixed inset-0 bg-black/70 z-[70] flex items-center justify-center p-4 animate-fadeIn" onClick={() => setShowPricing(false)}>
          <div className="bg-[#111] rounded-3xl shadow-2xl max-w-[680px] w-full border border-white/10 overflow-hidden animate-scaleIn" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="px-8 pt-8 pb-2">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-semibold text-white">Choose your plan</h2>
                <button onClick={() => setShowPricing(false)} className="text-white/30 hover:text-white/60 transition-colors p-1">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <p className="text-white/40 text-sm mt-1">Listen to any book, anywhere. Cancel anytime.</p>
            </div>

            {/* Plans */}
            <div className="p-8 grid grid-cols-2 gap-4">
              {/* Free */}
              <div className="rounded-2xl border border-white/10 p-6 space-y-5">
                <div>
                  <p className="text-white/50 text-xs font-medium tracking-wide uppercase">Free</p>
                  <p className="text-3xl font-semibold text-white mt-1">$0</p>
                  <p className="text-white/30 text-xs mt-0.5">Forever</p>
                </div>
                <div className="space-y-3">
                  {[
                    "5 books in library",
                    "100 MB storage",
                    "All voices included",
                    "Word-by-word reading",
                    "Explore free ebooks",
                  ].map((f) => (
                    <div key={f} className="flex items-center gap-2.5">
                      <svg className="w-4 h-4 text-white/30 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                      <span className="text-white/50 text-sm">{f}</span>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => setShowPricing(false)}
                  className="w-full py-3 text-sm font-medium text-white/60 bg-white/5 rounded-xl hover:bg-white/10 transition-colors"
                >
                  Current plan
                </button>
              </div>

              {/* Pro */}
              <div className="rounded-2xl border border-white/20 bg-white/[0.03] p-6 space-y-5 relative overflow-hidden">
                <div className="absolute top-0 left-4 right-4 h-[2px] bg-white rounded-full" />
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-white text-xs font-medium tracking-wide uppercase">Pro</p>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-white/60">Popular</span>
                  </div>
                  <div className="flex items-baseline gap-1 mt-1">
                    <p className="text-3xl font-semibold text-white">$5</p>
                    <p className="text-white/40 text-sm">/month</p>
                  </div>
                  <p className="text-white/30 text-xs mt-0.5">Billed monthly. Cancel anytime.</p>
                </div>
                <div className="space-y-3">
                  {[
                    "Unlimited books",
                    "Unlimited storage",
                    "All voices included",
                    "Word-by-word reading",
                    "Explore free ebooks",
                    "Priority audio generation",
                    "Auto-continue reading",
                  ].map((f) => (
                    <div key={f} className="flex items-center gap-2.5">
                      <svg className="w-4 h-4 text-white flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                      <span className="text-white/80 text-sm">{f}</span>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => {
                    setShowPricing(false);
                    handleUpgrade();
                  }}
                  disabled={upgradeLoading}
                  className="w-full py-3 text-sm font-medium text-black bg-white rounded-xl hover:bg-white/90 transition-colors"
                >
                  {upgradeLoading ? "Opening checkout..." : "Upgrade to Pro"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Dialog ── */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fadeIn" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-[#1a1a1a] rounded-2xl shadow-xl max-w-sm w-full p-6 border border-white/10 animate-scaleIn" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-2">Delete PDF?</h3>
            <p className="text-sm text-white/50 mb-6">
              Are you sure you want to delete &ldquo;{deleteConfirm.filename}&rdquo;? This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2.5 text-sm font-medium text-white/70 bg-white/10 rounded-xl hover:bg-white/20 transition-colors">
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
        <div className="fixed inset-0 bg-black/80 z-50 flex flex-col">
          <div className="bg-[#111] px-6 py-3 flex items-center justify-between border-b border-white/10">
            <div className="flex items-center gap-3">
              <button onClick={() => setShowPdfViewer(false)} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
                <svg className="w-5 h-5 text-white/60" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                </svg>
              </button>
              <h2 className="text-sm font-semibold text-white">{activePdf.filename}</h2>
            </div>
            <button onClick={() => setShowPdfViewer(false)} className="px-4 py-2 text-sm bg-white/10 text-white/70 rounded-xl hover:bg-white/20 transition-colors font-medium">
              Close
            </button>
          </div>
          <iframe src={pdfSrc} className="flex-1 bg-[#222]" title={activePdf.filename} />
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
