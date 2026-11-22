"""A Faculty Editor handing their editor access to a Faculty Viewer, and taking it back.

Granting swaps the two roles: the viewer becomes a Faculty Editor and the
original editor a Faculty Viewer. Only the original editor may then retract the
access (back to themselves) or redirect it to another viewer; a super admin may
reverse any active handover. Each change swaps the roles and updates the
handover record in the request's single transaction, so it never leaves the
faculty with two editors or none.
"""
import logging
from datetime import datetime, timezone

from fastapi import Depends, HTTPException

from modules.audit.service import AuditService
from modules.auth.models import RoleEnum, User
from modules.auth.repository import AuthRepository, is_in_realm
from modules.editor_access.models import EditorHandover
from modules.editor_access.repository import EditorAccessRepository
from modules.editor_access.schemas import EditorAccessStatus, HandoverResponse, StaffMember
from modules.notifications.service import NotificationService

logger = logging.getLogger(__name__)

APPLIES_NEXT_TIME = "The change applies the next time you use UniSchedule."


class EditorAccessService:
    def __init__(
        self,
        repo: EditorAccessRepository = Depends(),
        auth_repo: AuthRepository = Depends(),
        audit_service: AuditService = Depends(),
        notification_service: NotificationService = Depends(),
    ):
        self.repo = repo
        self.auth_repo = auth_repo
        self.audit_service = audit_service
        self.notification_service = notification_service

    # --- Reading ---------------------------------------------------------------

    async def status(self, current_user: dict) -> EditorAccessStatus:
        empty = EditorAccessStatus(can_grant=False, granted=None, received=None, candidates=[])
        # A super admin acting as an editor has no handover of their own.
        if current_user.get("impersonating"):
            return empty
        role = current_user.get("role")
        if role not in (RoleEnum.FACULTY_EDITOR.value, RoleEnum.FACULTY_VIEWER.value):
            return empty

        user_id = int(current_user["sub"])
        realm_key = current_user["realm"]
        granted = await self.repo.active_by_grantor(user_id)
        received = await self.repo.active_by_holder(user_id)
        can_grant = role == RoleEnum.FACULTY_EDITOR.value and received is None and granted is None

        candidates = []
        if can_grant or granted:
            faculty_id = granted.faculty_id if granted else current_user.get("faculty_id")
            if faculty_id:
                viewers = await self.repo.viewers_without_handover(faculty_id, realm_key=realm_key, exclude_id=user_id)
                candidates = [StaffMember(id=v.id, email=v.email) for v in viewers]

        return EditorAccessStatus(
            can_grant=can_grant,
            granted=await self._response(granted) if granted else None,
            received=await self._response(received) if received else None,
            candidates=candidates,
        )

    async def list_active(self, current_user: dict) -> list[HandoverResponse]:
        return [await self._response(h) for h in await self.repo.list_active(realm_key=current_user["realm"])]

    async def _response(self, handover: EditorHandover) -> HandoverResponse:
        return HandoverResponse(
            id=handover.id,
            realm_key=handover.realm_key,
            faculty_id=handover.faculty_id,
            faculty_name=await self._faculty_name(handover.faculty_id, handover.realm_key),
            granted_by=StaffMember(id=handover.granted_by_id, email=handover.granted_by_email),
            holder=StaffMember(id=handover.holder_id, email=handover.holder_email),
            started_at=handover.started_at,
        )

    async def _faculty_name(self, faculty_id: str, realm_key: str) -> str:
        faculty = await self.auth_repo.get_faculty(faculty_id, realm_key=realm_key)
        return faculty.name if faculty else faculty_id

    # --- Granting --------------------------------------------------------------

    async def grant(self, current_user: dict, target_id: int) -> None:
        if current_user.get("impersonating"):
            raise HTTPException(status_code=403, detail="Stop acting as another role to hand over editor access")
        if current_user.get("role") != RoleEnum.FACULTY_EDITOR.value:
            raise HTTPException(status_code=403, detail="Only a Faculty Editor can grant editor access")
        user_id = int(current_user["sub"])
        realm_key = current_user["realm"]

        me = (await self.repo.lock_users([user_id])).get(user_id)
        if not me or me.role != RoleEnum.FACULTY_EDITOR or not me.faculty_id:
            raise HTTPException(status_code=403, detail="Only a Faculty Editor can grant editor access")
        given = await self.repo.active_by_holder(me.id)
        if given:
            raise HTTPException(
                status_code=403,
                detail=f"You hold editor access given to you by {given.granted_by_email}, so you can't hand it on. "
                "Only they can pass it to someone else.",
            )
        if await self.repo.active_by_grantor(me.id):
            raise HTTPException(status_code=409, detail="You have already handed over your editor access")
        if target_id == me.id:
            raise HTTPException(status_code=400, detail="You already have editor access")

        target = await self._receiving_viewer(target_id, faculty_id=me.faculty_id, realm_key=realm_key)
        faculty_name = await self._faculty_name(me.faculty_id, realm_key)

        me.role = RoleEnum.FACULTY_VIEWER
        target.role = RoleEnum.FACULTY_EDITOR
        handover = await self.repo.add(EditorHandover(
            realm_key=realm_key,
            faculty_id=me.faculty_id,
            granted_by_id=me.id,
            granted_by_email=me.email,
            holder_id=target.id,
            holder_email=target.email,
        ))

        await self.audit_service.log(
            current_user=current_user,
            action="editor_access.grant",
            entity_type="editor_handover",
            entity_id=handover.id,
            description=f"Faculty Editor {me.email} granted editor access to {target.email} ({faculty_name})",
            extra={
                "granted_by": {"id": me.id, "email": me.email},
                "gained": {"id": target.id, "email": target.email},
                "lost": {"id": me.id, "email": me.email},
                "faculty_id": me.faculty_id,
                "faculty_name": faculty_name,
                "realm_key": realm_key,
            },
        )
        await self._tell_granted(target, me.email, faculty_name)

    async def _receiving_viewer(self, target_id: int, *, faculty_id: str, realm_key: str) -> User:
        """Lock and check the Faculty Viewer who is to receive editor access."""
        target = (await self.repo.lock_users([target_id])).get(target_id)
        # Someone outside the faculty (or realm) behaves like a missing account.
        if (
            not target
            or target.faculty_id != faculty_id
            or not is_in_realm(target.role, target.realm_key, realm_key)
        ):
            raise HTTPException(status_code=404, detail="Staff member not found in your faculty")
        if target.role != RoleEnum.FACULTY_VIEWER:
            raise HTTPException(status_code=400, detail="Editor access can only be given to a Faculty Viewer")
        if not target.is_active:
            raise HTTPException(status_code=400, detail="This account is disabled")
        if await self.repo.active_by_grantor(target.id):
            raise HTTPException(
                status_code=400,
                detail=f"{target.email} has handed their own editor access to someone else and must take it back instead",
            )
        return target

    # --- Retracting ------------------------------------------------------------

    async def retract(self, current_user: dict, to_user_id: int | None) -> None:
        if current_user.get("impersonating"):
            raise HTTPException(status_code=403, detail="Stop acting as another role to retract editor access")
        user_id = int(current_user["sub"])
        realm_key = current_user["realm"]

        me = (await self.repo.lock_users([user_id])).get(user_id)
        handover = await self.repo.active_by_grantor(user_id) if me else None
        if not handover or handover.realm_key != realm_key:
            raise HTTPException(status_code=404, detail="You have no editor access handed over to retract")
        holder = await self._current_holder(handover)
        faculty_name = await self._faculty_name(handover.faculty_id, realm_key)

        if to_user_id is None or to_user_id == me.id:
            me.role = RoleEnum.FACULTY_EDITOR
            holder.role = RoleEnum.FACULTY_VIEWER
            self._end(handover, reason="returned", ended_by=me.id)
            await self.repo.db.flush()
            await self.audit_service.log(
                current_user=current_user,
                action="editor_access.retract",
                entity_type="editor_handover",
                entity_id=handover.id,
                description=f"{me.email} retracted the editor access they gave {holder.email} "
                f"and is Faculty Editor again ({faculty_name})",
                extra={
                    "outcome": "returned",
                    "granted_by": {"id": me.id, "email": me.email},
                    "gained": {"id": me.id, "email": me.email},
                    "lost": {"id": holder.id, "email": holder.email},
                    "faculty_id": handover.faculty_id,
                    "faculty_name": faculty_name,
                    "realm_key": realm_key,
                },
            )
            await self._tell_retracted(holder, me.email, faculty_name)
            return

        if to_user_id == holder.id:
            raise HTTPException(status_code=400, detail=f"{holder.email} already holds your editor access")
        target = await self._receiving_viewer(to_user_id, faculty_id=handover.faculty_id, realm_key=realm_key)

        holder.role = RoleEnum.FACULTY_VIEWER
        target.role = RoleEnum.FACULTY_EDITOR
        self._end(handover, reason="redirected", ended_by=me.id)
        # Flushed first: the partial unique index allows one active handover per editor.
        await self.repo.db.flush()
        redirected = await self.repo.add(EditorHandover(
            realm_key=realm_key,
            faculty_id=handover.faculty_id,
            granted_by_id=me.id,
            granted_by_email=me.email,
            holder_id=target.id,
            holder_email=target.email,
        ))
        await self.audit_service.log(
            current_user=current_user,
            action="editor_access.retract",
            entity_type="editor_handover",
            entity_id=redirected.id,
            description=f"{me.email} retracted the editor access they gave {holder.email} "
            f"and gave it to {target.email} ({faculty_name})",
            extra={
                "outcome": "redirected",
                "granted_by": {"id": me.id, "email": me.email},
                "gained": {"id": target.id, "email": target.email},
                "lost": {"id": holder.id, "email": holder.email},
                "previous_handover_id": handover.id,
                "faculty_id": handover.faculty_id,
                "faculty_name": faculty_name,
                "realm_key": realm_key,
            },
        )
        await self._tell_retracted(holder, me.email, faculty_name)
        await self._tell_granted(target, me.email, faculty_name)

    # --- Super admin reversal --------------------------------------------------

    async def reverse_by_admin(self, current_user: dict, handover_id: int) -> None:
        realm_key = current_user["realm"]
        handover = await self.repo.get_active(handover_id, realm_key=realm_key)
        if not handover:
            raise HTTPException(status_code=404, detail="Handover not found")
        # The original editor's row first, as everywhere else.
        grantor = (await self.repo.lock_users([handover.granted_by_id])).get(handover.granted_by_id)
        holder = await self._current_holder(handover)
        # Re-read under the lock: the editor may have retracted it meanwhile.
        if not grantor or not await self.repo.get_active(handover_id, realm_key=realm_key):
            raise HTTPException(status_code=409, detail="This handover has already ended")
        faculty_name = await self._faculty_name(handover.faculty_id, realm_key)

        grantor.role = RoleEnum.FACULTY_EDITOR
        holder.role = RoleEnum.FACULTY_VIEWER
        self._end(handover, reason="reversed_by_admin", ended_by=int(current_user["sub"]))
        await self.repo.db.flush()

        await self.audit_service.log(
            current_user=current_user,
            action="editor_access.reverse_by_admin",
            entity_type="editor_handover",
            entity_id=handover.id,
            description=f"Super Admin {current_user.get('email')} reversed the editor access handover in "
            f"{faculty_name}: {grantor.email} is Faculty Editor again and {holder.email} is back to Faculty Viewer",
            extra={
                "granted_by": {"id": grantor.id, "email": grantor.email},
                "gained": {"id": grantor.id, "email": grantor.email},
                "lost": {"id": holder.id, "email": holder.email},
                "faculty_id": handover.faculty_id,
                "faculty_name": faculty_name,
                "realm_key": realm_key,
            },
        )
        await self._notify(
            holder,
            "Your Faculty Editor access has been reversed",
            f"A Super Admin has reversed the editing roles in {faculty_name}: {grantor.email} is Faculty Editor "
            f"again and you are back to Faculty Viewer. {APPLIES_NEXT_TIME}",
        )
        await self._notify(
            grantor,
            "Your editing rights have been restored",
            f"A Super Admin has retracted your handover of Faculty Editor access to {holder.email} in "
            f"{faculty_name}. Your editing rights have been restored. {APPLIES_NEXT_TIME}",
        )

    # --- Helpers ---------------------------------------------------------------

    async def _current_holder(self, handover: EditorHandover) -> User:
        holder = (await self.repo.lock_users([handover.holder_id])).get(handover.holder_id)
        if not holder:
            # Deleting someone in an active handover is refused, so this is a corrupt record.
            raise HTTPException(status_code=409, detail="The person holding this editor access no longer exists")
        return holder

    @staticmethod
    def _end(handover: EditorHandover, *, reason: str, ended_by: int) -> None:
        handover.ended_at = datetime.now(timezone.utc)
        handover.end_reason = reason
        handover.ended_by_id = ended_by

    async def _tell_granted(self, user: User, granted_by_email: str, faculty_name: str) -> None:
        await self._notify(
            user,
            "You have been given Faculty Editor access",
            f"{granted_by_email} has given you Faculty Editor access for {faculty_name}. You can now do "
            f"everything a Faculty Editor can until they take it back. {APPLIES_NEXT_TIME}",
        )

    async def _tell_retracted(self, user: User, granted_by_email: str, faculty_name: str) -> None:
        await self._notify(
            user,
            "Your Faculty Editor access has been retracted",
            f"{granted_by_email} has retracted the Faculty Editor access they gave you for {faculty_name}. "
            f"You are back to Faculty Viewer. {APPLIES_NEXT_TIME}",
        )

    async def _notify(self, user: User, title: str, message: str) -> None:
        """In-app and by email, as for role changes; a mail outage must not undo the change."""
        try:
            await self.notification_service.notify(
                user_ids=[user.id], title=title, message=message, link="/", send_email=True,
            )
        except Exception:
            logger.exception("Could not notify user %s about an editor access change", user.id)
