import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Base directory paths
BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent

# Ensure backend and root directory are discoverable on sys.path
for path_dir in [str(BASE_DIR), str(ROOT_DIR)]:
    if path_dir not in sys.path:
        sys.path.insert(0, path_dir)

# Add local bin directories to system PATH for FFmpeg discovery on cloud hosts like Render
for bin_candidate in [BASE_DIR / "bin", ROOT_DIR / "bin"]:
    if bin_candidate.is_dir() and str(bin_candidate) not in os.environ.get("PATH", ""):
        os.environ["PATH"] = f"{str(bin_candidate)}{os.pathsep}{os.environ.get('PATH', '')}"

load_dotenv(BASE_DIR / ".env")

PORT = int(os.getenv("PORT", "8000"))
SECRET_KEY = os.getenv("SECRET_KEY", "b39e6a9821814e5b7c0205842880c88463e23dd25619623258849b291db7d819")
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))  # 24 hours

# PostgreSQL Database Configuration (Neon / Supabase / Render / Local)
DATABASE_URL = (
    os.getenv("DATABASE_URL")
    or os.getenv("POSTGRES_URL")
    or os.getenv("POSTGRESQL_URL")
    or ""
)
# Render and Heroku PostgreSQL URLs start with postgres:// - adapt to postgresql:// for SQLAlchemy/psycopg2
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# MongoDB Configuration
MONGO_URI = (
    os.getenv("MONGO_URI")
    or os.getenv("MONGODB_URI")
    or os.getenv("MONGO_URL")
    or ""
)
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "sododb")
MONGO_AUTH_COLLECTION = os.getenv("MONGO_AUTH_COLLECTION", "auth")

CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if origin.strip()
]

# Media Storage Directory for Downloaded Audio
MEDIA_DIR = Path(os.getenv("MEDIA_DIR", str(BASE_DIR / "media" / "downloads")))
MEDIA_DIR.mkdir(parents=True, exist_ok=True)
