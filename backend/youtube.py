import gzip
import json
import logging
import re
import time
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Query
from logger import get_logger

logger = get_logger("sodo.youtube")

router = APIRouter(prefix="/api/youtube", tags=["YouTube"])

# Cache search results for 10 minutes to make subsequent queries instant
_SEARCH_CACHE: Dict[str, Dict[str, Any]] = {}
CACHE_TTL = 600


def _extract_from_video_renderer(vr: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    try:
        video_id = vr.get("videoId")
        if not video_id:
            return None

        # Title
        title_runs = vr.get("title", {}).get("runs", [])
        title = "".join(r.get("text", "") for r in title_runs)
        if not title:
            title = vr.get("title", {}).get("simpleText", "Untitled Video")

        # Thumbnails
        thumbnails = vr.get("thumbnail", {}).get("thumbnails", [])
        thumbnail = (
            thumbnails[-1].get("url")
            if thumbnails
            else f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
        )

        # Channel name
        channel_runs = vr.get("ownerText", {}).get("runs", []) or vr.get("longBylineText", {}).get("runs", [])
        channel = "".join(r.get("text", "") for r in channel_runs) or "YouTube Creator"

        # Channel avatar thumbnail
        channel_thumbnail = ""
        channel_thumbs = (
            vr.get("channelThumbnailSupportedRendered", {})
            .get("channelThumbnailWithLinkRenderer", {})
            .get("thumbnail", {})
            .get("thumbnails", [])
        )
        if channel_thumbs:
            channel_thumbnail = channel_thumbs[0].get("url", "")

        # Duration & Live check
        duration = vr.get("lengthText", {}).get("simpleText", "")
        is_live = False
        if not duration:
            for badge in vr.get("badges", []):
                label = badge.get("metadataBadgeRenderer", {}).get("label", "")
                if "LIVE" in label.upper():
                    duration = "LIVE"
                    is_live = True
                    break
                if label:
                    duration = label

        # View count
        views = vr.get("viewCountText", {}).get("simpleText", "")
        if not views:
            views_runs = vr.get("viewCountText", {}).get("runs", [])
            views = "".join(r.get("text", "") for r in views_runs)

        # Published date
        published = vr.get("publishedTimeText", {}).get("simpleText", "")

        # Snippet / description
        description = ""
        snippets = vr.get("detailedMetadataSnippets", [])
        if snippets:
            desc_runs = snippets[0].get("snippetText", {}).get("runs", [])
            description = "".join(r.get("text", "") for r in desc_runs)

        return {
            "id": video_id,
            "title": title,
            "url": f"https://www.youtube.com/watch?v={video_id}",
            "short_url": f"https://youtu.be/{video_id}",
            "thumbnail": thumbnail,
            "channel": channel,
            "channel_thumbnail": channel_thumbnail,
            "duration": duration or "Video",
            "is_live": is_live,
            "views": views or "YouTube Video",
            "published": published or "",
            "description": description,
        }
    except Exception as e:
        logger.debug("Parsing item error: %s", e)
        return None


def _parse_innertube_contents(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    videos: List[Dict[str, Any]] = []
    seen = set()

    sections = (
        data.get("contents", {})
        .get("twoColumnSearchResultsRenderer", {})
        .get("primaryContents", {})
        .get("sectionListRenderer", {})
        .get("contents", [])
    )

    for sec in sections:
        item_section = sec.get("itemSectionRenderer", {}).get("contents", [])
        for item in item_section:
            vr = item.get("videoRenderer")
            if vr:
                video = _extract_from_video_renderer(vr)
                if video and video["id"] not in seen:
                    seen.add(video["id"])
                    videos.append(video)

            # Shelf renderers (playlists / related videos)
            shelf = item.get("shelfRenderer", {})
            if shelf:
                shelf_items = (
                    shelf.get("content", {})
                    .get("verticalListRenderer", {})
                    .get("items", [])
                )
                for s_item in shelf_items:
                    svr = s_item.get("videoRenderer")
                    if svr:
                        video = _extract_from_video_renderer(svr)
                        if video and video["id"] not in seen:
                            seen.add(video["id"])
                            videos.append(video)

    return videos


def search_youtube_innertube(query: str) -> List[Dict[str, Any]]:
    """Query YouTube internal API directly for fast JSON search without scraping HTML."""
    url = "https://www.youtube.com/youtubei/v1/search"
    payload = {
        "context": {
            "client": {
                "clientName": "WEB",
                "clientVersion": "2.20240101.00.00",
                "hl": "en",
                "gl": "US",
            }
        },
        "query": query,
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept-Encoding": "gzip, deflate",
        },
    )
    with urllib.request.urlopen(req, timeout=12) as resp:
        raw = resp.read()
        if resp.info().get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
        data = json.loads(raw.decode("utf-8", errors="ignore"))
        return _parse_innertube_contents(data)


def search_youtube_html_fallback(query: str) -> List[Dict[str, Any]]:
    """Fallback scraping method if Innertube endpoint responds unexpectedly."""
    encoded_query = urllib.parse.quote(query)
    url = f"https://www.youtube.com/results?search_query={encoded_query}"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate",
            "Cookie": "SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg;",
        },
    )
    with urllib.request.urlopen(req, timeout=12) as resp:
        raw = resp.read()
        if resp.info().get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
        html = raw.decode("utf-8", errors="ignore")

    match = re.search(r"var ytInitialData\s*=\s*({.*?});</script>", html) or re.search(
        r"ytInitialData\s*=\s*({.+?});", html
    )
    if match:
        try:
            data = json.loads(match.group(1))
            return _parse_innertube_contents(data)
        except Exception:
            pass

    # Regex fallback
    videos = []
    seen = set()
    pattern = re.compile(r'\/watch\?v=([a-zA-Z0-9_-]{11})[^\>]*?title="([^"]+)"')
    for vid, vtitle in pattern.findall(html):
        if vid not in seen:
            seen.add(vid)
            videos.append(
                {
                    "id": vid,
                    "title": vtitle,
                    "url": f"https://www.youtube.com/watch?v={vid}",
                    "short_url": f"https://youtu.be/{vid}",
                    "thumbnail": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
                    "channel": "YouTube Creator",
                    "channel_thumbnail": "",
                    "duration": "Video",
                    "is_live": False,
                    "views": "",
                    "published": "",
                    "description": "",
                }
            )
    return videos


def get_cached_or_fetch(query: str, limit: int = 24) -> List[Dict[str, Any]]:
    key = query.strip().lower()
    now = time.time()
    if key in _SEARCH_CACHE:
        entry = _SEARCH_CACHE[key]
        if now - entry["timestamp"] < CACHE_TTL:
            logger.info(f"YouTube search cache hit for '{query}' ({len(entry['videos'])} results cached)")
            return entry["videos"][:limit]

    logger.info(f"Executing YouTube search for '{query}'...")
    videos = []
    try:
        videos = search_youtube_innertube(query)
        logger.info(f"Innertube search returned {len(videos)} results for '{query}'")
    except Exception as e:
        logger.warning(f"Innertube search failed for '{query}' ({e}), trying HTML fallback")
        try:
            videos = search_youtube_html_fallback(query)
            logger.info(f"HTML fallback search returned {len(videos)} results for '{query}'")
        except Exception as e2:
            logger.error(f"HTML fallback failed for '{query}': {e2}")

    if videos:
        _SEARCH_CACHE[key] = {"timestamp": now, "videos": videos}

    return videos[:limit]


@router.get("/search")
def search_videos(
    q: str = Query(..., min_length=1, description="YouTube search query"),
    limit: int = Query(24, ge=1, le=50, description="Max results"),
):
    """Search YouTube videos without iframe issues."""
    clean_query = q.strip()
    if not clean_query:
        return {"query": "", "count": 0, "results": []}

    results = get_cached_or_fetch(clean_query, limit=limit)
    return {
        "query": clean_query,
        "count": len(results),
        "results": results,
    }


@router.get("/trending")
def get_trending(limit: int = Query(24, ge=1, le=50)):
    """Initial starter/trending videos feed for YouTube search page."""
    results = get_cached_or_fetch("popular music and trending podcasts", limit=limit)
    return {
        "category": "trending",
        "count": len(results),
        "results": results,
    }
