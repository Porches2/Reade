import { auth } from "../firebase.config";

// Update this to your computer's local network IP
const API_URL = "http://192.168.0.184:8000";

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

async function request(path: string, options: RequestInit = {}) {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`${API_URL}${path}`, {
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
  uploadPdf: async (uri: string, fileName: string) => {
    const token = await getAuthToken();
    if (!token) {
      throw new Error("Not authenticated. Please log in again.");
    }

    const formData = new FormData();
    formData.append("file", {
      uri,
      name: fileName,
      type: "application/pdf",
    } as unknown as Blob);

    const res = await fetch(`${API_URL}/upload`, {
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

  // Pass token as query param so WebView/img can access without headers
  getPdfFileUrl: async (pdfId: string) => {
    const token = await getAuthToken();
    const base = `${API_URL}/pdf/${pdfId}/file`;
    return token ? `${base}?token=${token}` : base;
  },

  getThumbnailUrl: async (pdfId: string) => {
    const token = await getAuthToken();
    const base = `${API_URL}/pdf/${pdfId}/thumbnail`;
    return token ? `${base}?token=${token}` : base;
  },

  ask: (data: {
    pdf_id: string;
    question: string;
    voice_mode?: boolean;
    page_start?: number;
    page_end?: number;
  }) =>
    request("/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  summarize: (data: {
    pdf_id: string;
    voice_mode?: boolean;
    page_start?: number;
    page_end?: number;
  }) =>
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

  tts: (data: {
    pdf_id: string;
    start_page: number;
    num_pages: number;
    voice: string;
    rate: string;
  }) =>
    request("/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  getAudioUrl: (audioId: string) => `${API_URL}/audio/${audioId}`,

  getVoices: () => request("/voices"),

  getExplore: () => request("/explore"),

  searchExplore: (q: string) =>
    request(`/explore/search?q=${encodeURIComponent(q)}`),
};
