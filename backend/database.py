"""
Database and Authentication Backend for Sodo Player.
Supports Neon PostgreSQL as the primary database with graceful local SQLite fallback.
"""

import os
import re
import uuid
import sqlite3
from datetime import datetime, timezone
from typing import Optional, Any, Dict, List
from pathlib import Path
from bson import ObjectId

from config import DATABASE_URL, MONGO_URI, MONGO_DB_NAME, MONGO_AUTH_COLLECTION, BASE_DIR
from security import hash_password
from logger import get_logger

logger = get_logger("sodo.database")

# Optional certifi TLS fallback
try:
    import certifi
    TLS_CA_FILE = certifi.where()
except Exception:
    TLS_CA_FILE = None

# Global connection pools and backends
_pg_pool = None
_auth_backend: Optional[Any] = None
_is_postgres_active = False


# ---------------------------------------------------------------------------
# PostgreSQL Query & Connection Wrappers
# ---------------------------------------------------------------------------

class PostgresCursorWrapper:
    """Wraps psycopg2 DictCursor with SQLite-compatible interface and query translation."""

    def __init__(self, raw_cur):
        self._cur = raw_cur

    def _adapt_sql(self, sql: str) -> str:
        s = sql
        # Adapt INSERT OR IGNORE INTO -> INSERT INTO ... ON CONFLICT DO NOTHING
        if "INSERT OR IGNORE INTO" in s:
            s = s.replace("INSERT OR IGNORE INTO", "INSERT INTO")
            if "ON CONFLICT" not in s:
                s = s.rstrip().rstrip(";") + " ON CONFLICT DO NOTHING"

        # Adapt is_favorite boolean expressions for PostgreSQL
        s = s.replace("is_favorite = 1", "is_favorite = TRUE")
        s = s.replace("is_favorite = 0", "is_favorite = FALSE")

        # Adapt parameter placeholders from SQLite '?' to PostgreSQL '%s'
        s = s.replace("?", "%s")
        return s

    def execute(self, sql: str, params=None):
        adapted = self._adapt_sql(sql)
        if params is None:
            return self._cur.execute(adapted)
        return self._cur.execute(adapted, params)

    def executemany(self, sql: str, seq_of_params):
        adapted = self._adapt_sql(sql)
        return self._cur.executemany(adapted, seq_of_params)

    def fetchone(self):
        row = self._cur.fetchone()
        return row

    def fetchall(self):
        return self._cur.fetchall()

    def close(self):
        self._cur.close()

    @property
    def rowcount(self):
        return self._cur.rowcount

    @property
    def description(self):
        return self._cur.description


class PostgresConnectionWrapper:
    """Wraps psycopg2 connection to mimic sqlite3.Connection with Row/Dict access & pool return."""

    def __init__(self, raw_conn, pool=None):
        from psycopg2.extras import DictCursor
        self._conn = raw_conn
        self._pool = pool
        self._cursor_factory = DictCursor
        self._transaction_depth = 0

    def cursor(self):
        return PostgresCursorWrapper(self._conn.cursor(cursor_factory=self._cursor_factory))

    def execute(self, sql: str, params=None):
        cur = self.cursor()
        cur.execute(sql, params)
        return cur

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        self._transaction_depth = 0
        if self._conn is not None:
            if self._pool is not None:
                try:
                    self._conn.commit()
                except Exception:
                    try:
                        self._conn.rollback()
                    except Exception:
                        pass
                try:
                    self._pool.putconn(self._conn)
                except Exception:
                    pass
                self._conn = None
            else:
                try:
                    self._conn.close()
                except Exception:
                    pass
                self._conn = None

    def __enter__(self):
        if self._transaction_depth == 0:
            self._conn.__enter__()
        self._transaction_depth += 1
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self._transaction_depth = max(0, self._transaction_depth - 1)
        if self._transaction_depth == 0:
            return self._conn.__exit__(exc_type, exc_val, exc_tb)
        if exc_type is not None:
            try:
                self._conn.rollback()
            except Exception:
                pass
            return False
        return None


# ---------------------------------------------------------------------------
# PostgreSQL Auth Backend
# ---------------------------------------------------------------------------

class PostgresAuthBackend:
    """PostgreSQL implementation targeting users table (and auth view) in Neon HoutDB."""

    def __init__(self, dsn: str):
        import psycopg2
        from psycopg2.extras import DictCursor
        self.dsn = dsn
        # Test connection quickly
        test_conn = psycopg2.connect(dsn)
        test_conn.close()

    def _get_conn(self):
        global _pg_pool
        import psycopg2
        from psycopg2.extras import DictCursor
        if _pg_pool:
            raw = _pg_pool.getconn()
            return PostgresConnectionWrapper(raw, pool=_pg_pool)
        raw = psycopg2.connect(self.dsn)
        return PostgresConnectionWrapper(raw)

    def find_by_login(self, login_id: str) -> Optional[dict]:
        conn = self._get_conn()
        try:
            cur = conn.cursor()
            cur.execute("""
                SELECT id, username, email, display_name, password_hash, is_active, created_at
                FROM users
                WHERE LOWER(email) = %s OR username = %s
                LIMIT 1
            """, (login_id.strip().lower(), login_id.strip()))
            row = cur.fetchone()
            return self._format(row)
        finally:
            conn.close()

    def find_by_email(self, email: str) -> Optional[dict]:
        conn = self._get_conn()
        try:
            cur = conn.cursor()
            cur.execute("""
                SELECT id, username, email, display_name, password_hash, is_active, created_at
                FROM users
                WHERE LOWER(email) = %s
                LIMIT 1
            """, (email.strip().lower(),))
            row = cur.fetchone()
            return self._format(row)
        finally:
            conn.close()

    def find_by_username(self, username: str) -> Optional[dict]:
        conn = self._get_conn()
        try:
            cur = conn.cursor()
            cur.execute("""
                SELECT id, username, email, display_name, password_hash, is_active, created_at
                FROM users
                WHERE username = %s
                LIMIT 1
            """, (username.strip(),))
            row = cur.fetchone()
            return self._format(row)
        finally:
            conn.close()

    def find_by_id(self, user_id: str) -> Optional[dict]:
        conn = self._get_conn()
        try:
            cur = conn.cursor()
            cur.execute("""
                SELECT id, username, email, display_name, password_hash, is_active, created_at
                FROM users
                WHERE id::text = %s
                LIMIT 1
            """, (str(user_id).strip(),))
            row = cur.fetchone()
            return self._format(row)
        finally:
            conn.close()

    def create_user(self, user_data: dict) -> dict:
        conn = self._get_conn()
        try:
            user_id = str(uuid.uuid4())
            with conn:
                cur = conn.cursor()
                cur.execute("""
                    INSERT INTO users (id, username, email, display_name, password_hash, is_active, merit)
                    VALUES (%s, %s, %s, %s, %s, TRUE, 100)
                    RETURNING id, username, email, display_name, password_hash, is_active, created_at
                """, (
                    user_id,
                    user_data["username"].strip(),
                    user_data["email"].strip().lower(),
                    user_data.get("full_name"),
                    user_data["hashed_password"],
                ))
                row = cur.fetchone()
                return self._format(row)
        finally:
            conn.close()

    def count_users(self) -> int:
        conn = self._get_conn()
        try:
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) as count FROM users")
            row = cur.fetchone()
            return row["count"] if row else 0
        finally:
            conn.close()

    def seed_demo(self):
        # Do not automatically seed demo accounts if user accounts already exist
        pass

    def _format(self, row: Optional[Any]) -> Optional[dict]:
        if not row:
            return None
        d = dict(row)
        created_at = d.get("created_at")
        if isinstance(created_at, datetime):
            created_str = created_at.isoformat()
        else:
            created_str = str(created_at) if created_at else None

        return {
            "id": str(d["id"]),
            "email": d.get("email"),
            "username": d["username"],
            "full_name": d.get("display_name") or d.get("full_name"),
            "hashed_password": d.get("password_hash") or d.get("hashed_password"),
            "is_active": bool(d.get("is_active", True)),
            "created_at": created_str,
        }


# ---------------------------------------------------------------------------
# MongoDB Auth Backend (Legacy / Fallback)
# ---------------------------------------------------------------------------

class MongoAuthBackend:
    """MongoDB implementation targeting sododb database and auth collection."""

    def __init__(self, uri: str, db_name: str, collection_name: str):
        from pymongo import MongoClient, ASCENDING
        kwargs = {"serverSelectionTimeoutMS": 2000, "connectTimeoutMS": 2000}
        if TLS_CA_FILE:
            kwargs["tlsCAFile"] = TLS_CA_FILE
        self.client = MongoClient(uri, **kwargs)
        self.client.admin.command("ping")
        self.db = self.client[db_name]
        self.collection = self.db[collection_name]
        self.collection.create_index([("email", ASCENDING)], unique=True, name="uniq_email")
        self.collection.create_index([("username", ASCENDING)], unique=True, name="uniq_username")

    def find_by_login(self, login_id: str) -> Optional[dict]:
        doc = self.collection.find_one({
            "$or": [
                {"email": login_id.lower()},
                {"username": login_id},
            ]
        })
        return self._format(doc)

    def find_by_email(self, email: str) -> Optional[dict]:
        doc = self.collection.find_one({"email": email.lower()})
        return self._format(doc)

    def find_by_username(self, username: str) -> Optional[dict]:
        doc = self.collection.find_one({"username": username})
        return self._format(doc)

    def find_by_id(self, user_id: str) -> Optional[dict]:
        query = {"_id": ObjectId(user_id)} if ObjectId.is_valid(user_id) else {"_id": user_id}
        doc = self.collection.find_one(query)
        return self._format(doc)

    def create_user(self, user_data: dict) -> dict:
        doc = {
            "email": user_data["email"].lower(),
            "username": user_data["username"],
            "full_name": user_data.get("full_name"),
            "hashed_password": user_data["hashed_password"],
            "is_active": True,
            "created_at": datetime.now(timezone.utc),
        }
        res = self.collection.insert_one(doc)
        doc["_id"] = res.inserted_id
        return self._format(doc)

    def count_users(self) -> int:
        return self.collection.count_documents({})

    def seed_demo(self):
        pass

    def _format(self, doc: Optional[dict]) -> Optional[dict]:
        if not doc:
            return None
        created_at = doc.get("created_at")
        if isinstance(created_at, datetime):
            created_str = created_at.isoformat()
        else:
            created_str = str(created_at) if created_at else None
        return {
            "id": str(doc["_id"]),
            "email": doc["email"],
            "username": doc["username"],
            "full_name": doc.get("full_name"),
            "hashed_password": doc.get("hashed_password"),
            "is_active": doc.get("is_active", True),
            "created_at": created_str,
        }


# ---------------------------------------------------------------------------
# Local SQLite Auth Backend (Fallback)
# ---------------------------------------------------------------------------

class LocalAuthBackend:
    """Local SQLite persistent fallback for sododb.auth."""

    def __init__(self, db_path: Path):
        self.db_path = str(db_path)
        conn = self._conn()
        with conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS auth (
                    id TEXT PRIMARY KEY,
                    email TEXT UNIQUE NOT NULL COLLATE NOCASE,
                    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
                    full_name TEXT,
                    hashed_password TEXT NOT NULL,
                    is_active INTEGER NOT NULL DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
        conn.close()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def find_by_login(self, login_id: str) -> Optional[dict]:
        conn = self._conn()
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM auth WHERE email = ? OR username = ?",
            (login_id.lower(), login_id),
        )
        row = cur.fetchone()
        conn.close()
        return dict(row) if row else None

    def find_by_email(self, email: str) -> Optional[dict]:
        conn = self._conn()
        cur = conn.cursor()
        cur.execute("SELECT * FROM auth WHERE email = ?", (email.lower(),))
        row = cur.fetchone()
        conn.close()
        return dict(row) if row else None

    def find_by_username(self, username: str) -> Optional[dict]:
        conn = self._conn()
        cur = conn.cursor()
        cur.execute("SELECT * FROM auth WHERE username = ?", (username,))
        row = cur.fetchone()
        conn.close()
        return dict(row) if row else None

    def find_by_id(self, user_id: str) -> Optional[dict]:
        conn = self._conn()
        cur = conn.cursor()
        cur.execute("SELECT * FROM auth WHERE id = ?", (str(user_id),))
        row = cur.fetchone()
        conn.close()
        return dict(row) if row else None

    def create_user(self, user_data: dict) -> dict:
        user_id = str(uuid.uuid4())[:8]
        conn = self._conn()
        with conn:
            conn.execute(
                """
                INSERT INTO auth (id, email, username, full_name, hashed_password, is_active)
                VALUES (?, ?, ?, ?, ?, 1)
                """,
                (
                    user_id,
                    user_data["email"].lower(),
                    user_data["username"],
                    user_data.get("full_name"),
                    user_data["hashed_password"],
                ),
            )
        conn.close()
        return self.find_by_id(user_id)

    def count_users(self) -> int:
        conn = self._conn()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) as count FROM auth")
        row = cur.fetchone()
        conn.close()
        return row["count"] if row else 0

    def seed_demo(self):
        pass


# ---------------------------------------------------------------------------
# Database Schema & Initialization
# ---------------------------------------------------------------------------

def init_postgres_schema(pg_conn):
    """
    Initializes PostgreSQL tables and views for Sodo Player:
    - users: adds is_active column if missing
    - auth: creates backward-compatible view
    - folders: creates hierarchical folders table & indexes
    - playlist_items: creates playlist table & indexes
    Strictly NO dummy starter data is inserted.
    """
    with pg_conn:
        with pg_conn.cursor() as cur:
            # 1. users / auth view
            cur.execute("""
                ALTER TABLE users 
                ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
            """)
            cur.execute("""
                CREATE OR REPLACE VIEW auth AS 
                SELECT 
                    id::text AS id, 
                    email, 
                    username, 
                    display_name AS full_name, 
                    password_hash AS hashed_password, 
                    is_active, 
                    created_at 
                FROM users;
            """)

            # 2. folders table
            cur.execute("""
                CREATE TABLE IF NOT EXISTS folders (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL DEFAULT 'default',
                    path TEXT NOT NULL,
                    name TEXT NOT NULL,
                    parent_path TEXT NOT NULL DEFAULT '',
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT uniq_folders_user_path UNIQUE(user_id, path)
                );
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_folders_user_path ON folders(user_id, path);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_folders_user_parent ON folders(user_id, parent_path);")

            # 3. playlist_items table
            cur.execute("""
                CREATE TABLE IF NOT EXISTS playlist_items (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL DEFAULT 'default',
                    video_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    thumbnail TEXT NOT NULL,
                    channel TEXT NOT NULL,
                    duration TEXT NOT NULL DEFAULT '',
                    views TEXT NOT NULL DEFAULT '',
                    folder_path TEXT NOT NULL,
                    is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
                    download_status TEXT NOT NULL DEFAULT 'not_downloaded',
                    local_file TEXT DEFAULT '',
                    download_progress REAL DEFAULT 0.0,
                    last_accessed TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    added_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT uniq_items_user_video UNIQUE(user_id, video_id)
                );
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_items_user_folder ON playlist_items(user_id, folder_path);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_items_user_fav ON playlist_items(user_id, is_favorite);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_items_user_video ON playlist_items(user_id, video_id);")


def init_library_schema(conn: Optional[Any] = None) -> None:
    """
    Ensure folders and playlist_items tables and columns exist for SQLite fallback.
    """
    global _is_postgres_active
    if _is_postgres_active:
        return

    close_when_done = False
    if conn is None:
        conn = get_db()
        close_when_done = True

    with conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS folders (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL DEFAULT 'default',
                path TEXT NOT NULL,
                name TEXT NOT NULL,
                parent_path TEXT NOT NULL DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, path)
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS playlist_items (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL DEFAULT 'default',
                video_id TEXT NOT NULL,
                title TEXT NOT NULL,
                thumbnail TEXT NOT NULL,
                channel TEXT NOT NULL,
                duration TEXT NOT NULL DEFAULT '',
                views TEXT NOT NULL DEFAULT '',
                folder_path TEXT NOT NULL,
                is_favorite INTEGER NOT NULL DEFAULT 0,
                download_status TEXT NOT NULL DEFAULT 'not_downloaded',
                local_file TEXT DEFAULT '',
                download_progress REAL DEFAULT 0.0,
                last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        cur = conn.cursor()
        cur.execute("PRAGMA table_info(playlist_items)")
        existing_cols = {col[1] for col in cur.fetchall()}

        if "download_status" not in existing_cols:
            conn.execute("ALTER TABLE playlist_items ADD COLUMN download_status TEXT NOT NULL DEFAULT 'not_downloaded'")
        if "local_file" not in existing_cols:
            conn.execute("ALTER TABLE playlist_items ADD COLUMN local_file TEXT DEFAULT ''")
        if "download_progress" not in existing_cols:
            conn.execute("ALTER TABLE playlist_items ADD COLUMN download_progress REAL DEFAULT 0.0")
        if "last_accessed" not in existing_cols:
            conn.execute("ALTER TABLE playlist_items ADD COLUMN last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP")

        cur.execute("PRAGMA table_info(folders)")
        existing_folder_cols = {col[1] for col in cur.fetchall()}
        if "parent_path" not in existing_folder_cols:
            conn.execute("ALTER TABLE folders ADD COLUMN parent_path TEXT NOT NULL DEFAULT ''")

        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_user_path ON folders(user_id, path)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_folders_user_parent ON folders(user_id, parent_path)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_items_user_folder ON playlist_items(user_id, folder_path)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_items_user_fav ON playlist_items(user_id, is_favorite)")
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_items_user_video ON playlist_items(user_id, video_id)")

    if close_when_done:
        conn.close()


def get_auth_backend():
    """Return the active auth repository (PostgreSQL users, with fallback to Mongo or SQLite)."""
    global _auth_backend
    if _auth_backend is None:
        init_db()
    return _auth_backend


def get_db():
    """
    Return a database connection wrapper.
    Uses PostgreSQL connection pool when DATABASE_URL is configured.
    Falls back gracefully to local SQLite sododb.db.
    """
    global _is_postgres_active, _pg_pool

    if _is_postgres_active and _pg_pool is not None:
        try:
            raw_conn = _pg_pool.getconn()
            return PostgresConnectionWrapper(raw_conn, pool=_pg_pool)
        except Exception as e:
            logger.warning(f"Could not borrow PostgreSQL connection from pool: {e}. Falling back to direct/local.")

    db_file = BASE_DIR / "sododb.db"
    conn = sqlite3.connect(str(db_file), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """
    Initialize database:
    1. Try Neon PostgreSQL via DATABASE_URL
    2. Fallback to MongoDB if provided
    3. Fallback to local SQLite sododb.db
    """
    global _auth_backend, _is_postgres_active, _pg_pool

    # 1. Try PostgreSQL (Neon)
    if DATABASE_URL and DATABASE_URL.strip():
        try:
            import psycopg2
            from psycopg2.pool import ThreadedConnectionPool
            from psycopg2.extras import DictCursor

            masked_url = DATABASE_URL.split("@")[-1] if "@" in DATABASE_URL else "PostgreSQL"
            logger.info(f"Connecting to PostgreSQL ({masked_url})...")

            # Initialize threaded connection pool
            _pg_pool = ThreadedConnectionPool(minconn=1, maxconn=10, dsn=DATABASE_URL)
            test_conn = _pg_pool.getconn()
            
            # Setup tables & view (without dummy starter library)
            init_postgres_schema(test_conn)
            _pg_pool.putconn(test_conn)

            _auth_backend = PostgresAuthBackend(DATABASE_URL)
            _is_postgres_active = True
            logger.info("Successfully initialized PostgreSQL (Neon) for Auth and Library storage.")
            return
        except Exception as e:
            logger.warning(f"PostgreSQL not reachable ({e}). Falling back.")
            _is_postgres_active = False

    # 2. Try MongoDB fallback
    if MONGO_URI and MONGO_URI.strip():
        try:
            logger.info(f"Attempting connection to MongoDB ({MONGO_DB_NAME}.{MONGO_AUTH_COLLECTION})...")
            _auth_backend = MongoAuthBackend(MONGO_URI, MONGO_DB_NAME, MONGO_AUTH_COLLECTION)
            init_library_schema()
            logger.info(f"Successfully connected to MongoDB {MONGO_DB_NAME}.{MONGO_AUTH_COLLECTION}")
            return
        except Exception as e:
            logger.warning(f"MongoDB not connecting right now ({e}). Continuing with local persistent storage.")

    # 3. Fallback to local persistent storage for sododb.auth and library
    local_db_file = BASE_DIR / "sododb.db"
    _auth_backend = LocalAuthBackend(local_db_file)
    init_library_schema()
    logger.info("Using local persistent storage (sododb.db). Ready.")
