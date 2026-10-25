"""YouTube audio downloader and LRU rolling cache engine for Sodo Player."""

from __future__ import annotations

import os
import re
import shutil
import sqlite3
import sys
import threading
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import yt_dlp
from config import BASE_DIR, MEDIA_DIR
from logger import get_logger

logger = get_logger("sodo.downloader")

try:
    from sodo.downloader import _ffmpeg_dir, clean_url, is_ffmpeg_available, sanitize_filename
except ImportError:
    # Ensure root and sodo package in sys.path
    ROOT_DIR = BASE_DIR.parent
    for p in [str(ROOT_DIR / "sodo"), str(ROOT_DIR)]:
        if p not in sys.path:
            sys.path.insert(0, p)
    from sodo.downloader import _ffmpeg_dir, clean_url, is_ffmpeg_available, sanitize_filename

# Ensure output directory exists: backend/media/downloads
MEDIA_DIR.mkdir(parents=True, exist_ok=True)

# Regex matching canonical 11-char YouTube video ID
YT_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{11}$")

# Maximum downloaded songs to retain on disk: current song + up to 5 history songs (max 6 total)
MAX_DOWNLOAD_CACHE = 6

# SQLite database path for Sodo library & playlists
DB_PATH = BASE_DIR / "sododb.db"

# In-memory download state tracker: video_id -> dict
# Statuses: 'pending', 'downloading', 'ready', 'failed', 'cached_out'
_ACTIVE_DOWNLOADS: Dict[str, Dict[str, Any]] = {}
_PROGRESS_CALLBACKS: List[Callable[[str, str, float], None]] = []
_LOCK = threading.Lock()


# ---------------------------------------------------------------------------
# FFmpeg Resolution
# ---------------------------------------------------------------------------

def get_ffmpeg_dir() -> Optional[str]:
    r"""
    Resolve FFmpeg directory prioritizing:
    1. C:\Users\asim\tools\sodo\bin
    2. ~/tools/sodo/bin or ~/sodo/bin
    3. sodo package discovery
    4. System PATH
    """
    candidates = [
        Path(r"C:\Users\asim\tools\sodo\bin"),
        Path.home() / "tools" / "sodo" / "bin",
        Path.home() / "sodo" / "bin",
    ]
    exe_suffix = ".exe" if sys.platform == "win32" else ""

    for candidate in candidates:
        if (candidate / f"ffmpeg{exe_suffix}").is_file():
            return str(candidate)

    # Check sodo downloader resolution
    sodo_dir = _ffmpeg_dir()
    if sodo_dir and (Path(sodo_dir) / f"ffmpeg{exe_suffix}").is_file():
        return str(sodo_dir)

    # Check system PATH
    system_ffmpeg = shutil.which("ffmpeg")
    if system_ffmpeg:
        return str(Path(system_ffmpeg).parent)

    return None


# ---------------------------------------------------------------------------
# Database Sync Helpers
# ---------------------------------------------------------------------------

from database import get_db as _get_db


def update_db_download_status(
    video_id: str,
    status: str,
    progress: float = 0.0,
    local_file: str = "",
) -> None:
    """
    Update download status, progress, and local_file in playlist_items.
    Preserves all metadata, folder_path, title, channel, duration, is_favorite.
    """
    try:
        conn = _get_db()
        with conn:
            conn.execute(
                """
                UPDATE playlist_items
                SET download_status = ?,
                    download_progress = ?,
                    local_file = ?,
                    last_accessed = CURRENT_TIMESTAMP
                WHERE video_id = ?
                """,
                (status, round(progress, 1), local_file, video_id),
            )
        conn.close()
    except Exception as e:
        print(f"[DB Notice] Could not update download status for {video_id}: {e}")


def mark_song_accessed(video_id: str) -> None:
    """
    Update last_accessed timestamp for a song both on disk and in database.
    Crucial for LRU cache ordering when streaming or playing.
    """
    target = get_audio_filepath(video_id)
    if target.exists() and target.is_file():
        try:
            now = time.time()
            os.utime(target, (now, now))
        except Exception:
            pass

    try:
        conn = _get_db()
        with conn:
            conn.execute(
                """
                UPDATE playlist_items
                SET last_accessed = CURRENT_TIMESTAMP
                WHERE video_id = ?
                """,
                (video_id,),
            )
        conn.close()
    except Exception:
        pass


def resolve_song_or_video_id(song_id_or_url: str) -> Tuple[str, Optional[Dict[str, Any]]]:
    """
    Resolve input which may be:
    - YouTube video ID (11 chars)
    - YouTube URL
    - Internal playlist_items table row id
    Returns (video_id, playlist_item_dict_or_None).
    """
    clean_input = song_id_or_url.strip()

    # 1. Check if it's an existing item ID in playlist_items
    try:
        conn = _get_db()
        cur = conn.cursor()
        cur.execute("SELECT * FROM playlist_items WHERE id = ?", (clean_input,))
        row = cur.fetchone()
        if row:
            conn.close()
            return row["video_id"], dict(row)

        # 2. Check if clean_input directly matches video_id in DB
        cur.execute("SELECT * FROM playlist_items WHERE video_id = ?", (clean_input,))
        row = cur.fetchone()
        conn.close()
        if row:
            return clean_input, dict(row)
    except Exception:
        pass

    # 3. Extract 11-char video ID from URL or raw string
    try:
        vid = extract_video_id(clean_input)
        return vid, None
    except Exception:
        return clean_input, None


# ---------------------------------------------------------------------------
# Path & State Helpers
# ---------------------------------------------------------------------------

def extract_video_id(url_or_id: str) -> str:
    """Extract a canonical 11-character YouTube video ID from a URL or raw ID string."""
    clean = url_or_id.strip()
    if YT_ID_PATTERN.match(clean):
        return clean

    cleaned_url = clean_url(clean)

    # Check v= parameter
    match = re.search(r"[?&]v=([a-zA-Z0-9_-]{11})", cleaned_url)
    if match:
        return match.group(1)

    # Check youtu.be/ ID
    match = re.search(r"youtu\.be/([a-zA-Z0-9_-]{11})", cleaned_url)
    if match:
        return match.group(1)

    # Check shorts or embed
    match = re.search(r"/(?:shorts|embed)/([a-zA-Z0-9_-]{11})", cleaned_url)
    if match:
        return match.group(1)

    raise ValueError(f"Unable to extract a valid YouTube video ID from: '{url_or_id}'")


def get_audio_filepath(video_id: str) -> Path:
    """Return the absolute Path for a given video ID's MP3 file in backend/media/downloads."""
    return MEDIA_DIR / f"{video_id}.mp3"


def is_already_downloaded(video_id: str) -> bool:
    """
    Duplicate prevention: Check if the audio file for this video ID already exists
    on disk and is complete/non-empty.
    """
    path = get_audio_filepath(video_id)
    return path.exists() and path.is_file() and path.stat().st_size > 1024


# ---------------------------------------------------------------------------
# LRU Rolling Cache Policy
# ---------------------------------------------------------------------------

def prune_download_cache(current_video_id: str, max_songs: int = MAX_DOWNLOAD_CACHE) -> List[str]:
    """
    LRU Rolling Cache Policy:
    Maintain at most 6 downloaded audio files on disk (the current song + at most 5 historical songs).
    When count > max_songs:
      - Sort by last accessed / downloaded timestamp descending.
      - Protect the current song.
      - Keep up to (max_songs - 1) of the newest historical songs.
      - Delete the oldest audio files from disk.
      - In playlist_items database, update their download_status = 'cached_out' and local_file = ''
        so the UI knows they need to be re-cached if played, while PRESERVING their metadata,
        folder assignment, title, channel, duration, and favorites.

    Returns list of evicted video IDs.
    """
    evicted: List[str] = []
    try:
        mp3_files = list(MEDIA_DIR.glob("*.mp3"))
        # Exclude active temporary files
        valid_files = [f for f in mp3_files if not f.name.endswith(".temp.mp3") and f.is_file()]

        if len(valid_files) <= max_songs:
            return evicted

        current_file = get_audio_filepath(current_video_id)

        # Candidates for history: all files except the current active song
        candidates = [f for f in valid_files if f.resolve() != current_file.resolve()]

        # Sort candidates by access / modification time descending (newest first)
        candidates.sort(
            key=lambda p: max(p.stat().st_mtime, p.stat().st_atime),
            reverse=True,
        )

        # We keep the current song (if present) + up to (max_songs - 1) newest files
        max_history = max_songs - 1 if current_file.exists() else max_songs
        to_keep = set(candidates[:max_history])
        if current_file.exists():
            to_keep.add(current_file)

        # Files to evict
        to_delete = [f for f in valid_files if f not in to_keep]

        for old_file in to_delete:
            vid = old_file.stem
            try:
                old_file.unlink(missing_ok=True)
                evicted.append(vid)
                logger.info(f"LRU Cache: Evicted older cached song: {old_file.name}")

                # Update database: status = 'cached_out', local_file = '', progress = 0
                update_db_download_status(vid, status="cached_out", progress=0.0, local_file="")

                # Update in-memory tracker
                with _LOCK:
                    if vid in _ACTIVE_DOWNLOADS:
                        _ACTIVE_DOWNLOADS[vid]["status"] = "cached_out"
                        _ACTIVE_DOWNLOADS[vid]["file_path"] = ""
                        _ACTIVE_DOWNLOADS[vid]["progress"] = 0
                        _ACTIVE_DOWNLOADS[vid]["file_size"] = 0
            except Exception as e:
                print(f"[LRU Cache Error] Could not delete {old_file.name}: {e}")

    except Exception as err:
        print(f"[LRU Cache Prune Error] {err}")

    return evicted


# ---------------------------------------------------------------------------
# Background Download Worker
# ---------------------------------------------------------------------------

def _notify_progress(video_id: str, status: str, progress: float):
    """Notify all registered progress callbacks."""
    for cb in _PROGRESS_CALLBACKS:
        try:
            cb(video_id, status, progress)
        except Exception:
            pass


def _download_worker(
    video_id: str,
    on_complete: Optional[Callable[[str, str, int], None]] = None,
    on_error: Optional[Callable[[str, str], None]] = None,
):
    """
    Background worker executing yt-dlp audio download with FFmpeg extraction.
    Produces backend/media/downloads/<video_id>.mp3.
    """
    target_file = get_audio_filepath(video_id)
    temp_template = str(MEDIA_DIR / f"{video_id}.temp.%(ext)s")
    video_url = f"https://www.youtube.com/watch?v={video_id}"

    def progress_hook(d: dict):
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            downloaded = d.get("downloaded_bytes") or 0
            pct = 10.0
            if total > 0:
                pct = round(10.0 + (downloaded / total) * 80.0, 1)  # 10% - 90%
            with _LOCK:
                if video_id in _ACTIVE_DOWNLOADS:
                    curr_pct = _ACTIVE_DOWNLOADS[video_id].get("progress", 0.0)
                    _ACTIVE_DOWNLOADS[video_id]["progress"] = max(pct, curr_pct)
                    _ACTIVE_DOWNLOADS[video_id]["status"] = "downloading"
            update_db_download_status(video_id, status="downloading", progress=pct, local_file="")
            _notify_progress(video_id, "downloading", pct)

        elif d.get("status") == "finished":
            # Audio stream downloaded, now FFmpeg post-processing
            with _LOCK:
                if video_id in _ACTIVE_DOWNLOADS:
                    _ACTIVE_DOWNLOADS[video_id]["progress"] = 92.0
                    _ACTIVE_DOWNLOADS[video_id]["status"] = "downloading"
            update_db_download_status(video_id, status="downloading", progress=92.0, local_file="")
            _notify_progress(video_id, "downloading", 92.0)

    ydl_opts: Dict[str, Any] = {
        "format": "bestaudio/best",
        "outtmpl": temp_template,
        "quiet": True,
        "no_warnings": True,
        "progress_hooks": [progress_hook],
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "0",  # Highest VBR quality
            },
            {
                "key": "FFmpegMetadata",
                "add_metadata": True,
            },
        ],
        "windowsfilenames": True,
        "restrictfilenames": False,
        "ignoreerrors": False,
        "retries": 3,
        "socket_timeout": 30,
    }

    ffmpeg_dir = get_ffmpeg_dir()
    if ffmpeg_dir:
        ydl_opts["ffmpeg_location"] = ffmpeg_dir

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([video_url])

        # yt-dlp saves with .mp3 extension
        temp_mp3 = MEDIA_DIR / f"{video_id}.temp.mp3"
        if not temp_mp3.exists():
            candidates = list(MEDIA_DIR.glob(f"{video_id}.temp.*"))
            if candidates:
                temp_mp3 = candidates[0]
            else:
                raise RuntimeError(f"Expected audio file was not produced for video ID {video_id}.")

        # Atomically replace final target file
        if target_file.exists():
            try:
                target_file.unlink()
            except Exception:
                pass
        temp_mp3.replace(target_file)

        # Fresh timestamp on disk
        now = time.time()
        os.utime(target_file, (now, now))
        file_size = target_file.stat().st_size

        # LRU Rolling Cache: maintain at most 6 downloaded songs
        prune_download_cache(video_id)

        # Update in-memory state: 'ready'
        with _LOCK:
            _ACTIVE_DOWNLOADS[video_id] = {
                "video_id": video_id,
                "status": "ready",
                "progress": 100.0,
                "file_path": str(target_file),
                "file_size": file_size,
                "error": None,
                "updated_at": time.time(),
            }

        # Update database
        update_db_download_status(video_id, status="ready", progress=100.0, local_file=str(target_file))
        _notify_progress(video_id, "ready", 100.0)

        if on_complete:
            try:
                on_complete(video_id, str(target_file), file_size)
            except Exception as cb_err:
                print(f"[Downloader Callback Error] {cb_err}")

    except Exception as err:
        err_msg = str(err)
        logger.error(f"Failed to download audio for video '{video_id}': {err_msg}")

        with _LOCK:
            _ACTIVE_DOWNLOADS[video_id] = {
                "video_id": video_id,
                "status": "failed",
                "progress": 0.0,
                "file_path": None,
                "file_size": 0,
                "error": err_msg,
                "updated_at": time.time(),
            }

        update_db_download_status(video_id, status="failed", progress=0.0, local_file="")
        _notify_progress(video_id, "failed", 0.0)

        # Cleanup leftover temp files
        for f in MEDIA_DIR.glob(f"{video_id}.temp.*"):
            try:
                f.unlink()
            except Exception:
                pass

        if on_error:
            try:
                on_error(video_id, err_msg)
            except Exception as cb_err:
                print(f"[Downloader Callback Error] {cb_err}")


# ---------------------------------------------------------------------------
# Public Downloader API
# ---------------------------------------------------------------------------

def register_progress_callback(callback: Callable[[str, str, float], None]) -> None:
    """Register a hook to receive (video_id, status, progress) updates."""
    _PROGRESS_CALLBACKS.append(callback)


def get_download_status(song_id_or_url: str) -> Dict[str, Any]:
    """
    Get the current download status for a given song ID or URL.
    Returns:
      {
        "song_id": str,
        "video_id": str,
        "status": "pending" | "downloading" | "ready" | "failed" | "cached_out",
        "progress": float (0-100),
        "file_path": str or None,
        "file_size": int,
        "error": str or None
      }
    """
    video_id, db_item = resolve_song_or_video_id(song_id_or_url)

    # 1. Check if audio file is complete and present on disk
    if is_already_downloaded(video_id):
        filepath = get_audio_filepath(video_id)
        return {
            "song_id": song_id_or_url,
            "video_id": video_id,
            "status": "ready",
            "progress": 100.0,
            "file_path": str(filepath),
            "file_size": filepath.stat().st_size,
            "error": None,
        }

    # 2. Check active in-memory state
    with _LOCK:
        if video_id in _ACTIVE_DOWNLOADS:
            curr = dict(_ACTIVE_DOWNLOADS[video_id])
            curr["song_id"] = song_id_or_url
            return curr

    # 3. Check database record if available
    if db_item:
        status = db_item.get("download_status") or "pending"
        # If DB says ready but file is gone, mark as cached_out
        if status == "ready" and not is_already_downloaded(video_id):
            status = "cached_out"
            update_db_download_status(video_id, status="cached_out", progress=0.0, local_file="")

        return {
            "song_id": song_id_or_url,
            "video_id": video_id,
            "status": status,
            "progress": float(db_item.get("download_progress") or 0.0),
            "file_path": db_item.get("local_file") or None,
            "file_size": 0,
            "error": None,
        }

    # 4. Default: pending
    return {
        "song_id": song_id_or_url,
        "video_id": video_id,
        "status": "pending",
        "progress": 0.0,
        "file_path": None,
        "file_size": 0,
        "error": None,
    }


def start_download_async(
    song_id_or_url: str,
    on_complete: Optional[Callable[[str, str, int], None]] = None,
    on_error: Optional[Callable[[str, str], None]] = None,
    force_restart: bool = False,
) -> Dict[str, Any]:
    """
    Initiate or reuse an asynchronous background audio download.
    Duplicate prevention: If file already on disk, reuses existing file instantly.
    """
    video_id, _ = resolve_song_or_video_id(song_id_or_url)

    # 1. Duplicate prevention: Already on disk
    if not force_restart and is_already_downloaded(video_id):
        target = get_audio_filepath(video_id)
        mark_song_accessed(video_id)
        prune_download_cache(video_id)
        update_db_download_status(video_id, status="ready", progress=100.0, local_file=str(target))

        if on_complete:
            try:
                on_complete(video_id, str(target), target.stat().st_size)
            except Exception:
                pass

        return {
            "song_id": song_id_or_url,
            "video_id": video_id,
            "status": "ready",
            "progress": 100.0,
            "file_path": str(target),
            "file_size": target.stat().st_size,
            "already_existed": True,
            "error": None,
        }

    # 2. Check if already actively downloading
    with _LOCK:
        if not force_restart and video_id in _ACTIVE_DOWNLOADS:
            curr = _ACTIVE_DOWNLOADS[video_id]
            if curr.get("status") == "downloading":
                res = dict(curr)
                res["song_id"] = song_id_or_url
                res["already_existed"] = False
                return res

        # 3. Register as active downloading
        _ACTIVE_DOWNLOADS[video_id] = {
            "video_id": video_id,
            "status": "downloading",
            "progress": 5.0,
            "file_path": None,
            "file_size": 0,
            "error": None,
            "updated_at": time.time(),
        }

    update_db_download_status(video_id, status="downloading", progress=5.0, local_file="")
    _notify_progress(video_id, "downloading", 5.0)

    # 4. Spawn background worker thread
    t = threading.Thread(
        target=_download_worker,
        args=(video_id, on_complete, on_error),
        daemon=True,
        name=f"DownloadWorker-{video_id}",
    )
    t.start()

    return {
        "song_id": song_id_or_url,
        "video_id": video_id,
        "status": "downloading",
        "progress": 5.0,
        "file_path": None,
        "file_size": 0,
        "already_existed": False,
        "error": None,
    }


def retry_download(song_id_or_url: str) -> Dict[str, Any]:
    """Retry a failed or cached_out download."""
    video_id, _ = resolve_song_or_video_id(song_id_or_url)
    with _LOCK:
        if video_id in _ACTIVE_DOWNLOADS:
            _ACTIVE_DOWNLOADS.pop(video_id, None)

    return start_download_async(video_id, force_restart=True)


def list_recent_downloads(limit: int = 20) -> List[Dict[str, Any]]:
    """
    List recently downloaded and active songs.
    Merges on-disk files, active download states, and SQLite metadata.
    """
    actual_limit = limit if isinstance(limit, int) else 20
    downloads_map: Dict[str, Dict[str, Any]] = {}

    # 1. On-disk files
    for mp3_file in MEDIA_DIR.glob("*.mp3"):
        if mp3_file.name.endswith(".temp.mp3") or not mp3_file.is_file():
            continue
        vid = mp3_file.stem
        stat = mp3_file.stat()
        downloads_map[vid] = {
            "video_id": vid,
            "song_id": vid,
            "status": "ready",
            "progress": 100.0,
            "file_path": str(mp3_file),
            "file_size": stat.st_size,
            "last_accessed": stat.st_mtime,
            "error": None,
        }

    # 2. Active in-memory downloads (pending, downloading, failed)
    with _LOCK:
        for vid, entry in _ACTIVE_DOWNLOADS.items():
            if vid not in downloads_map or entry.get("status") != "ready":
                downloads_map[vid] = {
                    "video_id": vid,
                    "song_id": vid,
                    "status": entry.get("status", "pending"),
                    "progress": entry.get("progress", 0.0),
                    "file_path": entry.get("file_path"),
                    "file_size": entry.get("file_size", 0),
                    "last_accessed": entry.get("updated_at", time.time()),
                    "error": entry.get("error"),
                }

    # 3. Enrich with metadata from playlist_items
    try:
        conn = _get_db()
        cur = conn.cursor()
        cur.execute("SELECT * FROM playlist_items")
        for row in cur.fetchall():
            vid = row["video_id"]
            if vid in downloads_map:
                downloads_map[vid].update({
                    "id": row["id"],
                    "title": row["title"],
                    "thumbnail": row["thumbnail"],
                    "channel": row["channel"],
                    "duration": row["duration"],
                    "folder_path": row["folder_path"],
                    "is_favorite": bool(row["is_favorite"]),
                })
        conn.close()
    except Exception:
        pass

    results = list(downloads_map.values())
    results.sort(key=lambda x: x.get("last_accessed", 0), reverse=True)
    return results[:actual_limit]
