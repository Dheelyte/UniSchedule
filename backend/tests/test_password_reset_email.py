"""Password reset and the emails behind it.

Dev mode only prints emails, so a missing or broken template is never seen
locally; it showed up in production as an error on the forgot-password page.
These render every email through its real template, as production would.
"""
import re
from pathlib import Path

import pytest
from fastapi_mail import FastMail
from jinja2 import Environment, FileSystemLoader, StrictUndefined

from core import mail
from core.config import settings
from modules.auth.models import RoleEnum

API = "/api/v1"
TEMPLATES = Path(__file__).resolve().parent.parent / "templates"


@pytest.fixture
def rendered(monkeypatch):
    """Send emails as production does, but render them instead of mailing them."""
    sent = []
    env = Environment(loader=FileSystemLoader(TEMPLATES), undefined=StrictUndefined)

    async def fake_send(self, message, template_name=None):
        html = env.get_template(template_name).render(**message.template_body)
        sent.append({"to": [r.email for r in message.recipients], "subject": message.subject, "html": html})

    monkeypatch.setattr(settings, "ENVIRONMENT", "prod")
    monkeypatch.setattr(FastMail, "send_message", fake_send)
    return sent


def test_every_template_the_mailer_names_exists():
    names = set(re.findall(r'template_name="([^"]+)"', Path(mail.__file__).read_text()))
    assert names, "no templates found in core/mail.py"
    missing = [n for n in sorted(names) if not (TEMPLATES / n).is_file()]
    assert not missing, f"missing email templates: {missing}"


async def test_the_reset_email_carries_the_code(rendered):
    await mail.EmailService.send_password_reset_email(["a@example.com"], "Reset your password", "123456")
    [email] = rendered
    assert email["subject"] == "Reset your password"
    assert "123456" in email["html"] and "a@example.com" in email["html"]
    assert f"{settings.PASSWORD_RESET_CODE_EXPIRE_MINUTES} minutes" in email["html"]


async def test_the_other_emails_render(rendered):
    await mail.EmailService.send_generic_notification(["a@example.com"], "Title", "Body", "/requests")
    await mail.EmailService.send_invitation_email("b@example.com", "tok", "FACULTY_ADMIN", "UG", "Undergraduate", "Science")
    assert len(rendered) == 2


async def test_requesting_a_reset_emails_a_code(client, make_user, rendered):
    user = await make_user(RoleEnum.SUPER_ADMIN)
    response = await client.post(f"{API}/auth/request-password-reset", json={"email": user["email"]})
    assert response.status_code == 200
    [email] = rendered
    assert email["to"] == [user["email"]]
    assert re.search(r">\s*\d{6}\s*<", email["html"]), "a six-digit code in the email"


async def test_an_unknown_email_gets_the_same_answer_and_no_email(client, rendered):
    response = await client.post(f"{API}/auth/request-password-reset", json={"email": "nobody@example.com"})
    assert response.status_code == 200
    assert rendered == []


async def test_a_mail_failure_is_a_clear_error_not_a_crash(client, make_user, monkeypatch):
    user = await make_user(RoleEnum.SUPER_ADMIN)

    async def broken(*args, **kwargs):
        raise ConnectionError("mail server down")

    monkeypatch.setattr(settings, "ENVIRONMENT", "prod")
    monkeypatch.setattr(FastMail, "send_message", broken)
    response = await client.post(f"{API}/auth/request-password-reset", json={"email": user["email"]})
    assert response.status_code == 503
    assert "couldn't send the reset email" in response.json()["detail"]
