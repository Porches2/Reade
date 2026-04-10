import logging

from fastapi import HTTPException, Request

from firebase_setup import verify_id_token
import db

logger = logging.getLogger("auth")


async def get_current_user(request: Request) -> str:
    """FastAPI dependency that extracts and verifies Firebase Bearer token.
    Also supports ?token= query param for img/iframe src that can't set headers.
    Returns the user_id (uid) from the verified token.

    Also performs an idempotent user upsert into the `users` table so that
    Supabase foreign keys (pdfs.user_id, subscriptions.user_id, etc.) always
    resolve without requiring a separate onboarding flow.
    """
    token = None

    # Check Authorization header first
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split("Bearer ")[1]

    # Fallback to query param (for img/iframe src)
    if not token:
        token = request.query_params.get("token")

    if not token:
        raise HTTPException(
            status_code=401,
            detail="Missing or invalid Authorization header. Expected: Bearer <token>",
        )

    try:
        decoded = verify_id_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")

    uid = decoded["uid"]

    # Idempotent user upsert — safe to call on every request
    try:
        db.upsert_user(
            uid,
            email=decoded.get("email", "") or "",
            display_name=decoded.get("name", "") or "",
        )
    except Exception as e:
        logger.warning(f"[auth] upsert_user failed for {uid}: {e}")

    return uid
