import os
import firebase_admin
from firebase_admin import credentials, auth
from dotenv import load_dotenv

load_dotenv()

_app = None


def init_firebase():
    """Initialize Firebase Admin SDK (auth only)."""
    global _app
    if _app:
        return _app

    cred_path = os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH", "firebase-service-account.json")
    if os.path.exists(cred_path):
        cred = credentials.Certificate(cred_path)
    else:
        cred = credentials.Certificate({
            "type": "service_account",
            "project_id": os.getenv("FIREBASE_PROJECT_ID"),
            "private_key_id": os.getenv("FIREBASE_PRIVATE_KEY_ID", ""),
            "private_key": os.getenv("FIREBASE_PRIVATE_KEY", "").replace("\\n", "\n"),
            "client_email": os.getenv("FIREBASE_CLIENT_EMAIL"),
            "client_id": os.getenv("FIREBASE_CLIENT_ID", ""),
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
        })

    _app = firebase_admin.initialize_app(cred)
    print("[Firebase] Initialized (auth only)")
    return _app


def verify_id_token(id_token: str) -> dict:
    """Verify a Firebase ID token and return the decoded token."""
    init_firebase()
    return auth.verify_id_token(id_token)
