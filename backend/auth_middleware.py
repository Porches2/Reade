from fastapi import Depends, HTTPException, Request
from firebase_setup import verify_id_token


async def get_current_user(request: Request) -> str:
    """FastAPI dependency that extracts and verifies Firebase Bearer token.
    Also supports ?token= query param for img/iframe src that can't set headers.
    Returns the user_id (uid) from the verified token.
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
        return decoded["uid"]
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
