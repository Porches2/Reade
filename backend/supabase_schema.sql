-- Reade — Supabase Schema
-- Run this once in the Supabase SQL Editor (https://supabase.com/dashboard → SQL Editor → New Query)

-- ============================================================
-- USERS — keyed by Firebase UID (text, not UUID)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT,
  display_name TEXT,
  stripe_customer_id TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id);

-- ============================================================
-- SUBSCRIPTIONS — one row per user
-- ============================================================
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tier TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active',
  stripe_subscription_id TEXT UNIQUE,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PDFS — metadata for each uploaded/imported PDF
-- ============================================================
CREATE TABLE IF NOT EXISTS pdfs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  total_pages INTEGER NOT NULL DEFAULT 0,
  file_size_bytes BIGINT NOT NULL DEFAULT 0,
  has_thumbnail BOOLEAN DEFAULT FALSE,
  source TEXT DEFAULT 'upload',
  original_title TEXT,
  original_author TEXT,
  cover_url TEXT,
  description TEXT,
  tags TEXT[] DEFAULT '{}',
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pdfs_user_id ON pdfs(user_id);
CREATE INDEX IF NOT EXISTS idx_pdfs_uploaded_at ON pdfs(user_id, uploaded_at DESC);

-- ============================================================
-- PDF_PROGRESS — reading progress per PDF
-- ============================================================
CREATE TABLE IF NOT EXISTS pdf_progress (
  pdf_id TEXT PRIMARY KEY REFERENCES pdfs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  current_page INTEGER DEFAULT 1,
  total_time_seconds INTEGER DEFAULT 0,
  completed BOOLEAN DEFAULT FALSE,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  last_read_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_progress_user ON pdf_progress(user_id);

-- ============================================================
-- PDF_ANALYSIS — cached AI document analysis
-- ============================================================
CREATE TABLE IF NOT EXISTS pdf_analysis (
  pdf_id TEXT PRIMARY KEY REFERENCES pdfs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  analysis JSONB NOT NULL,
  chapter_source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analysis_user ON pdf_analysis(user_id);

-- ============================================================
-- DONE
-- ============================================================
-- Storage buckets (pdfs, thumbnails, audio) are already created via API.
-- All tables use the service_role key from the backend, so RLS is not enforced.
-- (Backend trusts Firebase JWT and scopes queries by user_id explicitly.)
