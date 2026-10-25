"""Range-request audio streaming service and Songs API routes for Sodo Player."""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Generator, List, Optional
from fastapi import APIRouter, Header, HTTPException, Query, Response, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from config import MEDIA_DIR
from logger import get_logger
from downloader import (
    extract_video_id,
    get_audio_filepath,
    get_download_status,
    is_already_downloaded,
    list_recent_downloads,
    mark_song_accessed,
    resolve_song_or_video_id,
    retry_download,
    start_download_async,
)

logger = get_logger("sodo.streamer")
router = APIRouter(prefix="/api/songs", tags=["Songs & Audio"])


# ---------------------------------------------------------------------------
# Chunk Generator & Byte-Range Streaming
# ---------------------------------------------------------------------------

def iter_file_chunks(
    file_path: Path,
    start: int,
    end: int,
    chunk_size: int = 64 * 1024,
) -> Generator[bytes, None, None]:
    """
    Yield byte chunks from file start up to end offset.
    Uses 64KB chunks to stream efficiently without loading entire file into memory.
    """
    with open(file_path, "rb") as f:
        f.seek(start)
        remaining = (end - start) + 1
        while remaining > 0:
            read_size = min(chunk_size, remaining)
            data = f.read(read_size)
            if not data:
                break
            remaining -= len(data)
            yield data


def stream_audio_range(
    file_path: Path,
    range_header: Optional[str] = None,
    media_type: str = "audio/mpeg",
) -> Response:
    """
    Deliver byte-range streaming response with full HTTP 206 seeking support.
    Complies with RFC 7233. Instant audio scrubber seeking in browser without re-downloading.
    """
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Media file not found on disk.",
        )

    file_size = file_path.stat().st_size
    if file_size == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Media file is empty.",
        )

    # 1. Full content request (no Range header)
    if not range_header or not range_header.startswith("bytes="):
        headers = {
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
            "Content-Type": media_type,
            "Cache-Control": "public, max-age=86400",
            "Content-Disposition": f'inline; filename="{file_path.name}"',
        }
        return StreamingResponse(
            iter_file_chunks(file_path, 0, file_size - 1),
            status_code=status.HTTP_200_OK,
            headers=headers,
            media_type=media_type,
        )

    # 2. Byte Range request (e.g. "bytes=0-1048575" or "bytes=1048576-")
    match = re.match(r"bytes=(\d+)-(\d*)", range_header.strip())
    if not match:
        return Response(
            status_code=status.HTTP_416_RANGE_NOT_SATISFIABLE,
            headers={"Content-Range": f"bytes */{file_size}"},
        )

    start = int(match.group(1))
    end_val = match.group(2)
    end = int(end_val) if end_val else file_size - 1

    # Bounds validation
    if start >= file_size or end >= file_size or start > end:
        return Response(
            status_code=status.HTTP_416_RANGE_NOT_SATISFIABLE,
            headers={"Content-Range": f"bytes */{file_size}"},
        )

    content_length = (end - start) + 1
    headers = {
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Accept-Ranges": "bytes",
        "Content-Length": str(content_length),
        "Content-Type": media_type,
        "Cache-Control": "public, max-age=86400",
        "Content-Disposition": f'inline; filename="{file_path.name}"',
    }

    return StreamingResponse(
        iter_file_chunks(file_path, start, end),
        status_code=status.HTTP_206_PARTIAL_CONTENT,
        headers=headers,
        media_type=media_type,
    )


# ---------------------------------------------------------------------------
# Pydantic Schemas
# ---------------------------------------------------------------------------

class DownloadSongRequest(BaseModel):
    song_id: Optional[str] = Field(None, description="Song ID, YouTube video ID, or playlist item ID")
    video_id: Optional[str] = Field(None, description="YouTube 11-char video ID")
    url: Optional[str] = Field(None, description="YouTube full URL or short URL")
    title: Optional[str] = None
    thumbnail: Optional[str] = None
    channel: Optional[str] = None
    duration: Optional[str] = None
    folder_path: Optional[str] = None


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

@router.post("/download")
def download_song(req: DownloadSongRequest):
    """
    POST /api/songs/download
    Initiate YouTube audio download in the background with progress tracking.
    Duplicate prevention: If file already exists complete on disk, reuses file.
    """
    target = req.video_id or req.song_id or req.url
    if not target:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Must provide video_id, song_id, or url in request body.",
        )

    try:
        logger.info(f"Download requested for target: '{target}'")
        res = start_download_async(target)
        return res
    except Exception as e:
        logger.error(f"Failed to initiate download for '{target}': {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to initiate download: {e}",
        )


@router.post("/{song_id}/download")
def download_song_by_id(song_id: str):
    """
    POST /api/songs/{song_id}/download
    Convenience alias to initiate background download directly using path parameter.
    """
    try:
        return start_download_async(song_id)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to initiate download: {e}",
        )


@router.get("/downloads")
def list_downloads(limit: int = Query(20, ge=1, le=100)):
    """
    GET /api/songs/downloads
    List recent downloads on disk and active downloads.
    """
    actual_limit = limit if isinstance(limit, int) else 20
    return list_recent_downloads(limit=actual_limit)


@router.get("/{song_id}/status")
def song_status(song_id: str):
    """
    GET /api/songs/{song_id}/status
    Get download status and progress (0-100%).
    Returns: 'pending', 'downloading', 'ready', 'failed', or 'cached_out'.
    """
    return get_download_status(song_id)


@router.get("/{song_id}/stream")
def stream_song(
    song_id: str,
    range: Optional[str] = Header(None, alias="Range"),
):
    """
    GET /api/songs/{song_id}/stream
    HTTP Range-request streaming endpoint.
    - If audio file is on disk: Returns HTTP 206 Partial Content with Range headers.
    - If audio file was evicted by LRU or not downloaded:
      Triggers on-demand background download and returns HTTP 404 with detail 'Song needs download'.
    """
    video_id, _ = resolve_song_or_video_id(song_id)

    # Check if audio file is available on disk
    if is_already_downloaded(video_id):
        filepath = get_audio_filepath(video_id)
        # Touch access time to keep cache LRU ordering fresh
        mark_song_accessed(video_id)
        logger.debug(f"Serving local audio stream for '{video_id}' (Range: {range or 'full'})")
        return stream_audio_range(filepath, range_header=range)

    # File was evicted by LRU or never downloaded yet
    # Trigger background download on demand
    logger.info(f"Stream request for '{video_id}' not found on disk; triggering background download.")
    start_download_async(video_id)

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Song needs download",
    )


@router.post("/{song_id}/retry")
def retry_song_download(song_id: str):
    """
    POST /api/songs/{song_id}/retry
    Retry a failed download or re-cache an evicted song.
    """
    try:
        return retry_download(song_id)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Retry failed: {e}",
        )
