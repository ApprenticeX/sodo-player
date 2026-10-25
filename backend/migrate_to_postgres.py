"""
PostgreSQL Migration & Synchronization Script for Sodo Player.
Migrates Auth and Library (Folders, Playlists, Tracks) from local SQLite to Neon PostgreSQL (HoutDB).
"""

import os
import sys
import uuid
import sqlite3
import psycopg2
from psycopg2.extras import DictCursor
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

POSTGRES_URL = (
    os.getenv("DATABASE_URL")
    or "postgresql://neondb_owner:npg_Aw3uvyE8OoWr@ep-red-brook-ay8rn3w4-pooler.c-5.us-east-2.aws.neon.tech/HoutDB?sslmode=require&channel_binding=require"
)

DEMO_PATHS = [
    "ANIME",
    "ANIME/OLD",
    "ANIME/NEW",
    "JPOP",
    "JPOP/ANIME",
    "JPOP/ANIME/2010",
    "JPOP/ANIME/2010/WINTER",
    "LO-FI",
    "LO-FI/STUDY",
    "LO-FI/CHILL",
]

DEMO_TRACKS = [
    (
        "jfKfPfyJRdk",
        "Cowboy Bebop - Tank! (Theme Song)",
        "https://i.ytimg.com/vi/jfKfPfyJRdk/hqdefault.jpg",
        "Seatbelts",
        "3:30",
        "18M views",
        "ANIME/OLD",
        True,
    ),
    (
        "ebfZkFpE8fU",
        "Neon Genesis Evangelion - A Cruel Angel's Thesis",
        "https://i.ytimg.com/vi/ebfZkFpE8fU/hqdefault.jpg",
        "Yoko Takahashi",
        "4:05",
        "45M views",
        "ANIME/OLD",
        True,
    ),
    (
        "G8Z0G_z5RkY",
        "Jujutsu Kaisen - SPECIALZ (King Gnu)",
        "https://i.ytimg.com/vi/G8Z0G_z5RkY/hqdefault.jpg",
        "King Gnu Official",
        "3:55",
        "85M views",
        "ANIME/NEW",
        True,
    ),
    (
        "1FliVTcX8bQ",
        "Chainsaw Man - KICK BACK (Kenshi Yonezu)",
        "https://i.ytimg.com/vi/1FliVTcX8bQ/hqdefault.jpg",
        "Kenshi Yonezu",
        "3:14",
        "120M views",
        "ANIME/NEW",
        False,
    ),
    (
        "x_5pZ7L3n0g",
        "Oshi no Ko - Idol (YOASOBI)",
        "https://i.ytimg.com/vi/x_5pZ7L3n0g/hqdefault.jpg",
        "Ayase / YOASOBI",
        "3:33",
        "490M views",
        "ANIME/NEW",
        True,
    ),
    (
        "rS0v0wP7e04",
        "Bakemonogatari - Kimi no Shiranai Monogatari",
        "https://i.ytimg.com/vi/rS0v0wP7e04/hqdefault.jpg",
        "supercell",
        "5:40",
        "32M views",
        "JPOP/ANIME/2010/WINTER",
        True,
    ),
    (
        "9sK7VdZ0Z3k",
        "Durarara!! Opening 1 - Uragiri no Yuuyake",
        "https://i.ytimg.com/vi/9sK7VdZ0Z3k/hqdefault.jpg",
        "THEATRE BROOK",
        "3:22",
        "12M views",
        "JPOP/ANIME/2010/WINTER",
        False,
    ),
    (
        "5qap5aO4i9A",
        "Lofi Hip Hop Radio - Beats to Relax/Study to",
        "https://i.ytimg.com/vi/5qap5aO4i9A/hqdefault.jpg",
        "Lofi Girl",
        "LIVE",
        "42K watching",
        "LO-FI/STUDY",
        True,
    ),
    (
        "DWcJFNfaw9c",
        "Chillhop Essentials - Spring 2026",
        "https://i.ytimg.com/vi/DWcJFNfaw9c/hqdefault.jpg",
        "Chillhop Music",
        "45:12",
        "2.1M views",
        "LO-FI/STUDY",
        False,
    ),
]


def run_migration():
    print(f"Connecting to PostgreSQL: {POSTGRES_URL.split('@')[-1]}...", flush=True)
    pg_conn = psycopg2.connect(POSTGRES_URL, cursor_factory=DictCursor)
    print("Connected successfully!", flush=True)
    pg_conn.autocommit = False

    try:
        with pg_conn.cursor() as cur:
            print("\n1. Ensuring users schema has is_active and creating auth view...")
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

            print("2. Ensuring folders table and indexes exist in PostgreSQL...")
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

            print("3. Ensuring playlist_items table and indexes exist in PostgreSQL...")
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
                    is_favorite INTEGER NOT NULL DEFAULT 0,
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

        pg_conn.commit()
        print("Schema setup complete.")

        # 4. Migrate users from SQLite sododb.db & auth.db
        print("\n4. Migrating SQLite users to PostgreSQL users table...")
        sqlite_dbs = [BASE_DIR / "sododb.db", BASE_DIR / "auth.db"]
        migrated_users_count = 0

        with pg_conn.cursor() as cur:
            for sdb in sqlite_dbs:
                if not sdb.exists():
                    continue
                try:
                    sconn = sqlite3.connect(str(sdb))
                    sconn.row_factory = sqlite3.Row
                    scur = sconn.cursor()
                    # Check for auth or users table
                    scur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('auth', 'users')")
                    tbl_row = scur.fetchone()
                    if not tbl_row:
                        sconn.close()
                        continue
                    tbl_name = tbl_row[0]
                    scur.execute(f"SELECT * FROM {tbl_name}")
                    rows = scur.fetchall()
                    for r in rows:
                        email = r["email"].strip().lower() if r["email"] else None
                        username = r["username"].strip()
                        full_name = r["full_name"] if "full_name" in r.keys() else None
                        hashed_pw = r["hashed_password"] if "hashed_password" in r.keys() else None

                        # Check if user already exists in PG
                        cur.execute("SELECT id FROM users WHERE username = %s OR (email IS NOT NULL AND email = %s)", (username, email))
                        existing = cur.fetchone()
                        if not existing:
                            user_id = str(uuid.uuid4())
                            cur.execute("""
                                INSERT INTO users (id, username, email, display_name, password_hash, is_active, merit)
                                VALUES (%s, %s, %s, %s, %s, TRUE, 100)
                            """, (user_id, username, email, full_name, hashed_pw))
                            migrated_users_count += 1
                            print(f"  -> Migrated user '{username}' ({email}) to PostgreSQL")
                    sconn.close()
                except Exception as ex:
                    print(f"  Notice during SQLite read ({sdb.name}): {ex}")

        pg_conn.commit()
        print(f"Migrated {migrated_users_count} new users from SQLite.")

        # 5. Migrate folders & playlist_items from sododb.db if any exist
        print("\n5. Migrating folders and playlist items from sododb.db...")
        sodo_file = BASE_DIR / "sododb.db"
        migrated_folders = 0
        migrated_items = 0

        if sodo_file.exists():
            try:
                sconn = sqlite3.connect(str(sodo_file))
                sconn.row_factory = sqlite3.Row
                scur = sconn.cursor()

                # Folders
                scur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='folders'")
                if scur.fetchone():
                    scur.execute("SELECT * FROM folders")
                    for f in scur.fetchall():
                        with pg_conn.cursor() as cur:
                            cur.execute("""
                                INSERT INTO folders (id, user_id, path, name, parent_path)
                                VALUES (%s, %s, %s, %s, %s)
                                ON CONFLICT (user_id, path) DO NOTHING
                            """, (f["id"], f["user_id"], f["path"], f["name"], f.get("parent_path", "")))
                            if cur.rowcount > 0:
                                migrated_folders += 1

                # Playlist items
                scur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='playlist_items'")
                if scur.fetchone():
                    scur.execute("SELECT * FROM playlist_items")
                    for it in scur.fetchall():
                        with pg_conn.cursor() as cur:
                            cur.execute("""
                                INSERT INTO playlist_items (
                                    id, user_id, video_id, title, thumbnail, channel,
                                    duration, views, folder_path, is_favorite, download_status,
                                    local_file, download_progress
                                )
                                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                                ON CONFLICT (user_id, video_id) DO NOTHING
                            """, (
                                it["id"], it["user_id"], it["video_id"], it["title"],
                                it["thumbnail"], it["channel"], it.get("duration", ""),
                                it.get("views", ""), it["folder_path"], bool(it.get("is_favorite", 0)),
                                it.get("download_status", "not_downloaded"), it.get("local_file", ""),
                                float(it.get("download_progress", 0.0) or 0.0)
                            ))
                            if cur.rowcount > 0:
                                migrated_items += 1
                sconn.close()
            except Exception as e:
                print(f"Notice while reading sododb.db library data: {e}")

        pg_conn.commit()
        print(f"Migrated {migrated_folders} folders and {migrated_items} tracks from SQLite.")

        # 6. No starter library seeded as requested (clean slate for user data)
        print("\n6. Starter library seeding skipped (clean slate).")


        # 7. Print Final Status
        with pg_conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM users")
            total_users = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM folders")
            total_folders = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM playlist_items")
            total_items = cur.fetchone()[0]

            print("\n" + "=" * 50)
            print("POSTGRESQL MIGRATION SUCCESSFUL!")
            print(f"Total Users in PostgreSQL: {total_users}")
            print(f"Total Folders in PostgreSQL: {total_folders}")
            print(f"Total Playlist Items in PostgreSQL: {total_items}")
            print("=" * 50 + "\n")

    finally:
        pg_conn.close()


if __name__ == "__main__":
    run_migration()
