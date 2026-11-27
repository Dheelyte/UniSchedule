"""The Help centre's content: the user guide, filtered for the signed-in
person's role (modules/help/guide.py). Signed-in only; the public FAQ (/faq)
is built into the website instead."""
from fastapi import APIRouter, Depends, HTTPException

from api.dependencies.auth import get_current_user

router = APIRouter(prefix="/help", tags=["Help centre"])


def _guide():
    # Loaded on first use, not when the app starts.
    from modules.help import guide
    return guide


@router.get("/nav")
async def help_nav(user: dict = Depends(get_current_user)):
    return _guide().nav(user["role"])


@router.get("/search")
async def help_search(user: dict = Depends(get_current_user)):
    return _guide().search_index(user["role"])


@router.get("/pages/{slug}")
async def help_page(slug: str, user: dict = Depends(get_current_user)):
    page = _guide().page_markdown(slug, user["role"]) if slug.replace("-", "").isalnum() else None
    if page is None:
        raise HTTPException(status_code=404, detail="No help page has this name")
    return page
