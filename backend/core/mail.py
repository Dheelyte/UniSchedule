import smtplib
from email.message import EmailMessage
import logging
import asyncio
from core.config import settings

logger = logging.getLogger(__name__)

def send_invitation_email_sync(to_email: str, token: str):
    invite_link = f"{settings.FRONTEND_URL}/register?token={token}"
    msg = EmailMessage()
    msg.set_content(f"Hello,\n\nYou have been invited to join the UniSchedule platform as a staff member.\n\nPlease click the secure link below to set your password and access your dashboard:\n\n{invite_link}\n\nNote: This invitation link expires securely in 7 days.\n\nRegards,\nThe UniSchedule System")
    msg['Subject'] = 'Invitation to UniSchedule System'
    msg['From'] = 'noreply@unilag.edu.ng'
    msg['To'] = to_email

    try:
        # Standard local SMTP proxy like MailHog or Mailpit
        with smtplib.SMTP("127.0.0.1", 1025) as server:
            server.send_message(msg)
        logger.info(f"Invitation email successfully delivered to {to_email} via SMTP.")
    except ConnectionRefusedError:
        # Fallback completely mimicking email content within standard logs
        logger.warning(f"No SMTP server running on port 1025. Logging outbound email constraint.")
        print(f"\n\n{'='*60}\n[OUTBOUND EMAIL INTERCEPTED]\nTo: {to_email}\nSubject: {msg['Subject']}\n\n{msg.get_content()}\n{'='*60}\n\n")

async def send_invitation_email(to_email: str, token: str):
    # Offload blocking SMTP operations natively into thread pool
    await asyncio.to_thread(send_invitation_email_sync, to_email, token)
