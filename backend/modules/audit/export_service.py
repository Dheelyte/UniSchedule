"""The Activity Logs export: preview counts, the logged request, and the reads it allows.

SUPER_ADMIN only (checked on the effective role by the router). The browser
builds the XLSX or PDF from these reads (src/app/activity/), because the API
runs on Lambda, which buffers responses and has no job queue or file storage.
"""
from datetime import date, datetime, timedelta, timezone

from fastapi import Depends, HTTPException

from modules.audit import impersonation
from modules.audit.analysis import AnalysisRepository, ExportScope, jsonable, lagos_iso
from modules.audit.export_token import ExportGrant, issue_export_token, read_export_token
from modules.audit.filters import (
    LAGOS_TZ_NAME,
    AuditFilters,
    Bounds,
    earliest_export_start,
    filters_to_query,
    parse_filters,
)
from modules.audit.members import (
    LOGIN_NOTE,
    NOT_RECORDED_NOTE,
    Account,
    MemberFacts,
    OpenInvitation,
    build_members,
    narrow,
)
from modules.audit.schemas import ExportRequest
from modules.audit.service import ActivityLogReader, AuditService
from modules.auth.repository import AuthRepository

EXPORT_LIMIT = 10
EXPORT_WINDOW = timedelta(minutes=15)
TOO_LONG = "An export covers at most 12 months. Choose a range of 12 months or less."
NO_EVENTS = "No events match these filters, so there's nothing to export. Tick Members to export the member list on its own."
MAX_ROWS_PAGE = 5000


def file_name(first: date, last: date, fmt: str) -> str:
    return f"unischedule-activity-analysis_{first.isoformat()}_{last.isoformat()}.{fmt}"


def encode_cursor(created_at: datetime, row_id: int) -> str:
    return f"{created_at.astimezone(timezone.utc).isoformat()}~{row_id}"


def decode_cursor(text: str | None) -> tuple[datetime, int] | None:
    if not text:
        return None
    try:
        moment, row_id = text.rsplit("~", 1)
        return datetime.fromisoformat(moment), int(row_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid page cursor.")


class ActivityExportService:
    def __init__(
        self,
        reader: ActivityLogReader = Depends(),
        analysis: AnalysisRepository = Depends(),
        audit: AuditService = Depends(),
        auth_repo: AuthRepository = Depends(),
    ):
        self.reader = reader
        self.analysis = analysis
        self.audit = audit
        self.auth_repo = auth_repo

    # ---------- Range ----------

    async def export_bounds(self, filters: AuditFilters, realm_key: str) -> tuple[Bounds, bool]:
        """The days an export covers, and whether they were shortened to 12 months.

        "All time" and custom ranges over 12 months are refused (the modal turns
        "All time" into the last 12 months first); the current-session preset is
        shortened, as agreed.
        """
        if filters.preset == "all":
            raise HTTPException(status_code=422, detail=TOO_LONG)
        bounds = await self.reader.bounds(filters, realm_key)
        earliest = earliest_export_start(bounds.last)
        if bounds.first < earliest:
            if filters.preset != "session":
                raise HTTPException(status_code=422, detail=TOO_LONG)
            return Bounds(earliest, bounds.last), True
        return bounds, False

    async def scope(self, filters: AuditFilters, realm_key: str) -> tuple[ExportScope, bool]:
        bounds, clamped = await self.export_bounds(filters, realm_key)
        return ExportScope(realm_key, filters, bounds, await self.analysis.max_id()), clamped

    # ---------- Members ----------

    async def _accounts(self, scope: ExportScope) -> tuple[list[Account], list[OpenInvitation], list[int]]:
        """This portal's accounts and open invitations that the users, roles and faculty filters keep,
        and the ids of every invitation to this portal (for the invited-date fallback)."""
        f = scope.filters
        keep = dict(users=f.users, roles=f.roles, faculty=f.faculty)
        accounts = [
            Account(id=u.id, email=u.email, role=u.role.value, faculty_id=u.faculty_id, created_at=u.created_at)
            for u in await self.auth_repo.get_users(realm_key=scope.realm_key)
            if narrow(u.email, u.role.value, u.faculty_id, **keep)
        ]
        open_invitations = await self.auth_repo.get_invitations(realm_key=scope.realm_key)
        invitations = [
            OpenInvitation(id=i.id, email=i.email, role=i.target_role.value, faculty_id=i.faculty_id, expires_at=i.expires_at)
            for i in open_invitations
            if narrow(i.email, i.target_role.value, i.faculty_id, **keep)
        ]
        return accounts, invitations, await self.analysis.realm_invitation_ids(scope.realm_key)

    async def member_counts(self, scope: ExportScope) -> tuple[int, int]:
        accounts, invitations, _ = await self._accounts(scope)
        return len(accounts), len(invitations)

    async def members(self, scope: ExportScope, now: datetime) -> dict:
        accounts, invitations, invitation_ids = await self._accounts(scope)
        emails = sorted({a.email.lower() for a in accounts} | {i.email.lower() for i in invitations})
        by_email, by_id = await self.analysis.invite_entries(scope)
        sign_ins, switches_in = await self.analysis.logins(scope)
        facts = MemberFacts(
            accounts=accounts,
            invitations=invitations,
            faculty_names=await self.analysis.faculty_names(scope.realm_key),
            invite_by_email=by_email,
            invite_by_id=by_id,
            invitation_expiry=await self.analysis.invitation_expiry(emails, invitation_ids),
            sign_ins=sign_ins,
            switches_in=switches_in,
            activity=await self.analysis.member_activity(scope),
            last_activity=await self.analysis.last_activity(scope),
            switch_portals=await self.analysis.switch_portals(scope),
        )
        rows, summary = build_members(facts, realm_key=scope.realm_key, now=now)
        for row in rows:
            row.pop("last_seen_at", None)
        return {"rows": rows, "overview": summary, "notes": [LOGIN_NOTE, NOT_RECORDED_NOTE]}

    # ---------- Impersonation ----------

    async def impersonation_sessions(self, scope: ExportScope) -> dict:
        sessions = impersonation.pair_sessions(await self.analysis.impersonation_events(scope))
        impersonation.attach_actions(sessions, await self.analysis.impersonated_actions(scope))
        f = scope.filters
        shown = [
            s for s in sessions
            if s.overlaps(scope.bounds.start, scope.bounds.end)
            and (not f.users or (s.email or "").lower() in f.users)
            and (not f.roles or s.acting_role in f.roles)
            and (not f.faculty or s.acting_faculty_id == f.faculty)
        ]
        return {
            "total": len(shown),
            "flagged": sum(1 for s in shown if s.flagged),
            "sessions": [
                {
                    "admin_email": s.email,
                    "acting_role": s.acting_role,
                    "acting_faculty_id": s.acting_faculty_id,
                    "started_at": s.started_at,
                    "ended_at": s.ended_at,
                    "ended_by": s.ended_by,
                    "duration_minutes": s.duration_minutes,
                    "flagged": s.flagged,
                    "flag": "No stop recorded" if s.flagged else None,
                    "action_count": s.action_count,
                    "actions": [
                        {"action": a, "count": n} for a, n in sorted(s.actions.items(), key=lambda x: (-x[1], x[0]))
                    ],
                }
                for s in shown
            ],
        }

    # ---------- Endpoints ----------

    async def preview(self, user: dict, filters: AuditFilters) -> dict:
        scope, clamped = await self.scope(filters, user["realm"])
        members, invitations = await self.member_counts(scope)
        return {
            "first": scope.bounds.first,
            "last": scope.bounds.last,
            "clamped": clamped,
            "events": await self.analysis.count(scope),
            "members": members,
            "invitations": invitations,
        }

    async def start(self, user: dict, request: ExportRequest) -> dict:
        filters = parse_filters(request.filters)
        realm_key = user["realm"]
        now = datetime.now(timezone.utc)
        recent = await self.analysis.exports_since(user_id=int(user["sub"]), realm_key=realm_key, since=now - EXPORT_WINDOW)
        if recent >= EXPORT_LIMIT:
            raise HTTPException(
                status_code=429,
                detail=f"You've exported {EXPORT_LIMIT} times in the last 15 minutes. Try again in a few minutes.",
            )
        scope, clamped = await self.scope(filters, realm_key)
        events = await self.analysis.count(scope)
        sections = list(dict.fromkeys(request.sections))
        if request.format == "xlsx" and "raw" not in sections:
            sections.append("raw")  # an XLSX always has a Raw data sheet
        if events == 0 and "members" not in sections:
            raise HTTPException(status_code=422, detail=NO_EVENTS)
        members, invitations = await self.member_counts(scope)
        grant = ExportGrant(
            filters=filters,
            first=scope.bounds.first,
            last=scope.bounds.last,
            max_id=scope.max_id,
            sections=tuple(sections),
            format=request.format,
        )
        await self.audit.log(
            current_user=user,
            action="activity_log.export",
            entity_type="activity_log",
            description=(
                f"Exported the activity log analysis ({request.format.upper()}, {events} events, "
                f"{scope.bounds.first.isoformat()} to {scope.bounds.last.isoformat()})"
            ),
            extra={
                "filters": filters_to_query(filters),
                "from": scope.bounds.first.isoformat(),
                "to": scope.bounds.last.isoformat(),
                "format": request.format,
                "sections": sections,
                "row_count": events,
                "member_count": members if "members" in sections else None,
                "mask_emails": request.mask_emails,
            },
        )
        return {
            "token": issue_export_token(user, grant),
            "first": scope.bounds.first,
            "last": scope.bounds.last,
            "clamped": clamped,
            "events": events,
            "members": members,
            "invitations": invitations,
            "file_name": file_name(scope.bounds.first, scope.bounds.last, request.format),
            "format": request.format,
            "sections": sections,
            "generated_by": user.get("email"),
            "generated_at": lagos_iso(now),
            "timezone": LAGOS_TZ_NAME,
            "portal_key": realm_key,
            "portal_name": user.get("realm_name"),
            "first_entry_at": lagos_iso(await self.reader.repo.first_entry_at(realm_key=realm_key)),
        }

    def _grant_scope(self, user: dict, token: str | None) -> tuple[ExportGrant, ExportScope]:
        grant = read_export_token(token, user)
        return grant, ExportScope(user["realm"], grant.filters, Bounds(grant.first, grant.last), grant.max_id)

    async def analysis_for(self, user: dict, token: str | None) -> dict:
        """Every ticked section except Raw data, which is read page by page."""
        grant, scope = self._grant_scope(user, token)
        wanted = set(grant.sections)
        now = datetime.now(timezone.utc)
        result: dict = {}
        if "summary" in wanted:
            result["summary"] = await self.analysis.summary(scope)
        if "categories" in wanted:
            result["categories"] = await self.analysis.by_category(scope)
        if "users" in wanted:
            result["users"] = await self.analysis.by_user(scope)
        if "roles_portals" in wanted:
            result["roles_portals"] = await self.analysis.by_role_and_portal(scope)
        if "over_time" in wanted:
            result["over_time"] = await self.analysis.over_time(scope)
        if "impersonation" in wanted:
            result["impersonation"] = await self.impersonation_sessions(scope)
        if "sensitive" in wanted:
            result["sensitive"] = await self.analysis.sensitive(scope)
        if "change_requests" in wanted:
            result["change_requests"] = await self.analysis.change_requests(scope)
        if "members" in wanted:
            result["members"] = await self.members(scope, now)
        if "raw" in wanted:
            result["detail_keys"] = await self.analysis.detail_keys(scope)
        return jsonable(result)

    async def rows_for(self, user: dict, token: str | None, after: str | None, limit: int) -> dict:
        grant, scope = self._grant_scope(user, token)
        if "raw" not in grant.sections:
            raise HTTPException(status_code=403, detail="This export doesn't include raw data.")
        limit = max(1, min(limit, MAX_ROWS_PAGE))
        rows = await self.analysis.rows(scope, after=decode_cursor(after), limit=limit)
        next_cursor = encode_cursor(rows[-1]["created_at"], rows[-1]["id"]) if len(rows) == limit else None
        return {"rows": jsonable(rows), "next": next_cursor}
