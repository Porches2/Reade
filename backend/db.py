"""
Supabase-backed persistence layer for Reade.

Replaces the legacy file-based JSON + filesystem storage with:
  - Postgres tables: users, subscriptions, pdfs, pdf_progress, pdf_analysis
  - Object storage buckets: pdfs, thumbnails, audio

All functions use the service_role key (bypasses RLS) and explicitly
scope queries by user_id. The backend trusts Firebase JWT for identity.
"""

from __future__ import annotations

import os
from typing import Any, Optional

from supabase import Client, create_client

# ------------------------------------------------------------------
# Client singleton
# ------------------------------------------------------------------

_SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
_SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

if not _SUPABASE_URL or not _SUPABASE_KEY:
    raise RuntimeError(
        "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment"
    )

_client: Client = create_client(_SUPABASE_URL, _SUPABASE_KEY)


def client() -> Client:
    """Expose the raw client for advanced operations (rare)."""
    return _client


# ------------------------------------------------------------------
# Bucket names
# ------------------------------------------------------------------

BUCKET_PDFS = "pdfs"
BUCKET_THUMBNAILS = "thumbnails"
BUCKET_AUDIO = "audio"

# Signed URL lifetime for file serving redirects
SIGNED_URL_EXPIRES_SECONDS = 60 * 10  # 10 minutes


# ------------------------------------------------------------------
# Users
# ------------------------------------------------------------------

def upsert_user(user_id: str, email: str = "", display_name: str = "") -> None:
    """Idempotent user upsert — called on every authenticated request."""
    _client.table("users").upsert(
        {
            "id": user_id,
            "email": email or None,
            "display_name": display_name or None,
        },
        on_conflict="id",
    ).execute()


def get_user(user_id: str) -> Optional[dict]:
    res = _client.table("users").select("*").eq("id", user_id).limit(1).execute()
    return res.data[0] if res.data else None


def set_stripe_customer(user_id: str, customer_id: str) -> None:
    _client.table("users").update({"stripe_customer_id": customer_id}).eq(
        "id", user_id
    ).execute()


def find_user_by_stripe_customer(customer_id: str) -> Optional[str]:
    res = (
        _client.table("users")
        .select("id")
        .eq("stripe_customer_id", customer_id)
        .limit(1)
        .execute()
    )
    return res.data[0]["id"] if res.data else None


# ------------------------------------------------------------------
# Subscriptions
# ------------------------------------------------------------------

def get_subscription(user_id: str) -> dict:
    """Return subscription dict; creates a free-tier row if none exists."""
    res = (
        _client.table("subscriptions")
        .select("*")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if res.data:
        return res.data[0]

    default = {
        "user_id": user_id,
        "tier": "free",
        "status": "active",
    }
    _client.table("subscriptions").insert(default).execute()
    return default


def upsert_subscription(user_id: str, sub: dict) -> None:
    """Upsert subscription by user_id. Only known columns are kept."""
    payload = {
        "user_id": user_id,
        "tier": sub.get("tier", "free"),
        "status": sub.get("status", "active"),
        "stripe_subscription_id": sub.get("stripe_subscription_id"),
        "current_period_end": sub.get("current_period_end"),
    }
    _client.table("subscriptions").upsert(payload, on_conflict="user_id").execute()


# ------------------------------------------------------------------
# PDFs (metadata)
# ------------------------------------------------------------------

def save_pdf(user_id: str, pdf_id: str, info: dict) -> None:
    """Insert or update a PDF row. `info` is the legacy flat meta dict."""
    payload = {
        "id": pdf_id,
        "user_id": user_id,
        "filename": info.get("filename", ""),
        "total_pages": int(info.get("total_pages", 0) or 0),
        "file_size_bytes": int(info.get("file_size_bytes", 0) or 0),
        "has_thumbnail": bool(info.get("has_thumbnail", False)),
        "source": info.get("source", "upload"),
        "original_title": info.get("original_title"),
        "original_author": info.get("original_author"),
        "cover_url": info.get("cover_url"),
        "description": info.get("description"),
        "tags": info.get("tags") or [],
    }
    if info.get("uploaded_at"):
        payload["uploaded_at"] = info["uploaded_at"]

    _client.table("pdfs").upsert(payload, on_conflict="id").execute()


def get_pdf(user_id: str, pdf_id: str) -> Optional[dict]:
    res = (
        _client.table("pdfs")
        .select("*")
        .eq("id", pdf_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def list_pdfs(user_id: str) -> list[dict]:
    res = (
        _client.table("pdfs")
        .select("*")
        .eq("user_id", user_id)
        .order("uploaded_at", desc=True)
        .execute()
    )
    return res.data or []


def delete_pdf(user_id: str, pdf_id: str) -> None:
    _client.table("pdfs").delete().eq("id", pdf_id).eq("user_id", user_id).execute()


def get_user_usage(user_id: str) -> dict:
    """Return {'book_count': int, 'total_bytes': int} for quota checks."""
    res = (
        _client.table("pdfs")
        .select("file_size_bytes")
        .eq("user_id", user_id)
        .execute()
    )
    rows = res.data or []
    return {
        "book_count": len(rows),
        "total_bytes": sum(int(r.get("file_size_bytes") or 0) for r in rows),
    }


# ------------------------------------------------------------------
# Reading progress
# ------------------------------------------------------------------

def get_progress(user_id: str, pdf_id: str) -> Optional[dict]:
    res = (
        _client.table("pdf_progress")
        .select("*")
        .eq("pdf_id", pdf_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def save_progress(user_id: str, pdf_id: str, progress: dict) -> None:
    payload = {
        "pdf_id": pdf_id,
        "user_id": user_id,
        "current_page": int(progress.get("current_page", 1) or 1),
        "total_time_seconds": int(progress.get("total_time_seconds", 0) or 0),
        "completed": bool(progress.get("completed", False)),
    }
    if progress.get("started_at"):
        payload["started_at"] = progress["started_at"]
    if progress.get("last_read_at"):
        payload["last_read_at"] = progress["last_read_at"]

    _client.table("pdf_progress").upsert(payload, on_conflict="pdf_id").execute()


def list_progress(user_id: str) -> list[dict]:
    res = (
        _client.table("pdf_progress")
        .select("*")
        .eq("user_id", user_id)
        .execute()
    )
    return res.data or []


# ------------------------------------------------------------------
# AI analysis cache
# ------------------------------------------------------------------

def get_analysis(user_id: str, pdf_id: str) -> Optional[dict]:
    res = (
        _client.table("pdf_analysis")
        .select("*")
        .eq("pdf_id", pdf_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def save_analysis(
    user_id: str,
    pdf_id: str,
    analysis: dict,
    chapter_source: Optional[str] = None,
) -> None:
    payload = {
        "pdf_id": pdf_id,
        "user_id": user_id,
        "analysis": analysis,
        "chapter_source": chapter_source,
    }
    _client.table("pdf_analysis").upsert(payload, on_conflict="pdf_id").execute()


def delete_analysis(user_id: str, pdf_id: str) -> None:
    _client.table("pdf_analysis").delete().eq("pdf_id", pdf_id).eq(
        "user_id", user_id
    ).execute()


# ------------------------------------------------------------------
# Object storage
# ------------------------------------------------------------------

def _storage(bucket: str):
    return _client.storage.from_(bucket)


def upload_file(
    bucket: str,
    path: str,
    data: bytes,
    content_type: str = "application/octet-stream",
) -> None:
    """Upload bytes to a bucket path. Upserts (overwrites) if path exists."""
    _storage(bucket).upload(
        path=path,
        file=data,
        file_options={
            "content-type": content_type,
            "upsert": "true",
        },
    )


def download_file(bucket: str, path: str) -> bytes:
    """Download a file's bytes from a bucket."""
    return _storage(bucket).download(path)


def delete_file(bucket: str, path: str) -> None:
    try:
        _storage(bucket).remove([path])
    except Exception:
        # Best-effort cleanup — ignore "not found" style errors
        pass


def get_signed_url(
    bucket: str,
    path: str,
    expires_in: int = SIGNED_URL_EXPIRES_SECONDS,
) -> str:
    """Return a time-limited signed URL for private file access."""
    res = _storage(bucket).create_signed_url(path, expires_in)
    # supabase-py returns {"signedURL": "..."} or {"signedUrl": "..."}
    return res.get("signedURL") or res.get("signedUrl") or ""


# ------------------------------------------------------------------
# Path helpers — one place to own the bucket key layout
# ------------------------------------------------------------------

def pdf_object_path(user_id: str, pdf_id: str) -> str:
    return f"{user_id}/{pdf_id}.pdf"


def thumbnail_object_path(user_id: str, pdf_id: str) -> str:
    return f"{user_id}/{pdf_id}.png"


def audio_object_path(audio_id: str) -> str:
    return f"{audio_id}.mp3"
