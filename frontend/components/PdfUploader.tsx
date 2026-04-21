"use client";

import { useCallback, useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";

interface Props {
  onUploadSuccess: (data: {
    pdf_id: string;
    filename: string;
    total_pages: number;
    thumbnail_url: string | null;
  }) => void;
  onUploadError?: (error: string) => void;
}

export default function PdfUploader({ onUploadSuccess, onUploadError }: Props) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (uploading) {
      setProgress(0);
      timerRef.current = setInterval(() => {
        setProgress((prev) => {
          if (prev < 60) return prev + 2;
          if (prev < 85) return prev + 0.5;
          if (prev < 95) return prev + 0.2;
          return prev;
        });
      }, 100);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [uploading]);

  const handleUpload = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        setError("PDF files only");
        return;
      }
      setError(null);
      setUploading(true);
      setStatus("Connecting...");

      try {
        const data = await api.uploadPdf(file);
        setProgress(100);
        setStatus("Done!");
        onUploadSuccess(data);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Upload failed";
        console.error("[PdfUploader] Upload error:", msg);
        onUploadError?.(msg);
        setError(msg);
      } finally {
        setUploading(false);
        setProgress(0);
        setStatus("");
      }
    },
    [onUploadSuccess, onUploadError]
  );

  return (
    <div>
      {uploading ? (
        <div className="py-2">
          <div className="w-full bg-white/10 rounded-full h-2 mb-1.5">
            <div
              className="bg-white h-2 rounded-full transition-all duration-200"
              style={{ width: `${Math.round(progress)}%` }}
            />
          </div>
          <p className="text-xs text-white/50 text-center">
            {status} {Math.round(progress)}%
          </p>
        </div>
      ) : (
        <>
          <input
            type="file"
            accept=".pdf"
            className="hidden"
            id="pdf-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
              e.target.value = "";
            }}
          />
          <label
            htmlFor="pdf-input"
            className="flex items-center gap-1.5 px-4 py-2 bg-white/5 text-white text-sm rounded-full cursor-pointer hover:bg-white/10 transition-colors font-medium"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
            </svg>
            Upload
          </label>
        </>
      )}
      {error && <p className="text-red-400 mt-1 text-xs">{error}</p>}
    </div>
  );
}
