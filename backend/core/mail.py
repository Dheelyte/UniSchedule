from fastapi_mail import (
    ConnectionConfig,
    FastMail,
    MessageSchema,
    MessageType,
)

from .config import settings

conf = ConnectionConfig(
    MAIL_USERNAME=settings.MAIL_USERNAME,
    MAIL_PASSWORD=settings.MAIL_PASSWORD,
    MAIL_FROM=settings.MAIL_FROM,
    MAIL_PORT=settings.MAIL_PORT,
    MAIL_SERVER=settings.MAIL_SERVER,
    MAIL_STARTTLS=settings.MAIL_STARTTLS,
    MAIL_SSL_TLS=settings.MAIL_SSL_TLS,
    USE_CREDENTIALS=settings.USE_CREDENTIALS,
    VALIDATE_CERTS=settings.VALIDATE_CERTS,
)


class EmailService:
    @staticmethod
    async def send_invitation_email(recipient_email: str, token: str, role: str, faculty_name: str | None = None):
        invite_link = f"{settings.FRONTEND_URL}/register?token={token}"
        template_body = {
            "recipient_email": recipient_email,
            "role": role.replace("_", " "),
            "faculty_name": faculty_name if faculty_name else None,
            "invite_link": invite_link
        }
        
        # logo_bytes = base64.b64decode(UNILAG_LOGO_BASE64.split(",")[1])
        
        conf.TEMPLATE_FOLDER = settings.TEMPLATE_FOLDER
        
        message = MessageSchema(
            subject="Invitation: UNILAG Timetable Manager",
            recipients=[recipient_email],
            template_body=template_body,
            subtype=MessageType.html
        )
        
        fm = FastMail(conf)
        
        if settings.ENVIRONMENT == "dev":
            print(f"[DEBUG] Email to {recipient_email}: {invite_link}")
            if settings.MAIL_SERVER == "test":
                print("[DEBUG] Mock Welcome Email Sent")
            return

        await fm.send_message(message, template_name="invitation_email.html")

    @staticmethod
    async def send_generic_notification(
        recipients: list[str],
        title: str,
        message: str,
        link: str | None = None,
    ):
        print("Email service triggered")
        if not recipients:
            return

        template_body = {
            "title": title,
            "message": message,
            "link": f"{settings.FRONTEND_URL}{link}" if link else None,
        }

        conf.TEMPLATE_FOLDER = settings.TEMPLATE_FOLDER

        msg = MessageSchema(
            subject=title,
            recipients=recipients,
            template_body=template_body,
            subtype=MessageType.html,
        )

        if settings.ENVIRONMENT == "dev":
            print(f"[DEBUG] Sending notification email to {recipients}: {title}")
            if settings.MAIL_SERVER == "test":
                print("[DEBUG] Mock notification email sent")
            return

        await FastMail(conf).send_message(msg, template_name="notification_email.html")

    @staticmethod
    async def send_password_reset_email(
        recipients: list[str],
        title: str,
        code: str,
    ):
        template_body = {
            "title": title,
            "email": recipients[0],
            "code": code,
        }

        conf.TEMPLATE_FOLDER = settings.TEMPLATE_FOLDER

        msg = MessageSchema(
            subject=title,
            recipients=recipients,
            template_body=template_body,
            subtype=MessageType.html,
        )

        if settings.ENVIRONMENT == "dev":
            print(f"[DEBUG] Sending notification email to {recipients}: {title}. Code: {code}")
            if settings.MAIL_SERVER == "test":
                print("[DEBUG] Mock notification email sent")
            return

        await FastMail(conf).send_message(msg, template_name="password_reset_email.html")
