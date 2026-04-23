import { NextResponse } from "next/server";

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function GET() {
  try {
    const res = await fetch(`${BACKEND_URL}/health`, { signal: AbortSignal.timeout(30000) });
    const ok = res.ok;
    return NextResponse.json({ ok, backend: BACKEND_URL, timestamp: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e), timestamp: new Date().toISOString() }, { status: 502 });
  }
}
