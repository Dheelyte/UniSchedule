import secrets
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from pydantic import BaseModel

from api.dependencies.auth import get_current_user, resolve_user
from core.config import settings
from core.rate_limit import SERVER_ONLY_LIMIT, limiter
from modules.auth.repository import AuthRepository
from modules.export.schemas import DownloadOptions, ExportBundle, PublicExportBundle, PublishedTimetable
from modules.export.service import ExportService
from modules.export.tickets import TICKET_LIFETIME, issue_ticket, read_ticket
from modules.realms.repository import RealmRepository

router = APIRouter(tags=["Export"])

# Published timetables change only when a timetable is locked or unlocked; the
# frontend server caches these reads for a few minutes.
PUBLIC_CACHE = "private, max-age=300"


def require_export_key(x_export_key: str | None = Header(default=None)) -> None:
    """Only the frontend server may call these reads (it holds PUBLIC_EXPORT_KEY).

    Visitors reach them through the frontend's /api/export routes, which cache
    them, so the database isn't open to the internet. Without a key configured
    they are open in development and closed in production.
    """
    expected = settings.PUBLIC_EXPORT_KEY
    if not expected:
        if settings.is_production:
            raise HTTPException(status_code=403, detail="Public downloads are not configured")
        return
    if not x_export_key or not secrets.compare_digest(x_export_key, expected):
        raise HTTPException(status_code=403, detail="Forbidden")


# Anyone signed in: the same data their timetable page shows, for one semester.
@router.get("/export/bundle", response_model=ExportBundle)
async def export_bundle(
    semester_id: int = Query(...),
    timetable_type: Literal["lecture", "exam"] = Query(...),
    service: ExportService = Depends(),
    user: dict = Depends(get_current_user),
):
    return await service.bundle(user, semester_id, timetable_type)


# ---------- Staff exports, built on the frontend server ----------

class TicketRequest(BaseModel):
    semester_id: int
    timetable_type: Literal["lecture", "exam"]


class TicketResponse(BaseModel):
    ticket: str
    expires_in: int


@router.post("/export/ticket", response_model=TicketResponse)
async def export_ticket(body: TicketRequest, user: dict = Depends(get_current_user)):
    """A two-minute ticket the frontend server uses to read this user's export bundle."""
    return TicketResponse(
        ticket=issue_ticket(user, body.semester_id, body.timetable_type),
        expires_in=int(TICKET_LIFETIME.total_seconds()),
    )


@router.get("/export/staff-bundle", response_model=ExportBundle, dependencies=[Depends(require_export_key)])
@limiter.limit(SERVER_ONLY_LIMIT)
async def staff_export_bundle(
    request: Request,
    semester_id: int = Query(...),
    timetable_type: Literal["lecture", "exam"] = Query(...),
    x_export_ticket: str | None = Header(default=None),
    service: ExportService = Depends(),
    repo: AuthRepository = Depends(),
    realm_repo: RealmRepository = Depends(),
):
    """The /export/bundle a ticket's user would get. For the frontend server only."""
    claims = read_ticket(x_export_ticket, semester_id, timetable_type)
    user = await resolve_user(claims, repo, realm_repo)
    return await service.bundle(user, semester_id, timetable_type)


# ---------- Public: FINAL timetables only, for the frontend server ----------

@router.get("/public/timetables", response_model=list[PublishedTimetable], dependencies=[Depends(require_export_key)])
@limiter.limit(SERVER_ONLY_LIMIT)
async def published_timetables(request: Request, response: Response, service: ExportService = Depends()):
    response.headers["Cache-Control"] = PUBLIC_CACHE
    return await service.published()


@router.get(
    "/public/timetables/{realm_key}/{semester_id}/{kind}/options",
    response_model=DownloadOptions,
    dependencies=[Depends(require_export_key)],
)
@limiter.limit(SERVER_ONLY_LIMIT)
async def download_options(
    request: Request,
    realm_key: str,
    semester_id: int,
    kind: Literal["lecture", "exam", "cbt"],
    response: Response,
    service: ExportService = Depends(),
):
    response.headers["Cache-Control"] = PUBLIC_CACHE
    return await service.options(realm_key.upper(), semester_id, kind)


@router.get("/public/export/bundle", response_model=PublicExportBundle, dependencies=[Depends(require_export_key)])
@limiter.limit(SERVER_ONLY_LIMIT)
async def public_export_bundle(
    request: Request,
    realm: str = Query(...),
    semester_id: int = Query(...),
    timetable_type: Literal["lecture", "exam"] = Query(...),
    service: ExportService = Depends(),
):
    return await service.public_bundle(realm.upper(), semester_id, timetable_type)
