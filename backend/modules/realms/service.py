from fastapi import Depends, HTTPException
from modules.audit.service import AuditService
from modules.realms.models import Realm
from modules.realms.repository import RealmRepository
from modules.realms.schemas import RealmUpdate


class RealmService:
    def __init__(
        self,
        repo: RealmRepository = Depends(),
        audit_service: AuditService = Depends(),
    ):
        self.repo = repo
        self.audit_service = audit_service

    async def get_realms(self) -> list[Realm]:
        return await self.repo.get_realms()

    async def update_realm(self, key: str, data: RealmUpdate, current_user: dict) -> Realm:
        realm = await self.repo.get_realm(key)
        if not realm:
            raise HTTPException(status_code=404, detail="Realm not found")

        # `data.config` was validated by RealmConfig; existing schedule items are
        # not rewritten, the new rules apply the next time an item is saved.
        changes = data.model_dump(exclude_unset=True)
        if "name" in changes and changes["name"] is None:
            raise HTTPException(status_code=400, detail="Realm name can't be empty")
        for field in ("is_live", "sort_order", "config"):
            if field in changes and changes[field] is None:
                del changes[field]
        for field, value in changes.items():
            setattr(realm, field, value)
        await self.repo.save(realm)

        await self.audit_service.log(
            current_user=current_user,
            action="realm.update",
            entity_type="realm",
            entity_id=realm.key,
            description=f"Updated realm {realm.name} ({realm.key})",
            extra={"changes": changes},
        )
        return realm
