from fastapi import APIRouter, Depends, Header, Query, Request
from core.rate_limit import limiter
from modules.audit.export_service import ActivityExportService
from modules.audit.filters import AuditFilters, filters_from_query
from modules.audit.service import ActivityLogReader
from modules.audit.schemas import (
    ActivityLogOptions,
    ActivityLogResponse,
    ExportPreview,
    ExportRequest,
    ExportRowsPage,
    ExportStarted,
)
from modules.auth.models import RoleEnum
from api.dependencies.auth import RequireRole

router = APIRouter(prefix="/audit", tags=["Audit"])

# Who can open the Activity Logs page. Checked against the effective role.
LOG_VIEWERS = [RoleEnum.SUPER_ADMIN.value, RoleEnum.SUPER_VIEWER.value]
# Who can export it. The effective role again, so a super admin who is
# impersonating anyone (even a super viewer) can't.
EXPORTERS = [RoleEnum.SUPER_ADMIN.value]


@router.get("/logs", response_model=list[ActivityLogResponse])
async def list_activity_logs(
    user: dict = Depends(RequireRole(LOG_VIEWERS)),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    filters: AuditFilters = Depends(filters_from_query),
    service: ActivityLogReader = Depends(),
):
    """The portal's entries a filter matches, newest first (modules/audit/filters.py).

    Without a range, every entry: the 12-month limit applies to exports only.
    """
    return await service.list(realm_key=user["realm"], filters=filters, limit=limit, offset=offset)


@router.get("/logs/options", response_model=ActivityLogOptions)
async def activity_log_options(
    user: dict = Depends(RequireRole(LOG_VIEWERS)),
    service: ActivityLogReader = Depends(),
):
    """The filter bar's choices: only what the table already shows, plus the
    portal's faculties and departments and what each date preset covers."""
    return await service.options(user["realm"])


# ---------- Export analysis (SUPER_ADMIN only) ----------

@router.get("/export/preview", response_model=ExportPreview)
async def preview_export(
    user: dict = Depends(RequireRole(EXPORTERS)),
    filters: AuditFilters = Depends(filters_from_query),
    service: ActivityExportService = Depends(),
):
    """The live counts in the export modal: matching events, and members listed."""
    return await service.preview(user, filters)


@router.post("/export", response_model=ExportStarted)
@limiter.limit("20/minute")
async def start_export(
    request: Request,
    body: ExportRequest,
    user: dict = Depends(RequireRole(EXPORTERS)),
    service: ActivityExportService = Depends(),
):
    """Validate an export, log it as activity_log.export, and return the token its reads need.

    At most 10 per 15 minutes per person (counted from the log, so it holds
    across Lambda instances); slowapi is a backstop.
    """
    return await service.start(user, body)


@router.get("/export/analysis")
async def export_analysis(
    user: dict = Depends(RequireRole(EXPORTERS)),
    x_export_token: str | None = Header(default=None),
    service: ActivityExportService = Depends(),
):
    """Every ticked section of a logged export, aggregated in the database, times in Lagos."""
    return await service.analysis_for(user, x_export_token)


@router.get("/export/rows", response_model=ExportRowsPage)
async def export_rows(
    user: dict = Depends(RequireRole(EXPORTERS)),
    x_export_token: str | None = Header(default=None),
    after: str | None = Query(None, max_length=100),
    limit: int = Query(5000, ge=1, le=5000),
    service: ActivityExportService = Depends(),
):
    """One page of a logged export's raw entries, oldest first."""
    return await service.rows_for(user, x_export_token, after, limit)
