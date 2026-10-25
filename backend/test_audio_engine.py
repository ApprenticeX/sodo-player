"""Verification and unit testing script for Sodo Player audio engine."""

import asyncio
import os
import sys
import time
from pathlib import Path

# Add backend and sodo to sys.path
BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))
sys.path.insert(0, str(BASE_DIR.parent / "sodo"))

from config import MEDIA_DIR
import downloader
import streamer
from fastapi import HTTPException


def test_ffmpeg_detection():
    print("\n--- Test 1: FFmpeg Detection ---")
    ffmpeg_dir = downloader.get_ffmpeg_dir()
    print(f"Detected FFmpeg directory: {ffmpeg_dir}")
    assert ffmpeg_dir is not None, "FFmpeg directory should not be None"
    assert (Path(ffmpeg_dir) / "ffmpeg.exe").is_file(), f"ffmpeg.exe must exist in {ffmpeg_dir}"
    print("✓ FFmpeg detection verified.")


def test_video_id_extraction():
    print("\n--- Test 2: Video ID Extraction ---")
    cases = [
        ("jfKfPfyJRdk", "jfKfPfyJRdk"),
        ("https://www.youtube.com/watch?v=jfKfPfyJRdk", "jfKfPfyJRdk"),
        ("https://youtu.be/jfKfPfyJRdk?t=10", "jfKfPfyJRdk"),
        ("https://www.youtube.com/shorts/jfKfPfyJRdk", "jfKfPfyJRdk"),
    ]
    for inp, expected in cases:
        extracted = downloader.extract_video_id(inp)
        assert extracted == expected, f"Expected {expected}, got {extracted} for {inp}"
    print("✓ Video ID extraction verified.")


def test_lru_cache_policy():
    print("\n--- Test 3: LRU Rolling Cache Policy ---")
    import tempfile
    from unittest.mock import patch

    with tempfile.TemporaryDirectory() as tmp_dir_str:
        tmp_media = Path(tmp_dir_str)
        orig_media_dir = downloader.MEDIA_DIR
        downloader.MEDIA_DIR = tmp_media
        try:
            # Insert test items in database to verify metadata preservation
            conn = downloader._get_db()
            with conn:
                for i in range(1, 9):
                    vid = f"lru_test_{i:02d}"
                    conn.execute(
                        """
                        INSERT OR REPLACE INTO playlist_items
                        (id, user_id, video_id, title, thumbnail, channel, duration, folder_path, is_favorite, download_status, local_file)
                        VALUES (?, 'default', ?, ?, 'https://thumb.jpg', 'Test Channel', '3:00', 'ANIME/TEST', 1, 'ready', ?)
                        """,
                        (f"id_{vid}", vid, f"Test Song {i}", str(tmp_media / f"{vid}.mp3")),
                    )
            conn.close()

            # Create 8 dummy mp3 files with staged modification timestamps
            created_files = []
            base_time = time.time() - 1000
            for i in range(1, 9):
                vid = f"lru_test_{i:02d}"
                file_path = tmp_media / f"{vid}.mp3"
                # Write 2KB dummy data
                file_path.write_bytes(b"\x00" * 2048)
                # Assign increasing mtimes: lru_test_01 oldest, lru_test_08 newest
                file_time = base_time + (i * 10)
                os.utime(file_path, (file_time, file_time))
                created_files.append((vid, file_path, file_time))

            print(f"Created {len(created_files)} dummy audio files.")

            # Current song is lru_test_01 (oldest timestamp, but must be kept because it is current!)
            current_vid = "lru_test_01"
            evicted = downloader.prune_download_cache(current_video_id=current_vid, max_songs=6)
            print(f"Evicted video IDs: {evicted}")

            # Check files remaining on disk
            remaining = [f.name for f in tmp_media.glob("lru_test_*.mp3")]
            print(f"Remaining files ({len(remaining)}): {remaining}")

            assert len(remaining) == 6, f"Expected exactly 6 files remaining, found {len(remaining)}"
            assert f"{current_vid}.mp3" in remaining, "Current song must be preserved regardless of age!"

            # lru_test_02 and lru_test_03 were the next oldest, so they should be evicted
            assert "lru_test_02" in evicted, "lru_test_02 should have been evicted"
            assert "lru_test_03" in evicted, "lru_test_03 should have been evicted"

            # Check DB status of evicted files
            conn = downloader._get_db()
            cur = conn.cursor()
            cur.execute("SELECT * FROM playlist_items WHERE video_id = 'lru_test_02'")
            row = dict(cur.fetchone())
            conn.close()

            assert row["download_status"] == "cached_out", f"Expected 'cached_out', got {row['download_status']}"
            assert row["local_file"] == "", f"Expected empty local_file, got {row['local_file']}"
            # Verify metadata preserved
            assert row["title"] == "Test Song 2", "Metadata title must be preserved!"
            assert row["folder_path"] == "ANIME/TEST", "Folder assignment must be preserved!"
            assert row["is_favorite"] == 1, "Favorite status must be preserved!"

            conn = downloader._get_db()
            with conn:
                conn.execute("DELETE FROM playlist_items WHERE video_id LIKE 'lru_test_%'")
            conn.close()

            print("✓ LRU rolling cache policy verified.")
        finally:
            downloader.MEDIA_DIR = orig_media_dir


def _read_body(resp) -> bytes:
    async def _async_read():
        chunks = []
        async for chunk in resp.body_iterator:
            chunks.append(chunk)
        return b"".join(chunks)
    return asyncio.run(_async_read())


def test_streamer_and_endpoints():
    print("\n--- Test 4: Audio Streaming & Endpoints ---")

    # 1. Non-existent / evicted song -> triggers download and raises 404 "Song needs download"
    try:
        streamer.stream_song("non_existent_vid_xyz")
        assert False, "Should have raised HTTPException 404"
    except HTTPException as e:
        assert e.status_code == 404
        assert e.detail == "Song needs download"
        print("✓ Non-downloaded song triggers caching and returns 404 'Song needs download'.")

    # 2. Status check
    st = streamer.song_status("non_existent_vid_xyz")
    assert st["status"] in ("pending", "downloading")
    print(f"✓ Song status verified: {st['status']}")

    # 3. Create dummy file for HTTP 206 Byte-Range streaming
    test_vid = "test_stream_01"
    test_file = MEDIA_DIR / f"{test_vid}.mp3"
    dummy_payload = (b"A" * 64 * 1024) + (b"B" * 64 * 1024)  # 128 KB
    test_file.write_bytes(dummy_payload)

    try:
        # Full content request (no Range header)
        resp = streamer.stream_song(test_vid, range=None)
        assert resp.status_code == 200
        assert resp.headers["Accept-Ranges"] == "bytes"
        assert int(resp.headers["Content-Length"]) == len(dummy_payload)
        assert resp.headers["Content-Type"] == "audio/mpeg"
        content = _read_body(resp)
        assert content == dummy_payload
        print("✓ Full content stream (HTTP 200) verified.")

        # Range request: first 100 bytes (0-99)
        resp = streamer.stream_song(test_vid, range="bytes=0-99")
        assert resp.status_code == 206
        assert resp.headers["Content-Range"] == f"bytes 0-99/{len(dummy_payload)}"
        assert int(resp.headers["Content-Length"]) == 100
        content_100 = _read_body(resp)
        assert content_100 == dummy_payload[0:100]
        print("✓ Partial Content byte range (HTTP 206 bytes=0-99) verified.")

        # Range request: seeking to 64KB offset
        half = 64 * 1024
        resp = streamer.stream_song(test_vid, range=f"bytes={half}-")
        assert resp.status_code == 206
        assert resp.headers["Content-Range"] == f"bytes {half}-{len(dummy_payload)-1}/{len(dummy_payload)}"
        assert int(resp.headers["Content-Length"]) == len(dummy_payload) - half
        content_half = _read_body(resp)
        assert content_half == dummy_payload[half:]
        print("✓ Seeking offset byte range (HTTP 206 bytes=65536-) verified.")

        # Range request: invalid range -> 416
        resp = streamer.stream_song(test_vid, range=f"bytes={len(dummy_payload)+500}-")
        assert resp.status_code == 416
        assert "Content-Range" in resp.headers
        print("✓ Invalid byte range (HTTP 416) verified.")

        # 4. List downloads
        dls = streamer.list_downloads()
        assert any(item["video_id"] == test_vid for item in dls)
        print("✓ List downloads verified.")

        # 5. Duplicate prevention
        dup_res = downloader.start_download_async(test_vid)
        assert dup_res["status"] == "ready"
        assert dup_res["already_existed"] is True
        print("✓ Duplicate prevention verified (reused existing file).")

    finally:
        test_file.unlink(missing_ok=True)


if __name__ == "__main__":
    test_ffmpeg_detection()
    test_video_id_extraction()
    test_lru_cache_policy()
    test_streamer_and_endpoints()
    print("\n🎉 ALL TESTS PASSED SUCCESSFULLY! 🎉\n")
