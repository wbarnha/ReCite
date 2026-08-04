"""Cross-checking citations against the CourtListener database."""

from .cache import DEFAULT_CACHE_PATH, DEFAULT_TTL_SECONDS, LookupCache
from .client import (
    DEFAULT_BASE_URL,
    MAX_CITATIONS_PER_REQUEST,
    TOKEN_ENV_VAR,
    CourtListenerClient,
    CourtListenerError,
    LookupItem,
    MissingTokenError,
    RateLimitedError,
)
from .verifier import DEFAULT_CHUNK_SIZE, VerificationReport, Verifier

__version__ = "0.1.0"

__all__ = [
    "DEFAULT_BASE_URL",
    "DEFAULT_CACHE_PATH",
    "DEFAULT_CHUNK_SIZE",
    "DEFAULT_TTL_SECONDS",
    "MAX_CITATIONS_PER_REQUEST",
    "TOKEN_ENV_VAR",
    "CourtListenerClient",
    "CourtListenerError",
    "LookupCache",
    "LookupItem",
    "MissingTokenError",
    "RateLimitedError",
    "VerificationReport",
    "Verifier",
    "__version__",
]
