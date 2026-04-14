from fastapi import Depends, HTTPException
from fastapi.responses import Response
from io import BytesIO
import reportlab
from reportlab.lib import colors
from reportlab.lib.pagesizes import landscape, letter
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle
from modules.timetable.repository import TimetableRepository
from modules.auth.models import RoleEnum

class ExportService:
    def __init__(self, timetable_repo: TimetableRepository = Depends()):
        self.timetable_repo = timetable_repo

    async def generate_timetable_pdf(self, current_user: dict, session_id: int, semester_id: int, faculty_id: str | None = None) -> Response:
        if current_user.get("role") == RoleEnum.FACULTY_EDITOR.value:
            if faculty_id is None or current_user.get("faculty_id") != faculty_id:
                raise HTTPException(status_code=403, detail="Not authorized to export data outside your assigned faculty.")
        
        # In a complete implementation, this performs a multi-join across `self.timetable_repo` using `session_id`, `semester_id`, and `faculty_id`.
        # Here we translate the logic out to a layout grid.
        
        buffer = BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=landscape(letter))
        elements = []
        
        data = [
            ["Time / Day", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
            ["08:00 - 10:00", "MTH101 (Rm 1)", "", "PHY101 (Rm 2)", "", "", ""],
            ["10:00 - 12:00", "", "CHM101 (Rm 3)", "", "", "CSC101", ""],
            ["12:00 - 14:00", "LUNCH BREAK", "LUNCH BREAK", "LUNCH BREAK", "LUNCH BREAK", "LUNCH BREAK", "LUNCH BREAK"],
            ["14:00 - 16:00", "", "", "", "BIO101", "", ""],
            ["16:00 - 18:00", "GST101", "", "", "", "", ""]
        ]
        
        t = Table(data, colWidths=[80, 100, 100, 100, 100, 100, 100])
        t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.grey),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('BACKGROUND', (0, 1), (-1, -1), colors.beige),
            ('GRID', (0, 0), (-1, -1), 1, colors.black),
            ('BACKGROUND', (1, 3), (-1, 3), colors.lightgrey),
        ]))
        
        elements.append(t)
        doc.build(elements)
        
        pdf_bytes = buffer.getvalue()
        buffer.close()
        
        return Response(content=pdf_bytes, media_type="application/pdf", headers={
            "Content-Disposition": f"attachment; filename=timetable_export.pdf"
        })
