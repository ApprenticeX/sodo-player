"""
Command-line tool to export user data from Sodo Player (PostgreSQL or SQLite).
Usage:
    python export_user_data.py --username asim --out asim_backup.json
    python export_user_data.py --all --out all_users_backup.json
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Add backend directory to sys.path
BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))

from database import init_db, get_db, get_auth_backend


def export_single_user(user: dict, conn) -> dict:
    user_id = str(user["id"])
    cur = conn.cursor()

    # Folders
    cur.execute(
        "SELECT id, user_id, path, name, parent_path, created_at FROM folders WHERE user_id = ? ORDER BY path ASC",
        (user_id,),
    )
    folders = []
    for r in cur.fetchall():
        d = dict(r)
        cat = d.get("created_at")
        d["created_at"] = cat.isoformat() if hasattr(cat, "isoformat") else str(cat) if cat else None
        folders.append(d)

    # Songs
    cur.execute(
        """
        SELECT id, user_id, video_id, title, thumbnail, channel, duration,
               views, folder_path, is_favorite, download_status, local_file,
               download_progress, last_accessed, added_at
        FROM playlist_items
        WHERE user_id = ?
        ORDER BY added_at DESC
        """,
        (user_id,),
    )
    items = []
    fav_count = 0
    dl_count = 0

    for r in cur.fetchall():
        d = dict(r)
        d["is_favorite"] = bool(d.get("is_favorite", False))
        if d["is_favorite"]:
            fav_count += 1
        if d.get("download_status") == "completed":
            dl_count += 1

        added_at = d.get("added_at")
        d["added_at"] = added_at.isoformat() if hasattr(added_at, "isoformat") else str(added_at) if added_at else None

        last_acc = d.get("last_accessed")
        d["last_accessed"] = last_acc.isoformat() if hasattr(last_acc, "isoformat") else str(last_acc) if last_acc else None

        items.append(d)

    return {
        "version": "1.0.0",
        "system": "sodo-player",
        "format": "sodo_user_export_v1",
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "user": {
            "id": user_id,
            "username": user.get("username", ""),
            "email": user.get("email"),
            "full_name": user.get("full_name"),
            "created_at": user.get("created_at"),
        },
        "stats": {
            "total_folders": len(folders),
            "total_songs": len(items),
            "total_favorites": fav_count,
            "downloaded_songs": dl_count,
        },
        "folders": folders,
        "playlist_items": items,
    }


def main():
    parser = argparse.ArgumentParser(description="Export Sodo Player user data to JSON.")
    parser.add_argument("--username", help="Username of the user to export")
    parser.add_argument("--all", action="store_true", help="Export all users")
    parser.add_argument("--out", "-o", default=None, help="Output JSON file path")
    args = parser.parse_args()

    init_db()
    auth_db = get_auth_backend()
    conn = get_db()

    try:
        if args.all:
            # Query all users
            cur = conn.cursor()
            cur.execute("SELECT id, username, email FROM users")
            all_users = cur.fetchall()
            print(f"Exporting all users ({len(all_users)} total)...")
            all_exports = []
            for u in all_users:
                user_record = auth_db.find_by_id(u["id"])
                if user_record:
                    all_exports.append(export_single_user(user_record, conn))

            payload = {
                "version": "1.0.0",
                "system": "sodo-player",
                "format": "sodo_multi_user_export_v1",
                "exported_at": datetime.now(timezone.utc).isoformat(),
                "users_count": len(all_exports),
                "users": all_exports,
            }
            output_path = args.out or "all_users_export.json"
        else:
            uname = args.username or "asim"
            user = auth_db.find_by_username(uname) or auth_db.find_by_email(uname)
            if not user:
                print(f"Error: User '{uname}' not found.")
                sys.exit(1)
            print(f"Exporting data for user '{user['username']}' ({user['id']})...")
            payload = export_single_user(user, conn)
            output_path = args.out or f"sodo_export_{user['username']}.json"

        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, default=str)

        print(f"Successfully exported data to: {output_path}")

    finally:
        conn.close()


if __name__ == "__main__":
    main()
