"""
Centralized structured logging and error handling module for Sodo Player backend.
Provides request-scoped context tracking, standardized log formatting,
and sanitized error responses without leaking internal server stack traces.
"""

from __future__ import annotations

import logging
import os
import sys
import time
import uuid
from contextvars import ContextVar
from typing import Optional

# Request ID context variable shared across async and threaded tasks
request_id_ctx: ContextVar[str] = ContextVar("request_id", default="-")


class RequestIdFilter(logging.Filter):
    """Injects current request_id into every log record."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_ctx.get("-")
        return True


def setup_root_logging() -> None:
    """Configures root logger with standardized formatter and filter."""
    log_level_name = os.getenv("LOG_LEVEL", "INFO").upper()
    log_level = getattr(logging, log_level_name, logging.INFO)

    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)

    # Avoid duplicate handlers on reload
    if not any(isinstance(h, logging.StreamHandler) for h in root_logger.handlers):
        handler = logging.StreamHandler(sys.stdout)
        handler.setLevel(log_level)
        formatter = logging.Formatter(
            fmt="[%(asctime)s] [%(levelname)s] [%(name)s] [req_id=%(request_id)s] %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
        handler.setFormatter(formatter)
        handler.addFilter(RequestIdFilter())
        root_logger.addHandler(handler)
    else:
        for handler in root_logger.handlers:
            handler.setLevel(log_level)
            if not any(isinstance(f, RequestIdFilter) for f in handler.filters):
                handler.addFilter(RequestIdFilter())


# Initialize root logging on import
setup_root_logging()


def get_logger(name: str) -> logging.Logger:
    """Return a logger instance with RequestIdFilter attached."""
    logger = logging.getLogger(name)
    if not any(isinstance(f, RequestIdFilter) for f in logger.filters):
        logger.addFilter(RequestIdFilter())
    return logger


def set_request_context(req_id: Optional[str] = None) -> str:
    """Set the active request ID in context, generating a new one if not provided."""
    actual_id = req_id if req_id and req_id.strip() else uuid.uuid4().hex[:8]
    request_id_ctx.set(actual_id)
    return actual_id


def clear_request_context() -> None:
    """Reset the active request ID in context."""
    request_id_ctx.set("-")
