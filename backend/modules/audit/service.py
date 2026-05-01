import logging
from fastapi import Depends
from modules.audit.models import ActivityLog
from modules.audit.repository import AuditRepository
from modules.auth.repository import AuthRepository

log = logging.getLogger(__name__)


class AuditService:
    def __init__(
        self,
        repo: AuditRepository = Depends(),
        auth_repo: AuthRepository = Depends(),
    ):
        self.repo = repo
        self.auth_repo = auth_repo

    async def log(
        self,
        *,
        current_user: dict | None,
        action: str,
        description: str,
        entity_type: str | None = None,
        entity_id: str | int | None = None,
        extra: dict | None = None,
    ) -> None:
        """Persist an activity log entry. Never raises — audit failures must not
        break the underlying business operation."""
        try:
            user_id = None
            user_email = None
            user_role = None
            user_faculty_id = None
            if current_user:
                sub = current_user.get("sub")
                if sub is not None:
                    try:
                        user_id = int(sub)
                    except (TypeError, ValueError):
                        user_id = None
                user_role = current_user.get("role")
                user_faculty_id = current_user.get("faculty_id")
                user_email = current_user.get("email")
                if not user_email and user_id is not None:
                    u = await self.auth_repo.get_user_by_id(user_id)
                    user_email = u.email if u else None

            entry = ActivityLog(
                user_id=user_id,
                user_email=user_email,
                user_role=user_role,
                user_faculty_id=user_faculty_id,
                action=action,
                entity_type=entity_type,
                entity_id=str(entity_id) if entity_id is not None else None,
                description=description,
                extra=extra,
            )
            await self.repo.add(entry)
        except Exception as e:  # pragma: no cover — defensive
            log.exception("Failed to write activity log: %s", e)

    async def list(
        self,
        limit: int = 100,
        offset: int = 0,
        action_prefix: str | None = None,
        user_id: int | None = None,
    ) -> list[ActivityLog]:
        return await self.repo.list(limit=limit, offset=offset, action_prefix=action_prefix, user_id=user_id)
