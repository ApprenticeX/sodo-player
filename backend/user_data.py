"""
User Data Export & Import API for Sodo Player.
Provides structured JSON export of all user profile, folder hierarchy, and song data,
enabling effortless backup and future migration to Go (or other microservice backends).
"""

import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field

from auth import get_current_user
from database import get_db
from logger import get_logger

logger = get_logger("sodo.userdata")
router = APIRouter(prefix="/api/user", tags=["User Data & Migration"])


# ---------------------------------------------------------------------------
# Pydantic Schemas for Type Safety & OpenAPI Documentation
# ---------------------------------------------------------------------------

class UserExportProfile(BaseModel):
    id: str
    username: str
    email: Optional[str] = None
    full_name: Optional[str] = None
    created_at: Optional[str] = None


class FolderExportItem(BaseModel):
    id: str
    user_id: str
    path: str
    name: str
    parent_path: str = ""
    created_at: Optional[str] = None


class PlaylistItemExportItem(BaseModel):
    id: str
    user_id: str
    video_id: str
    title: str
    thumbnail: str
    channel: str
    duration: str = ""
    views: str = ""
    folder_path: str
    is_favorite: bool = False
    download_status: str = "not_downloaded"
    local_file: Optional[str] = ""
    download_progress: Optional[float] = 0.0
    last_accessed: Optional[str] = None
    added_at: Optional[str] = None
    youtube_url: Optional[str] = None
    url: Optional[str] = None


class ExportStats(BaseModel):
    total_folders: int
    total_songs: int
    total_favorites: int
    downloaded_songs: int


class UserDataExportResponse(BaseModel):
    version: str = "1.0.0"
    system: str = "sodo-player"
    format: str = "sodo_user_export_v1"
    exported_at: str
    user: UserExportProfile
    stats: ExportStats
    folders: List[FolderExportItem]
    playlist_items: List[PlaylistItemExportItem]


# ---------------------------------------------------------------------------
# Export Endpoint Implementation
# ---------------------------------------------------------------------------

def _fetch_user_data(user: dict) -> dict:
    """Internal helper to retrieve all folders and playlist_items for the user."""
    user_id = str(user["id"])
    conn = get_db()
    try:
        cur = conn.cursor()

        # 1. Fetch all folders belonging to this user
        cur.execute(
            "SELECT id, user_id, path, name, parent_path, created_at FROM folders WHERE user_id = ? ORDER BY path ASC",
            (user_id,),
        )
        folder_rows = cur.fetchall()
        folders = []
        for r in folder_rows:
            d = dict(r)
            cat = d.get("created_at")
            d["created_at"] = cat.isoformat() if hasattr(cat, "isoformat") else str(cat) if cat else None
            folders.append(d)

        # 2. Fetch all playlist items belonging to this user
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
        item_rows = cur.fetchall()
        items = []
        fav_count = 0
        dl_count = 0

        for r in item_rows:
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

            # Include stable YouTube URLs
            vid = d.get("video_id", "")
            d["youtube_url"] = f"https://www.youtube.com/watch?v={vid}" if vid else ""
            d["url"] = f"https://www.youtube.com/watch?v={vid}" if vid else ""

            items.append(d)

        export_payload = {
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
        return export_payload
    finally:
        conn.close()


@router.get("/data", response_model=UserDataExportResponse)
@router.get("/data/export", response_model=UserDataExportResponse)
def export_user_data(
    download: bool = Query(False, description="Whether to trigger a file download attachment"),
    pretty: bool = Query(False, description="Format JSON with indentation"),
    current_user: dict = Depends(get_current_user),
):
    """
    Exports the complete dataset for the authenticated user:
    - User profile details
    - Complete folder hierarchy
    - All tracks, metadata, favorites, and download states
    
    If ?download=true is passed, returns a downloadable .json file.
    Designed for seamless deserialization in Go backends.
    """
    payload = _fetch_user_data(current_user)
    logger.info(
        f"Exported data for user '{current_user.get('username')}' (ID: {current_user.get('id')}): "
        f"{payload['stats']['total_folders']} folders, {payload['stats']['total_songs']} songs (download={download})"
    )

    if download:
        username = current_user.get("username", "user")
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        filename = f"sodo_export_{username}_{timestamp}.json"
        indent = 2 if pretty else None
        json_content = json.dumps(payload, indent=indent, default=str)
        return Response(
            content=json_content,
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    return payload


@router.get("/data/stats")
def get_user_stats(current_user: dict = Depends(get_current_user)):
    """Quick summary stats of the user's library and account."""
    user_id = str(current_user["id"])
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) as count FROM folders WHERE user_id = ?", (user_id,))
        folder_cnt = cur.fetchone()["count"]

        cur.execute("SELECT COUNT(*) as total, SUM(CASE WHEN is_favorite THEN 1 ELSE 0 END) as favs FROM playlist_items WHERE user_id = ?", (user_id,))
        song_row = cur.fetchone()
        song_cnt = song_row["total"] or 0
        fav_cnt = song_row["favs"] or 0

        return {
            "user_id": user_id,
            "username": current_user.get("username"),
            "total_folders": folder_cnt,
            "total_songs": song_cnt,
            "total_favorites": fav_cnt,
        }
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Optional Import Endpoint for Restoring / Migrating Data
# ---------------------------------------------------------------------------

class ImportDataRequest(BaseModel):
    folders: List[FolderExportItem] = []
    playlist_items: List[PlaylistItemExportItem] = []


@router.post("/data/import", status_code=status.HTTP_200_OK)
def import_user_data(
    req: ImportDataRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Imports folders and playlist tracks into the authenticated user's account.
    Avoids duplicate entries and preserves hierarchy.
    """
    user_id = str(current_user["id"])
    conn = get_db()
    imported_folders = 0
    imported_songs = 0

    try:
        with conn:
            for f in req.folders:
                cur = conn.execute(
                    """
                    INSERT OR IGNORE INTO folders (id, user_id, path, name, parent_path)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (f.id, user_id, f.path, f.name, f.parent_path),
                )
                if cur.rowcount > 0:
                    imported_folders += 1

            for s in req.playlist_items:
                cur = conn.execute(
                    """
                    INSERT INTO playlist_items (
                        id, user_id, video_id, title, thumbnail, channel,
                        duration, views, folder_path, is_favorite, download_status,
                        local_file, download_progress
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT (user_id, video_id) DO NOTHING
                    """,
                    (
                        s.id, user_id, s.video_id, s.title, s.thumbnail, s.channel,
                        s.duration, s.views, s.folder_path, s.is_favorite,
                        s.download_status, s.local_file or "", s.download_progress or 0.0,
                    ),
                )
                if cur.rowcount > 0:
                    imported_songs += 1

        return {
            "status": "success",
            "message": f"Successfully imported {imported_folders} folders and {imported_songs} songs.",
            "imported_folders": imported_folders,
            "imported_songs": imported_songs,
        }
    finally:
        conn.close()
