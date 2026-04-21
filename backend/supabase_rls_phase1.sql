-- Reade — Phase 1 RLS policies for browser-direct Supabase reads
-- Run this in the Supabase SQL Editor AFTER configuring Firebase as a
-- third-party auth provider (Dashboard → Authentication → Sign In / Providers).
--
-- What this enables: the browser can SELECT from `pdfs` and `pdf_progress`
-- scoped to the signed-in Firebase user, with no backend round-trip.
-- Writes (INSERT/UPDATE/DELETE) continue to go through the backend
-- with the service_role key, which bypasses RLS.

-- ============================================================
-- Firebase issuer — used to confirm the JWT came from YOUR Firebase project
-- Replace with your actual Firebase project ID if different.
-- ============================================================
-- Project ID from .env.local: reade-71704

-- ============================================================
-- PDFS — users can read their own library
-- ============================================================
ALTER TABLE pdfs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pdfs_select_own" ON pdfs;
CREATE POLICY "pdfs_select_own"
  ON pdfs
  FOR SELECT
  TO authenticated
  USING (
    auth.jwt() ->> 'iss' = 'https://securetoken.google.com/reade-71704'
    AND user_id = auth.jwt() ->> 'sub'
  );

-- ============================================================
-- PDF_PROGRESS — users can read their own progress
-- ============================================================
ALTER TABLE pdf_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "progress_select_own" ON pdf_progress;
CREATE POLICY "progress_select_own"
  ON pdf_progress
  FOR SELECT
  TO authenticated
  USING (
    auth.jwt() ->> 'iss' = 'https://securetoken.google.com/reade-71704'
    AND user_id = auth.jwt() ->> 'sub'
  );

-- ============================================================
-- PDF_ANALYSIS — users can read their own cached AI analysis
-- ============================================================
ALTER TABLE pdf_analysis ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "analysis_select_own" ON pdf_analysis;
CREATE POLICY "analysis_select_own"
  ON pdf_analysis
  FOR SELECT
  TO authenticated
  USING (
    auth.jwt() ->> 'iss' = 'https://securetoken.google.com/reade-71704'
    AND user_id = auth.jwt() ->> 'sub'
  );

-- ============================================================
-- USERS / SUBSCRIPTIONS — leave RLS off for now; only backend touches them.
-- If you later want the browser to read subscription tier directly, add:
--
-- ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "subs_select_own" ON subscriptions FOR SELECT TO authenticated
--   USING (user_id = auth.jwt() ->> 'sub');
-- ============================================================

-- ============================================================
-- STORAGE — make the `thumbnails` bucket public so the browser can
-- load thumbnail images directly via CDN without signed URLs.
--
-- ⚠️ Run this in the Supabase Dashboard UI instead of SQL:
-- Dashboard → Storage → thumbnails bucket → Settings → toggle "Public bucket" ON
--
-- Thumbnails live at `{user_id}/{pdf_id}.png`. The path is UUID-based so
-- they're not discoverable, but technically anyone with the URL can view.
-- For stricter privacy, keep the bucket private and use signed URLs instead.
-- ============================================================
