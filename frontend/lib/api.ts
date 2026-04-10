import { auth } from "./firebase";

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function getAuthToken(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken();
  } catch (e) {
    console.error("Failed to get auth token:", e);
    return null;
  }
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

// Direct backend call with configurable timeout
async function request(path: string, options: RequestInit = {}, timeoutMs = 120000) {
  const authHeaders = await getAuthHeaders();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        ...authHeaders,
        ...options.headers,
      },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(data.detail || `Request failed: ${res.status}`);
    }
    return res.json();
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error("Request timed out. The server may be waking up — try again.");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  // Upload directly to backend
  uploadPdf: async (file: File) => {
    const token = await getAuthToken();
    if (!token) {
      throw new Error("Not authenticated. Please log in again.");
    }

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch(`${BACKEND_URL}/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(`Server error (${res.status})`);
    }

    if (!res.ok) {
      throw new Error(data.detail || `Upload failed (${res.status})`);
    }
    return data;
  },

  getLibrary: () => request("/library"),

  deletePdf: (pdfId: string) =>
    request(`/library/${pdfId}`, { method: "DELETE" }),

  getPdfFileUrl: async (pdfId: string) => {
    const token = await getAuthToken();
    const base = `${BACKEND_URL}/pdf/${pdfId}/file`;
    return token ? `${base}?token=${token}` : base;
  },

  getThumbnailUrl: async (pdfId: string) => {
    const token = await getAuthToken();
    const base = `${BACKEND_URL}/pdf/${pdfId}/thumbnail`;
    return token ? `${base}?token=${token}` : base;
  },

  ask: (data: { pdf_id: string; question: string; voice_mode?: boolean; page_start?: number; page_end?: number }) =>
    request("/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  summarize: (data: { pdf_id: string; voice_mode?: boolean; page_start?: number; page_end?: number }) =>
    request("/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  recommend: (data: { pdf_id: string; voice_mode?: boolean }) =>
    request("/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  // Start TTS job (returns immediately with job_id)
  ttsStart: (data: { pdf_id: string; start_page: number; num_pages: number; voice: string; rate: string }) =>
    request("/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  // Poll TTS job status
  ttsPoll: (jobId: string) => request(`/tts/${jobId}`),

  // Start TTS and poll until complete (supports cancellation via AbortSignal)
  tts: async (data: { pdf_id: string; start_page: number; num_pages: number; voice: string; rate: string }, onProgress?: (status: string) => void, signal?: AbortSignal) => {
    const { job_id } = await api.ttsStart(data);
    onProgress?.("Processing audio...");

    for (let i = 0; i < 120; i++) { // max ~2 min polling
      if (signal?.aborted) throw new Error("Cancelled");
      await new Promise((r) => setTimeout(r, 1000));
      if (signal?.aborted) throw new Error("Cancelled");
      const result = await api.ttsPoll(job_id);
      if (result.status === "done") return result;
      if (result.status === "failed") throw new Error(result.error || "TTS generation failed");
      onProgress?.(`Generating audio... ${Math.min(95, Math.round((i / 60) * 100))}%`);
    }
    throw new Error("TTS generation timed out. Try fewer pages.");
  },

  getAudioUrl: (audioId: string) => `${BACKEND_URL}/audio/${audioId}`,

  getVoices: () => request("/voices"),

  getExplore: () => request("/explore"),

  searchExplore: (q: string) => request(`/explore/search?q=${encodeURIComponent(q)}`),

  // Reading progress
  saveProgress: (pdfId: string, data: { current_page: number; reading_time_seconds: number; completed?: boolean }) =>
    request(`/library/${pdfId}/progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  getProgress: (pdfId: string) => request(`/library/${pdfId}/progress`),

  // Document analysis (TOC + important pages)
  getAnalysis: (pdfId: string) => request(`/pdf/${pdfId}/analysis`),

  // Import explore book to library
  importBook: (data: { title: string; author: string; download_url: string; cover_url?: string | null; description?: string; tags?: string[] }) =>
    request("/explore/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }, 120000),

  // Account & Subscription
  getAccount: () => request("/account"),

  createCheckoutSession: () =>
    request("/create-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }),

  createPortalSession: () =>
    request("/create-portal-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }),
};
