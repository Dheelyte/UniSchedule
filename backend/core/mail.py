# import smtplib
# from email.message import EmailMessage
# import logging
# import asyncio
# import base64
# from core.config import settings
# from core.assets import UNILAG_LOGO_BASE64

# logger = logging.getLogger(__name__)

# HTML_INVITATION_TEMPLATE = """

# """

# def send_invitation_email_sync(to_email: str, token: str, role: str = "Staff", faculty_name: str | None = None):
#     invite_link = f"{settings.FRONTEND_URL}/register?token={token}"
    
#     msg = EmailMessage()
#     msg['Subject'] = 'Invitation to Join University of Lagos Timetable Manager'
#     msg['From'] = f"University of Lagos Timetable Manager <noreply@unilag.edu.ng>"
#     msg['To'] = to_email
    
#     # Plain text fallback
#     plain_text = f"Hello,\n\nYou have been invited to join the University of Lagos Timetable Manager as a staff member.\n\nRole: {role}\n"
#     if faculty_name:
#         plain_text += f"Faculty: {faculty_name}\n"
#     plain_text += f"\nPlease click the secure link below to set your password and access your dashboard:\n\n{invite_link}\n\nNote: This invitation link expires securely in 7 days.\n\nRegards,\nThe University of Lagos Timetable Team"
#     msg.set_content(plain_text)
    
#     # HTML version
#     faculty_html = f'<div class="info-item"><span class="info-label">Faculty:</span> {faculty_name}</div>' if faculty_name else ""
#     html_content = (
#         HTML_INVITATION_TEMPLATE.replace("{invite_link}", invite_link)
#         .replace("{recipient_email}", to_email)
#         .replace("{role}", role)
#         .replace("{faculty_html}", faculty_html)
#     )
#     msg.add_alternative(html_content, subtype='html')

#     # Add inline logo
#     try:
#         logo_data = base64.b64decode(UNILAG_LOGO_BASE64.split(',')[1])
#         # Add logo to the HTML alternative part
#         msg.get_payload()[1].add_related(logo_data, 'image', 'png', cid='unilag_logo')
#     except Exception as e:
#         logger.error(f"Failed to embed logo: {e}")

#     try:
#         # Standard local SMTP proxy like MailHog or Mailpit
#         with smtplib.SMTP("127.0.0.1", 1025) as server:
#             server.send_message(msg)
#         logger.info(f"Invitation email successfully delivered to {to_email} via SMTP.")
#     except ConnectionRefusedError:
#         # Fallback completely mimicking email content within standard logs
#         logger.warning(f"No SMTP server running on port 1025. Logging outbound email constraint.")
#         print(f"\n\n{'='*60}\n[OUTBOUND EMAIL INTERCEPTED]\nTo: {to_email}\nSubject: {msg['Subject']}\n\n[HTML CONTENT OMITTED IN CONSOLE - CHECK PLAIN TEXT FALLBACK BELOW]\n\n{plain_text}\n{'='*60}\n\n")

# async def send_invitation_email(to_email: str, token: str, role: str = "Staff", faculty_name: str | None = None):
#     # Offload blocking SMTP operations natively into thread pool
#     await asyncio.to_thread(send_invitation_email_sync, to_email, token, role, faculty_name)


from fastapi_mail import (
    ConnectionConfig,
    FastMail,
    MessageSchema,
    MessageType,
)
from fastapi_mail.schemas import MultipartSubtypeEnum
from starlette.datastructures import UploadFile, Headers
import base64
import io

from .config import settings
from .assets import UNILAG_LOGO_BASE64

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
        template_body = {
            "recipient_email": recipient_email,
            "role": role.replace("_", " "),
            "faculty_name": faculty_name if faculty_name else None,
            "invite_link": f"{settings.FRONTEND_URL}/register?token={token}"
        }
        
        logo_bytes = base64.b64decode(UNILAG_LOGO_BASE64.split(",")[1])
        logo_attachment = UploadFile(
            filename="unilag_logo.png",
            file=io.BytesIO(logo_bytes),
            headers=Headers({"Content-ID": "<unilag_logo>", "Content-Disposition": "inline"})
        )
        
        conf.TEMPLATE_FOLDER = settings.TEMPLATE_FOLDER
        
        message = MessageSchema(
            subject="Invitation: UNILAG Timetable Manager",
            recipients=[recipient_email],
            template_body=template_body,
            subtype=MessageType.html,
            attachments=[logo_attachment],
            multipart_subtype=MultipartSubtypeEnum.related
        )
        
        fm = FastMail(conf)
        
        if settings.ENVIRONMENT == "dev":
            # In dev, we can print or still send if configured. 
            # For template rendering in dev without sending, we might need a different approach,
            # but FastMail.send_message handles it.
            # If we want to see the HTML in logs:
            print(f"[DEBUG] Sending Welcome Email to {recipient_email}")
            # fm.send_message will attempt to connect to SMTP. 
            # If we don't have SMTP in dev, we should skip or mock.
            if settings.MAIL_SERVER == "test":
                print("[DEBUG] Mock Welcome Email Sent")
            return
                 
        await fm.send_message(message, template_name="invitation_email.html")
