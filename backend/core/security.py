from datetime import datetime, timedelta, timezone
from fastapi import HTTPException, Request
import jwt
import bcrypt
import hashlib
import secrets
from starlette.middleware.base import BaseHTTPMiddleware

from core.config import settings

ALGORITHM = settings.ALGORITHM

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(
            plain_password.encode('utf-8'),
            hashed_password.encode('utf-8')
        )
    except Exception:
        return False

def get_password_hash(password: str) -> str:
    salt = bcrypt.gensalt(rounds=settings.BCRYPT_ROUNDS)
    hashed_bytes = bcrypt.hashpw(password.encode('utf-8'), salt)
    return hashed_bytes.decode('utf-8')

def hash_code(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=1440)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=ALGORITHM)

def decode_access_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


class TokenGenerator:
    @staticmethod
    def generate_code() -> str:
        """Returns (plain_code, hashed_code)."""
        code = secrets.randbelow(1000000)
        return f"{code:06d}"  # Pad with zeros: 000123


class AllowedHostMiddlware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        host = request.headers.get("host", "").split(":")[0]
        if settings.DEBUG or host in settings.ALLOWED_HOSTS:
            return await call_next(request)
        raise HTTPException(status_code=400, detail="Invalid host")


# Sent on every response. Tuned for a JSON API that renders no HTML of its own
# and is never legitimately framed — which is why the CSP is `default-src
# 'none'` rather than the usual `'self'`: this service has no first-party
# resources to allow.
#
# Swagger UI at /docs is the one exception and is handled in dispatch().
SECURITY_HEADERS = {
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    # Not `same-site`: the frontend is served from privacurehealth.com while
    # this API answers on a Lambda function URL, so they are genuinely
    # cross-site and `same-site` would claim a restriction the deployment does
    # not honour. CORS, with its explicit origin allowlist, is the control
    # that actually gates access here.
    "Cross-Origin-Resource-Policy": "cross-origin",
    # Responses here are per-user and must never land in a shared cache.
    "Cache-Control": "no-store",
}

# Swagger UI pulls its bundle from a CDN and renders inline, so the strict
# policy above would leave a blank page. Narrowed rather than dropped.
DOCS_CSP = (
    "default-src 'none'; "
    "script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; "
    "style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; "
    "img-src 'self' https://fastapi.tiangolo.com data:; "
    "connect-src 'self'; "
    "frame-ancestors 'none'"
)

DOCS_PATHS = ("/docs", "/redoc", "/openapi.json")


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """
    Attach the standard security headers to every response.

    Most of these matter less for a JSON API than they would for an HTML app —
    nothing here is framed or rendered — but they are the difference between a
    response that *cannot* be misinterpreted by a browser and one that merely
    happens not to be. ``nosniff`` and ``Referrer-Policy`` are the two doing
    real work: the first stops a JSON body being treated as script, the second
    keeps API paths (which carry patient and organization identifiers) out of
    the ``Referer`` header sent to third-party domains.

    HSTS is set here too, but only in production: issuing it from a local HTTP
    dev server would pin the developer's browser to HTTPS for localhost.
    """

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        for header, value in SECURITY_HEADERS.items():
            response.headers.setdefault(header, value)

        if request.url.path in DOCS_PATHS:
            response.headers["Content-Security-Policy"] = DOCS_CSP

        if settings.is_production:
            response.headers.setdefault(
                "Strict-Transport-Security",
                "max-age=63072000; includeSubDomains; preload",
            )

        return response
