import smtplib
from email.message import EmailMessage
import logging
import asyncio
import base64
from core.config import settings
from core.assets import UNILAG_LOGO_BASE64

logger = logging.getLogger(__name__)

HTML_INVITATION_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Invitation to Join University of Lagos Timetable Manager</title>
    <style>
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            background-color: #f1f5f9;
            margin: 0;
            padding: 0;
            -webkit-font-smoothing: antialiased;
        }
        .container {
            max-width: 600px;
            margin: 40px auto;
            background-color: #ffffff;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
        }
        .header {
            background-color: #6366f1;
            padding: 32px;
            text-align: center;
        }
        .header img {
            width: 80px;
            height: auto;
            margin-bottom: 16px;
        }
        .header h1 {
            color: #ffffff;
            font-size: 24px;
            margin: 0;
            font-weight: 700;
        }
        .header h3 {
            color: rgba(255, 255, 255, 0.9);
            font-size: 18px;
            margin: 8px 0 0 0;
            font-weight: 600;
        }
        .content {
            padding: 40px;
            color: #0f172a;
            line-height: 1.6;
        }
        .content p {
            margin-bottom: 16px;
            font-size: 16px;
        }
        .info-box {
            background-color: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 20px;
            margin: 24px 0;
        }
        .info-item {
            margin-bottom: 8px;
            font-size: 14px;
            color: #475569;
        }
        .info-label {
            font-weight: 600;
            color: #0f172a;
            width: 100px;
            display: inline-block;
        }
        .btn-container {
            text-align: center;
            margin-top: 32px;
            margin-bottom: 32px;
        }
        .btn {
            background-color: #6366f1;
            color: #ffffff !important;
            padding: 14px 28px;
            border-radius: 8px;
            text-decoration: none;
            font-weight: 600;
            display: inline-block;
            box-shadow: 0 2px 8px rgba(99, 102, 241, 0.3);
        }
        .footer {
            background-color: #f8fafc;
            padding: 24px;
            text-align: center;
            color: #94a3b8;
            font-size: 14px;
            border-top: 1px solid #e2e8f0;
        }
        .expiry-note {
            color: #64748b;
            font-size: 13px;
            font-style: italic;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <img src="cid:unilag_logo" alt="University of Lagos Logo">
            <h1>University of Lagos</h1>
            <h3>Timetable Manager</h3>
        </div>
        <div class="content">
            <p>Hello,</p>
            <p>You have been invited to join the <strong>University of Lagos Timetable Manager</strong> as a staff member.</p>
            
            <div class="info-box">
                <div class="info-item"><span class="info-label">Email:</span> {recipient_email}</div>
                <div class="info-item"><span class="info-label">Role:</span> {role}</div>
                {faculty_html}
            </div>

            <p>Please click the button below to set up your password and access your dashboard:</p>
            <div class="btn-container">
                <a href="{invite_link}" class="btn">Set Up Account</a>
            </div>
            <p class="expiry-note">Note: This invitation link is personal and will expire securely in 7 days.</p>
        </div>
        <div class="footer">
            <p>University of Lagos Timetable Manager</p>
        </div>
    </div>
</body>
</html>
"""

def send_invitation_email_sync(to_email: str, token: str, role: str = "Staff", faculty_name: str | None = None):
    invite_link = f"{settings.FRONTEND_URL}/register?token={token}"
    
    msg = EmailMessage()
    msg['Subject'] = 'Invitation to Join University of Lagos Timetable Manager'
    msg['From'] = f"University of Lagos Timetable Manager <noreply@unilag.edu.ng>"
    msg['To'] = to_email
    
    # Plain text fallback
    plain_text = f"Hello,\n\nYou have been invited to join the University of Lagos Timetable Manager as a staff member.\n\nRole: {role}\n"
    if faculty_name:
        plain_text += f"Faculty: {faculty_name}\n"
    plain_text += f"\nPlease click the secure link below to set your password and access your dashboard:\n\n{invite_link}\n\nNote: This invitation link expires securely in 7 days.\n\nRegards,\nThe University of Lagos Timetable Team"
    msg.set_content(plain_text)
    
    # HTML version
    faculty_html = f'<div class="info-item"><span class="info-label">Faculty:</span> {faculty_name}</div>' if faculty_name else ""
    html_content = HTML_INVITATION_TEMPLATE.format(
        invite_link=invite_link,
        recipient_email=to_email,
        role=role,
        faculty_html=faculty_html
    )
    msg.add_alternative(html_content, subtype='html')

    # Add inline logo
    try:
        logo_data = base64.b64decode(UNILAG_LOGO_BASE64.split(',')[1])
        # Add logo to the HTML alternative part
        msg.get_payload()[1].add_related(logo_data, 'image', 'png', cid='unilag_logo')
    except Exception as e:
        logger.error(f"Failed to embed logo: {e}")

    try:
        # Standard local SMTP proxy like MailHog or Mailpit
        with smtplib.SMTP("127.0.0.1", 1025) as server:
            server.send_message(msg)
        logger.info(f"Invitation email successfully delivered to {to_email} via SMTP.")
    except ConnectionRefusedError:
        # Fallback completely mimicking email content within standard logs
        logger.warning(f"No SMTP server running on port 1025. Logging outbound email constraint.")
        print(f"\n\n{'='*60}\n[OUTBOUND EMAIL INTERCEPTED]\nTo: {to_email}\nSubject: {msg['Subject']}\n\n[HTML CONTENT OMITTED IN CONSOLE - CHECK PLAIN TEXT FALLBACK BELOW]\n\n{plain_text}\n{'='*60}\n\n")

async def send_invitation_email(to_email: str, token: str, role: str = "Staff", faculty_name: str | None = None):
    # Offload blocking SMTP operations natively into thread pool
    await asyncio.to_thread(send_invitation_email_sync, to_email, token, role, faculty_name)
