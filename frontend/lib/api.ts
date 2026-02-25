import { auth } from "./firebase";

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const PROXY_BASE = "/api/backend";

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

// Direct backend call (no proxy timeout issues)
async function request(path: string, options: RequestInit = {}) {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
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

  tts: (data: { pdf_id: string; start_page: number; num_pages: number; voice: string; rate: string }) =>
    request("/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

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
};
