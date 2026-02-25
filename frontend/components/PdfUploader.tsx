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
}

export default function PdfUploader({ onUploadSuccess }: Props) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Simulated progress that advances smoothly during upload
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
      setStatus("Uploading...");

      try {
        const data = await api.uploadPdf(file);
        setProgress(100);
        setStatus("Done!");
        onUploadSuccess(data);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Upload failed";
        console.error("[PdfUploader] Upload error:", msg);
        setError(msg);
      } finally {
        setUploading(false);
        setProgress(0);
        setStatus("");
      }
    },
    [onUploadSuccess]
  );

  return (
    <div>
      {uploading ? (
        <div className="py-2">
          <div className="w-full bg-gray-200 rounded-full h-2 mb-1.5">
            <div
              className="bg-indigo-600 h-2 rounded-full transition-all duration-200"
              style={{ width: `${Math.round(progress)}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 text-center">
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
            className="block w-full text-center px-3 py-2 bg-indigo-600 text-white text-xs rounded-lg cursor-pointer hover:bg-indigo-700 transition-colors"
          >
            + Upload PDF
          </label>
        </>
      )}
      {error && <p className="text-red-500 mt-1 text-xs">{error}</p>}
    </div>
  );
}
