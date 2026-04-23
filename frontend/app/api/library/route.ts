import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(req: NextRequest) {
  // Extract Firebase UID from JWT
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let userId: string;
  try {
    const token = authHeader.split(" ")[1];
    const payload = JSON.parse(atob(token.split(".")[1]));
    userId = payload.sub;
    if (!userId) throw new Error("No sub claim");
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  // Query Supabase with service role (bypasses RLS)
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data, error } = await supabase
    .from("pdfs")
    .select("id, user_id, filename, total_pages, has_thumbnail, uploaded_at, source, original_title, original_author, cover_url, description, tags")
    .eq("user_id", userId)
    .order("uploaded_at", { ascending: false });

  if (error) {
    console.error("[API /library] Supabase error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const pdfs = (data || []).map((row) => ({
    pdf_id: row.id,
    filename: row.filename,
    total_pages: row.total_pages,
    thumbnail_url: row.has_thumbnail
      ? `${SUPABASE_URL}/storage/v1/object/public/thumbnails/${row.user_id}/${row.id}.png`
      : null,
    uploaded_at: row.uploaded_at,
    user_id: row.user_id,
  }));

  return NextResponse.json({ pdfs, count: pdfs.length });
}
