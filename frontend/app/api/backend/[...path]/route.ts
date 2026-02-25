import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function proxyRequest(req: NextRequest, { params }: { params: { path: string[] } }) {
  const path = "/" + params.path.join("/");
  const url = new URL(path, API_URL);
  // Forward query params
  req.nextUrl.searchParams.forEach((value, key) => {
    url.searchParams.set(key, value);
  });

  const headers: Record<string, string> = {};
  const authHeader = req.headers.get("authorization");
  if (authHeader) headers["Authorization"] = authHeader;
  const contentType = req.headers.get("content-type");
  if (contentType) headers["Content-Type"] = contentType;

  const fetchOptions: RequestInit = {
    method: req.method,
    headers,
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    // For form data, re-read and forward
    if (contentType?.includes("multipart/form-data")) {
      const formData = await req.formData();
      const backendForm = new FormData();
      for (const [key, value] of Array.from(formData.entries())) {
        backendForm.append(key, value);
      }
      delete headers["Content-Type"]; // Let fetch set boundary
      fetchOptions.body = backendForm;
    } else {
      fetchOptions.body = await req.text();
    }
  }

  try {
    const res = await fetch(url.toString(), {
      ...fetchOptions,
      headers,
      signal: AbortSignal.timeout(300000), // 5 min timeout for long operations like TTS
    });

    const data = await res.text();
    return new NextResponse(data, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("Content-Type") || "application/json" },
    });
  } catch (e: unknown) {
    console.error(`[API Proxy] ${req.method} ${path} failed:`, e);
    return NextResponse.json(
      { detail: e instanceof Error ? e.message : "Backend request failed" },
      { status: 502 }
    );
  }
}

export async function GET(req: NextRequest, ctx: { params: { path: string[] } }) {
  return proxyRequest(req, ctx);
}

export async function POST(req: NextRequest, ctx: { params: { path: string[] } }) {
  return proxyRequest(req, ctx);
}

export async function DELETE(req: NextRequest, ctx: { params: { path: string[] } }) {
  return proxyRequest(req, ctx);
}

export async function PUT(req: NextRequest, ctx: { params: { path: string[] } }) {
  return proxyRequest(req, ctx);
}
