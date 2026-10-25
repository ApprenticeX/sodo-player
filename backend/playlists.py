import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from config import BASE_DIR
from database import get_db, init_library_schema
from auth import get_current_user
from logger import get_logger

logger = get_logger("sodo.playlists")
router = APIRouter(prefix="/api/playlists", tags=["Playlists"])


def get_active_user_id(
    current_user: dict = Depends(get_current_user),
) -> str:
    """
    Return authenticated user ID if a valid JWT Bearer token is provided.
    Strictly account-scoped: rejects unauthenticated requests with HTTP 401 Unauthorized.
    Guarantees every user's playlists are completely isolated to their account.
    """
    if not current_user or "id" not in current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please log in to manage your playlists.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return str(current_user["id"])


def clean_path(raw_path: str) -> str:
    """Normalize folder path: removes extra slashes, trims segments, uppercases."""
    if not raw_path:
        return ""
    norm = raw_path.replace("\\", "/").strip()
    if norm.upper() in ["ALL", "FAVORITES", "FAVORITE"]:
        return "FAVORITES" if norm.upper() in ["FAVORITES", "FAVORITE"] else "ALL"
    parts = [p.strip().upper() for p in norm.split("/") if p.strip()]
    return "/".join(parts)


def ensure_folder_hierarchy(conn: sqlite3.Connection, user_id: str, path: str):
    """Ensure a path and all its ancestor intermediate folders exist in DB for user_id."""
    clean = clean_path(path)
    if not clean or clean in ["ALL", "FAVORITES", "FAVORITE"]:
        return
    parts = clean.split("/")
    accum = []
    with conn:
        for segment in parts:
            accum.append(segment)
            current_path = "/".join(accum)
            parent = "/".join(accum[:-1])
            folder_id = str(uuid.uuid4())[:8]
            conn.execute(
                """
                INSERT OR IGNORE INTO folders (id, user_id, path, name, parent_path)
                VALUES (?, ?, ?, ?, ?)
                """,
                (folder_id, user_id, current_path, segment, parent),
            )


def format_item_row(row: sqlite3.Row) -> dict:
    """Format a playlist_items SQLite row to a clean dict with types."""
    d = dict(row)
    d["is_favorite"] = bool(d.get("is_favorite", 0))
    if "download_status" not in d or d["download_status"] is None:
        d["download_status"] = "not_downloaded"
    return d


def init_playlist_tables():
    """Initializes tables and schema migrations without seeding any dummy data."""
    conn = get_db()
    init_library_schema(conn)
    conn.close()


# Pydantic Schemas
class CreateFolderRequest(BaseModel):
    path: str = Field(..., min_length=1, description="Path e.g. ANIME/NEW or JPOP/ANIME/2010/WINTER")
    user_id: Optional[str] = None


class RenameFolderRequest(BaseModel):
    old_path: str = Field(..., min_length=1, description="Existing folder path to rename")
    new_name: Optional[str] = Field(None, description="New folder name segment (e.g. 'ANIMATION')")
    new_path: Optional[str] = Field(None, description="Full new folder path (e.g. 'ANIME/ANIMATION')")
    user_id: Optional[str] = None


class MoveFolderRequest(BaseModel):
    source_path: Optional[str] = Field(None, description="Path of the folder to move")
    new_parent_path: Optional[str] = Field("", description="New parent folder path, or empty string for root")
    path: Optional[str] = None  # alias for source_path
    target_parent_path: Optional[str] = None  # alias for new_parent_path
    destination_path: Optional[str] = None  # alias for target path
    user_id: Optional[str] = None


class AddPlaylistItemRequest(BaseModel):
    video_id: str
    title: str
    thumbnail: str
    channel: str
    duration: Optional[str] = ""
    views: Optional[str] = ""
    folder_path: str = Field(..., description="Target folder path e.g. ANIME/OLD")
    is_favorite: Optional[bool] = False
    download_status: Optional[str] = "not_downloaded"
    local_file: Optional[str] = None
    user_id: Optional[str] = None


class MovePlaylistItemRequest(BaseModel):
    target_folder_path: Optional[str] = Field(None, description="Target folder path")
    folder_path: Optional[str] = Field(None, description="Target folder path alias")
    user_id: Optional[str] = None


class ToggleFavoriteRequest(BaseModel):
    item_id: str
    user_id: Optional[str] = None


# API Routes

@router.get("/tree")
def get_folder_tree(user_id: str = Depends(get_active_user_id)):
    """
    Returns the complete list of folders and paths, along with song counts.
    Strictly isolated to user_id.
    """
    conn = get_db()
    cur = conn.cursor()

    # Get all folders for this user
    cur.execute(
        "SELECT id, path, name, parent_path, created_at FROM folders WHERE user_id = ? ORDER BY path ASC",
        (user_id,),
    )
    folders = [dict(r) for r in cur.fetchall()]

    # Get direct counts per folder for this user
    cur.execute(
        "SELECT folder_path, COUNT(*) as cnt FROM playlist_items WHERE user_id = ? GROUP BY folder_path",
        (user_id,),
    )
    direct_counts = {r["folder_path"]: r["cnt"] for r in cur.fetchall()}

    # Calculate recursive count for each folder
    for f in folders:
        f_path = f["path"]
        f["direct_count"] = direct_counts.get(f_path, 0)
        cur.execute(
            """
            SELECT COUNT(*) as rec_cnt FROM playlist_items
            WHERE user_id = ? AND (folder_path = ? OR folder_path LIKE ?)
            """,
            (user_id, f_path, f_path + "/%"),
        )
        rec_cnt = cur.fetchone()["rec_cnt"]
        f["recursive_count"] = rec_cnt
        f["song_count"] = rec_cnt

    # System counts: ALL & FAVORITES for this user
    cur.execute("SELECT COUNT(*) as total FROM playlist_items WHERE user_id = ?", (user_id,))
    total_count = cur.fetchone()["total"]

    cur.execute(
        "SELECT COUNT(*) as fav_cnt FROM playlist_items WHERE user_id = ? AND is_favorite = 1",
        (user_id,),
    )
    favorite_count = cur.fetchone()["fav_cnt"]

    conn.close()

    logger.debug(f"Fetched folder tree for user '{user_id}': {len(folders)} folders, {total_count} songs")
    return {
        "user_id": user_id,
        "folders": folders,
        "total_songs": total_count,
        "favorite_songs": favorite_count,
    }


@router.get("/folder")
def get_folder_contents(
    path: str = Query("ALL", description="Folder path or ALL or FAVORITES"),
    q: Optional[str] = Query(None, description="Optional search filter within folder"),
    user_id: str = Depends(get_active_user_id),
):
    """
    Dual folder contents:
    1. Direct child subfolders at the top (with direct & recursive song counts).
    2. All child songs (recursive aggregation of entire subtree) underneath.
    Strictly isolated to user_id.
    """
    raw_norm = clean_path(path)
    if raw_norm in ["FAVORITE", "FAVORITES"]:
        normalized_path = "FAVORITES"
    elif raw_norm in ["ALL", ""] or not path or path.strip().upper() == "ALL":
        normalized_path = "ALL"
    else:
        normalized_path = raw_norm

    conn = get_db()
    cur = conn.cursor()

    subfolders = []
    videos = []

    # 1. System: FAVORITES
    if normalized_path == "FAVORITES":
        sql = "SELECT * FROM playlist_items WHERE user_id = ? AND is_favorite = 1"
        params: List[Any] = [user_id]
        if q and q.strip():
            clean_q = q.strip()
            sql += " AND (title LIKE ? OR channel LIKE ? OR folder_path LIKE ?)"
            params.extend([f"%{clean_q}%", f"%{clean_q}%", f"%{clean_q}%"])
        sql += " ORDER BY added_at DESC"
        cur.execute(sql, params)
        videos = [format_item_row(r) for r in cur.fetchall()]
        subfolders = []

    # 2. System: ALL (Root library view)
    elif normalized_path == "ALL":
        # Direct root folders (parent_path == '')
        cur.execute(
            "SELECT id, path, name, parent_path FROM folders WHERE user_id = ? AND parent_path = '' ORDER BY name ASC",
            (user_id,),
        )
        db_subfolders = [dict(r) for r in cur.fetchall()]

        # Prepend FAVORITES as the first top-level system folder
        cur.execute(
            "SELECT COUNT(*) as fav_cnt FROM playlist_items WHERE user_id = ? AND is_favorite = 1",
            (user_id,),
        )
        fav_count = cur.fetchone()["fav_cnt"]
        subfolders = [
            {
                "id": "system_favorites",
                "path": "FAVORITES",
                "name": "⭐ FAVORITES",
                "parent_path": "",
                "is_system": True,
                "song_count": fav_count,
                "direct_count": fav_count,
                "recursive_count": fav_count,
            }
        ] + db_subfolders

        # All videos across all folders for this user (Single song record in DB per user)
        sql = "SELECT * FROM playlist_items WHERE user_id = ?"
        params = [user_id]
        if q and q.strip():
            clean_q = q.strip()
            sql += " AND (title LIKE ? OR channel LIKE ? OR folder_path LIKE ?)"
            params.extend([f"%{clean_q}%", f"%{clean_q}%", f"%{clean_q}%"])
        sql += " ORDER BY added_at DESC"
        cur.execute(sql, params)
        videos = [format_item_row(r) for r in cur.fetchall()]

    # 3. Custom Hierarchical Folder (e.g. ANIME, JPOP/ANIME, etc.)
    else:
        # Direct child subfolders: parent_path == normalized_path
        cur.execute(
            "SELECT id, path, name, parent_path FROM folders WHERE user_id = ? AND parent_path = ? ORDER BY name ASC",
            (user_id, normalized_path),
        )
        subfolders = [dict(r) for r in cur.fetchall()]

        # All Child Songs (RECURSIVE AGGREGATION)
        # Includes direct items in this folder + all items in any descendant subfolders!
        sql = """
            SELECT * FROM playlist_items
            WHERE user_id = ? AND (folder_path = ? OR folder_path LIKE ?)
        """
        params = [user_id, normalized_path, normalized_path + "/%"]
        if q and q.strip():
            clean_q = q.strip()
            sql += " AND (title LIKE ? OR channel LIKE ? OR folder_path LIKE ?)"
            params.extend([f"%{clean_q}%", f"%{clean_q}%", f"%{clean_q}%"])
        sql += " ORDER BY added_at DESC"
        cur.execute(sql, params)
        videos = [format_item_row(r) for r in cur.fetchall()]

    # Attach counts to child subfolders
    for sf in subfolders:
        if not sf.get("is_system"):
            sf_path = sf["path"]
            cur.execute(
                "SELECT COUNT(*) as d_cnt FROM playlist_items WHERE user_id = ? AND folder_path = ?",
                (user_id, sf_path),
            )
            d_cnt = cur.fetchone()["d_cnt"]
            cur.execute(
                """
                SELECT COUNT(*) as rec_cnt FROM playlist_items
                WHERE user_id = ? AND (folder_path = ? OR folder_path LIKE ?)
                """,
                (user_id, sf_path, sf_path + "/%"),
            )
            rec_cnt = cur.fetchone()["rec_cnt"]
            sf["direct_count"] = d_cnt
            sf["recursive_count"] = rec_cnt
            sf["song_count"] = rec_cnt

    conn.close()

    # Path tags breakdown
    if normalized_path in ["ALL", "FAVORITES"]:
        path_tags = [normalized_path]
    else:
        path_tags = normalized_path.split("/")

    return {
        "user_id": user_id,
        "path": normalized_path,
        "path_tags": path_tags,
        "subfolders": subfolders,
        "videos": videos,
        "total_videos": len(videos),
    }


@router.post("/folders")
def create_folder(req: CreateFolderRequest, user_id: str = Depends(get_active_user_id)):
    """
    Creates a hierarchical folder or full path (e.g. JPOP/ANIME/2010/WINTER).
    Automatically creates all intermediate parent folders for user_id.
    """
    norm = clean_path(req.path)
    if not norm or norm in ["ALL", "FAVORITES", "FAVORITE"]:
        raise HTTPException(status_code=400, detail="Invalid folder path or reserved name.")

    conn = get_db()
    ensure_folder_hierarchy(conn, user_id, norm)
    conn.close()

    logger.info(f"User '{user_id}' created folder '{norm}'")
    return {
        "status": "success",
        "user_id": user_id,
        "path": norm,
        "message": f"Folder '{norm}' and hierarchy created successfully.",
    }


@router.api_route("/folders/rename", methods=["PUT", "POST"])
def rename_folder(req: RenameFolderRequest, user_id: str = Depends(get_active_user_id)):
    """
    Renames a folder and atomically updates all child subfolder paths and song folder_paths.
    """
    old_path = clean_path(req.old_path)
    if not old_path or old_path in ["ALL", "FAVORITES", "FAVORITE"]:
        raise HTTPException(status_code=400, detail="Cannot rename system folders.")

    conn = get_db()
    cur = conn.cursor()

    # Verify old folder exists
    cur.execute(
        "SELECT id, name, parent_path FROM folders WHERE user_id = ? AND path = ?",
        (user_id, old_path),
    )
    folder_row = cur.fetchone()
    if not folder_row:
        conn.close()
        raise HTTPException(status_code=404, detail=f"Folder '{old_path}' not found.")

    # Determine target new path
    if req.new_name and req.new_name.strip():
        clean_name = req.new_name.strip().replace("/", "").replace("\\", "").upper()
        if not clean_name:
            conn.close()
            raise HTTPException(status_code=400, detail="Invalid new folder name.")
        parent = folder_row["parent_path"]
        new_path = f"{parent}/{clean_name}" if parent else clean_name
    elif req.new_path and req.new_path.strip():
        new_path = clean_path(req.new_path)
    else:
        conn.close()
        raise HTTPException(status_code=400, detail="Either 'new_name' or 'new_path' must be provided.")

    if new_path in ["ALL", "FAVORITES", "FAVORITE"]:
        conn.close()
        raise HTTPException(status_code=400, detail="Cannot use reserved name for folder.")

    if new_path == old_path:
        conn.close()
        return {
            "status": "success",
            "old_path": old_path,
            "new_path": new_path,
            "message": "Folder name unchanged.",
        }

    # Circular rename check (cannot rename a folder into its own subfolder)
    if new_path.startswith(old_path + "/"):
        conn.close()
        raise HTTPException(status_code=400, detail="Cannot rename folder into its own descendant subfolder.")

    # Check if target new_path already exists
    cur.execute("SELECT id FROM folders WHERE user_id = ? AND path = ?", (user_id, new_path))
    if cur.fetchone():
        conn.close()
        raise HTTPException(status_code=409, detail=f"Folder '{new_path}' already exists.")

    new_name = new_path.split("/")[-1]
    new_parent = "/".join(new_path.split("/")[:-1])

    # If new_parent is non-empty, ensure intermediate parents exist
    if new_parent:
        ensure_folder_hierarchy(conn, user_id, new_parent)

    with conn:
        # 1. Update the folder itself
        conn.execute(
            "UPDATE folders SET path = ?, name = ?, parent_path = ? WHERE id = ? AND user_id = ?",
            (new_path, new_name, new_parent, folder_row["id"], user_id),
        )

        # 2. Update all descendant subfolders
        cur.execute(
            "SELECT id, path FROM folders WHERE user_id = ? AND path LIKE ?",
            (user_id, old_path + "/%"),
        )
        child_folders = cur.fetchall()
        for ch in child_folders:
            ch_old_path = ch["path"]
            ch_new_path = new_path + ch_old_path[len(old_path):]
            ch_new_parent = "/".join(ch_new_path.split("/")[:-1])
            conn.execute(
                "UPDATE folders SET path = ?, parent_path = ? WHERE id = ? AND user_id = ?",
                (ch_new_path, ch_new_parent, ch["id"], user_id),
            )

        # 3. Update all songs residing in this folder or any descendant subfolder
        cur.execute(
            "SELECT id, folder_path FROM playlist_items WHERE user_id = ? AND (folder_path = ? OR folder_path LIKE ?)",
            (user_id, old_path, old_path + "/%"),
        )
        items = cur.fetchall()
        for item in items:
            item_fp = item["folder_path"]
            if item_fp == old_path:
                updated_fp = new_path
            else:
                updated_fp = new_path + item_fp[len(old_path):]
            conn.execute(
                "UPDATE playlist_items SET folder_path = ? WHERE id = ? AND user_id = ?",
                (updated_fp, item["id"], user_id),
            )

    conn.close()

    logger.info(f"User '{user_id}' renamed folder '{old_path}' -> '{new_path}'")
    return {
        "status": "success",
        "user_id": user_id,
        "old_path": old_path,
        "new_path": new_path,
        "message": f"Successfully renamed folder '{old_path}' to '{new_path}'.",
    }


@router.api_route("/folders/move", methods=["PUT", "POST"])
def move_folder(req: MoveFolderRequest, user_id: str = Depends(get_active_user_id)):
    """
    Moves a folder hierarchy to a new parent path (or root).
    Atomically updates all child subpaths and song folder_paths. Prevents cyclical nesting.
    """
    raw_source = req.source_path or req.path or ""
    source_path = clean_path(raw_source)
    if not source_path or source_path in ["ALL", "FAVORITES", "FAVORITE"]:
        raise HTTPException(status_code=400, detail="Cannot move system folders.")

    conn = get_db()
    cur = conn.cursor()

    cur.execute(
        "SELECT id, name, parent_path FROM folders WHERE user_id = ? AND path = ?",
        (user_id, source_path),
    )
    folder_row = cur.fetchone()
    if not folder_row:
        conn.close()
        raise HTTPException(status_code=404, detail=f"Source folder '{source_path}' not found.")

    raw_new_parent = req.new_parent_path if req.new_parent_path is not None else (req.target_parent_path or "")
    clean_parent = clean_path(raw_new_parent) if raw_new_parent.strip().upper() not in ["ALL", "ROOT", "/"] else ""

    folder_name = source_path.split("/")[-1]
    dest_path = f"{clean_parent}/{folder_name}" if clean_parent else folder_name

    # Prevent moving into itself or its own descendants
    if clean_parent == source_path or clean_parent.startswith(source_path + "/"):
        conn.close()
        raise HTTPException(status_code=400, detail="Cannot move a folder into itself or its own subfolder.")

    if dest_path == source_path:
        conn.close()
        return {
            "status": "success",
            "source_path": source_path,
            "destination_path": dest_path,
            "message": "Folder is already at this destination.",
        }

    # Check collision at destination
    cur.execute("SELECT id FROM folders WHERE user_id = ? AND path = ?", (user_id, dest_path))
    if cur.fetchone():
        conn.close()
        raise HTTPException(status_code=409, detail=f"A folder already exists at '{dest_path}'.")

    if clean_parent:
        ensure_folder_hierarchy(conn, user_id, clean_parent)

    with conn:
        # 1. Update the moved folder
        conn.execute(
            "UPDATE folders SET path = ?, parent_path = ? WHERE id = ? AND user_id = ?",
            (dest_path, clean_parent, folder_row["id"], user_id),
        )

        # 2. Update descendant subfolders
        cur.execute(
            "SELECT id, path FROM folders WHERE user_id = ? AND path LIKE ?",
            (user_id, source_path + "/%"),
        )
        child_folders = cur.fetchall()
        for ch in child_folders:
            ch_old_path = ch["path"]
            ch_new_path = dest_path + ch_old_path[len(source_path):]
            ch_new_parent = "/".join(ch_new_path.split("/")[:-1])
            conn.execute(
                "UPDATE folders SET path = ?, parent_path = ? WHERE id = ? AND user_id = ?",
                (ch_new_path, ch_new_parent, ch["id"], user_id),
            )

        # 3. Update song folder paths
        cur.execute(
            "SELECT id, folder_path FROM playlist_items WHERE user_id = ? AND (folder_path = ? OR folder_path LIKE ?)",
            (user_id, source_path, source_path + "/%"),
        )
        items = cur.fetchall()
        for item in items:
            item_fp = item["folder_path"]
            if item_fp == source_path:
                updated_fp = dest_path
            else:
                updated_fp = dest_path + item_fp[len(source_path):]
            conn.execute(
                "UPDATE playlist_items SET folder_path = ? WHERE id = ? AND user_id = ?",
                (updated_fp, item["id"], user_id),
            )

    conn.close()

    logger.info(f"User '{user_id}' moved folder '{source_path}' -> '{dest_path}'")
    return {
        "status": "success",
        "user_id": user_id,
        "source_path": source_path,
        "destination_path": dest_path,
        "message": f"Moved folder '{source_path}' to '{dest_path}'.",
    }


@router.delete("/folders")
def delete_folder(
    path: str = Query(..., description="Folder path to delete"),
    delete_songs: bool = Query(True, description="Whether to delete contained songs or move them"),
    move_to: Optional[str] = Query(None, description="Optional target folder to move songs to instead of deleting"),
    user_id: str = Depends(get_active_user_id),
):
    """
    Deletes a folder and all its child subfolders safely.
    Safeguards: Cannot delete system views 'ALL' or 'FAVORITES'.
    If delete_songs is False or move_to is specified, contained songs are safely moved
    to move_to (or the parent folder/root) rather than deleted.
    """
    norm = clean_path(path)
    if not norm or norm in ["ALL", "FAVORITES", "FAVORITE"]:
        raise HTTPException(status_code=400, detail="Cannot delete default system folders.")

    conn = get_db()
    cur = conn.cursor()

    cur.execute("SELECT id, parent_path FROM folders WHERE user_id = ? AND path = ?", (user_id, norm))
    folder_row = cur.fetchone()
    if not folder_row:
        conn.close()
        raise HTTPException(status_code=404, detail=f"Folder '{norm}' not found.")

    with conn:
        # Handle songs
        if delete_songs and not move_to:
            # Delete all songs in this folder subtree
            conn.execute(
                "DELETE FROM playlist_items WHERE user_id = ? AND (folder_path = ? OR folder_path LIKE ?)",
                (user_id, norm, norm + "/%"),
            )
        else:
            # Move songs rather than deleting them
            if move_to and move_to.strip():
                dest_folder = clean_path(move_to)
            else:
                parent = folder_row["parent_path"]
                dest_folder = parent if parent else "GENERAL"

            ensure_folder_hierarchy(conn, user_id, dest_folder)
            conn.execute(
                "UPDATE playlist_items SET folder_path = ? WHERE user_id = ? AND (folder_path = ? OR folder_path LIKE ?)",
                (dest_folder, user_id, norm, norm + "/%"),
            )

        # Delete the folder and all its descendant subfolders
        conn.execute(
            "DELETE FROM folders WHERE user_id = ? AND (path = ? OR path LIKE ?)",
            (user_id, norm, norm + "/%"),
        )

    conn.close()

    logger.info(f"User '{user_id}' deleted folder '{norm}'")
    return {
        "status": "success",
        "user_id": user_id,
        "path": norm,
        "message": f"Deleted folder '{norm}' and child hierarchy.",
    }


@router.post("/items")
def add_playlist_item(req: AddPlaylistItemRequest, user_id: str = Depends(get_active_user_id)):
    """
    Adds a YouTube video to a hierarchical playlist folder.
    Automatically creates the folder path if it does not yet exist.
    Enforces 'Single song record (no duplicates in DB)':
    If the song already exists for this user, updates its folder_path and metadata.
    """
    norm_folder = clean_path(req.folder_path)
    if not norm_folder or norm_folder in ["ALL", "FAVORITES", "FAVORITE"]:
        norm_folder = "GENERAL"

    conn = get_db()
    ensure_folder_hierarchy(conn, user_id, norm_folder)

    cur = conn.cursor()
    # Check if song already exists in user's library
    cur.execute(
        "SELECT id, is_favorite, download_status, local_file FROM playlist_items WHERE user_id = ? AND video_id = ?",
        (user_id, req.video_id),
    )
    existing = cur.fetchone()

    with conn:
        if existing:
            item_id = existing["id"]
            fav_value = bool(req.is_favorite or existing["is_favorite"])
            conn.execute(
                """
                UPDATE playlist_items
                SET folder_path = ?,
                    title = ?,
                    thumbnail = ?,
                    channel = ?,
                    duration = COALESCE(NULLIF(?, ''), duration),
                    views = COALESCE(NULLIF(?, ''), views),
                    is_favorite = ?,
                    download_status = COALESCE(?, download_status),
                    local_file = COALESCE(?, local_file)
                WHERE id = ? AND user_id = ?
                """,
                (
                    norm_folder,
                    req.title,
                    req.thumbnail,
                    req.channel,
                    req.duration or "",
                    req.views or "",
                    fav_value,
                    req.download_status or existing["download_status"],
                    req.local_file if req.local_file is not None else (existing["local_file"] or ""),
                    item_id,
                    user_id,
                ),
            )
            msg = f"Song updated and placed in '{norm_folder}'."
        else:
            item_id = str(uuid.uuid4())[:8]
            conn.execute(
                """
                INSERT INTO playlist_items (
                    id, user_id, video_id, title, thumbnail, channel,
                    duration, views, folder_path, is_favorite, download_status, local_file
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item_id,
                    user_id,
                    req.video_id,
                    req.title,
                    req.thumbnail,
                    req.channel,
                    req.duration or "",
                    req.views or "",
                    norm_folder,
                    bool(req.is_favorite),
                    req.download_status or "not_downloaded",
                    req.local_file or "",
                ),
            )
            msg = f"Video successfully added to '{norm_folder}'!"

    conn.close()

    logger.info(f"User '{user_id}' added/updated video '{req.video_id}' in '{norm_folder}'")
    return {
        "status": "success",
        "id": item_id,
        "video_id": req.video_id,
        "user_id": user_id,
        "folder_path": norm_folder,
        "message": msg,
    }


@router.api_route("/items/{item_id}/move", methods=["PUT", "POST"])
def move_playlist_item(
    item_id: str,
    req: MovePlaylistItemRequest,
    user_id: str = Depends(get_active_user_id),
):
    """
    Moves a song to a target hierarchical folder.
    """
    dest = (req.target_folder_path or req.folder_path or "").strip()
    if not dest:
        raise HTTPException(status_code=400, detail="Target folder path is required.")

    norm_dest = clean_path(dest)
    if not norm_dest or norm_dest in ["ALL", "FAVORITES", "FAVORITE"]:
        raise HTTPException(status_code=400, detail="Cannot move songs into virtual system views.")

    conn = get_db()
    cur = conn.cursor()

    cur.execute(
        "SELECT id, video_id, folder_path FROM playlist_items WHERE id = ? AND user_id = ?",
        (item_id, user_id),
    )
    item = cur.fetchone()
    if not item:
        conn.close()
        raise HTTPException(status_code=404, detail="Playlist item not found.")

    ensure_folder_hierarchy(conn, user_id, norm_dest)

    with conn:
        conn.execute(
            "UPDATE playlist_items SET folder_path = ? WHERE id = ? AND user_id = ?",
            (norm_dest, item_id, user_id),
        )

    conn.close()

    logger.info(f"User '{user_id}' moved item '{item_id}' to '{norm_dest}'")
    return {
        "status": "success",
        "id": item_id,
        "user_id": user_id,
        "folder_path": norm_dest,
        "message": f"Song moved to '{norm_dest}'.",
    }


@router.post("/items/toggle-favorite")
def toggle_favorite(req: ToggleFavoriteRequest, user_id: str = Depends(get_active_user_id)):
    """
    Toggles the favorite flag on a playlist item for the active user.
    """
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "SELECT id, is_favorite FROM playlist_items WHERE id = ? AND user_id = ?",
        (req.item_id, user_id),
    )
    row = cur.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Playlist item not found.")

    new_fav = not bool(row["is_favorite"])
    with conn:
        conn.execute(
            "UPDATE playlist_items SET is_favorite = ? WHERE id = ? AND user_id = ?",
            (new_fav, req.item_id, user_id),
        )
    conn.close()

    logger.info(f"User '{user_id}' toggled favorite={new_fav} for item '{req.item_id}'")
    return {
        "status": "success",
        "id": req.item_id,
        "user_id": user_id,
        "is_favorite": bool(new_fav),
    }


@router.delete("/items/{item_id}")
def remove_playlist_item(item_id: str, user_id: str = Depends(get_active_user_id)):
    """
    Removes a video from the active user's playlist.
    """
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT id FROM playlist_items WHERE id = ? AND user_id = ?", (item_id, user_id))
    if not cur.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Playlist item not found.")

    with conn:
        conn.execute(
            "DELETE FROM playlist_items WHERE id = ? AND user_id = ?",
            (item_id, user_id),
        )
    conn.close()

    logger.info(f"User '{user_id}' removed playlist item '{item_id}'")
    return {
        "status": "success",
        "id": item_id,
        "user_id": user_id,
        "message": "Song removed from playlist.",
    }
