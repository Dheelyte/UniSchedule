from slowapi import Limiter
from slowapi.util import get_remote_address

from core.config import settings

# Per client IP. Counts live in each process's memory, so on Lambda every warm
# instance counts on its own: a backstop against one noisy client, not a hard
# ceiling. The frontend's caching and Vercel's firewall do the real work.
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["60/minute"],
    enabled=settings.RATE_LIMIT_ENABLED,
)

# Routes only the frontend server calls (they need PUBLIC_EXPORT_KEY). Their
# requests all come from Vercel's few addresses, so the per-visitor default
# would throttle everyone together; this is high enough for real traffic and
# still stops a leaked key from flooding the database.
SERVER_ONLY_LIMIT = "600/minute"
