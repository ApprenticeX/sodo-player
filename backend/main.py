import time
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError, HTTPException
import uvicorn

from config import CORS_ORIGINS
from logger import get_logger, set_request_context, clear_request_context
from database import init_db
from auth import router as auth_router
from youtube import router as youtube_router
from playlists import router as playlists_router, init_playlist_tables
from streamer import router as songs_router
from user_data import router as user_data_router

logger = get_logger("sodo.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing Sodo Player backend services...")
    try:
        init_db()
        init_playlist_tables()
        logger.info("Database and playlist storage initialized successfully.")
    except Exception as e:
        logger.error(f"Failed to initialize database during startup: {e}", exc_info=True)
    yield
    logger.info("Shutting down Sodo Player backend.")


app = FastAPI(
    title="Sodo Player API",
    description="Full-featured YouTube Music Player and Personal Playlist API.",
    version="1.0.0",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# Structured Request Logging & Centralized Error Middleware
# ---------------------------------------------------------------------------

@app.middleware("http")
async def request_logging_and_error_middleware(request: Request, call_next):
    # Retrieve or generate request ID
    client_req_id = request.headers.get("X-Request-ID")
    req_id = set_request_context(client_req_id)
    start_time = time.time()

    method = request.method
    path = request.url.path

    # Log incoming request (avoid spamming static range streaming chunks at info level)
    if not path.endswith("/stream"):
        logger.info(f"Incoming {method} {path}")
    else:
        logger.debug(f"Streaming chunk request: {method} {path}")

    try:
        response = await call_next(request)
        duration_ms = round((time.time() - start_time) * 1000, 2)
        response.headers["X-Request-ID"] = req_id
        response.headers["X-Response-Time"] = f"{duration_ms}ms"

        # Safe frame permissions header
        response.headers["X-Content-Type-Options"] = "nosniff"

        if not path.endswith("/stream"):
            logger.info(f"Completed {method} {path} - {response.status_code} ({duration_ms}ms)")

        return response

    except HTTPException as http_exc:
        duration_ms = round((time.time() - start_time) * 1000, 2)
        logger.warning(
            f"HTTP {http_exc.status_code} on {method} {path}: {http_exc.detail} ({duration_ms}ms)"
        )
        return JSONResponse(
            status_code=http_exc.status_code,
            content={"detail": http_exc.detail, "request_id": req_id},
            headers={"X-Request-ID": req_id},
        )

    except Exception as unhandled_exc:
        duration_ms = round((time.time() - start_time) * 1000, 2)
        logger.error(
            f"Unhandled exception on {method} {path} ({duration_ms}ms): {unhandled_exc}",
            exc_info=True,
        )
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "detail": "An internal server error occurred. Please try again later.",
                "request_id": req_id,
            },
            headers={"X-Request-ID": req_id},
        )
    finally:
        clear_request_context()


# Custom exception handlers for validation errors
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    req_id = request.headers.get("X-Request-ID", "-")
    errors = exc.errors()
    clean_errors = [{"field": " -> ".join(str(l) for l in err.get("loc", [])), "message": err.get("msg")} for err in errors]
    logger.warning(f"Validation error on {request.method} {request.url.path}: {clean_errors}")
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": clean_errors, "request_id": req_id},
        headers={"X-Request-ID": req_id},
    )


# CORS configuration allowing Vite frontend and cloud deployments (e.g. Render, Vercel)
if "*" in CORS_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"^https?://.*",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Range", "Accept-Ranges", "Content-Length", "Content-Disposition", "X-Request-ID", "X-Response-Time"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=CORS_ORIGINS if CORS_ORIGINS else ["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Range", "Accept-Ranges", "Content-Length", "Content-Disposition", "X-Request-ID", "X-Response-Time"],
    )

# Attach authentication, YouTube, Playlist, Song, and User Data Export routes
app.include_router(auth_router)
app.include_router(youtube_router)
app.include_router(playlists_router)
app.include_router(songs_router)
app.include_router(user_data_router)


@app.get("/", tags=["Health"])
def root_status():
    """Root endpoint for instant cloud health checks."""
    return {
        "name": "Sodo Player API",
        "status": "running",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/api/health",
    }


@app.get("/api/health", tags=["Health"])
def health_check():
    """Health check endpoint to verify backend status."""
    return {"status": "ok", "version": "1.0.0"}


if __name__ == "__main__":
    import os
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
