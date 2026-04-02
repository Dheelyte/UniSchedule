import jsPDF from 'jspdf';

/**
 * Generate a clean, styled PDF timetable without html2canvas.
 * Renders the schedule data directly onto the PDF using jsPDF drawing APIs.
 *
 * @param {Object} options
 * @param {Array} options.schedules - Array of schedule objects with courseCode, roomName, day, startTime, endTime
 * @param {string} options.title - Title of the timetable (e.g., "Lecture Timetable")
 * @param {string} options.subtitle - Subtitle (e.g., faculty name or "All Faculties")
 * @param {string} options.mode - 'lecture' or 'exam'
 */
export function exportTimetablePDF({ schedules, title, subtitle, mode }) {
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 12;

    const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];

    // Colors
    const headerBg = mode === 'lecture' ? [99, 102, 241] : [245, 158, 11]; // purple or amber
    const headerText = [255, 255, 255];
    const gridBg = [22, 24, 40];
    const gridBorder = [50, 55, 80];
    const cellBg = [28, 30, 50];
    const textPrimary = [240, 240, 245];
    const textSecondary = [160, 165, 180];
    const textMuted = [120, 125, 140];

    // Color palette for course events
    const PALETTE = [
        [99, 102, 241], [6, 182, 212], [16, 185, 129], [245, 158, 11],
        [168, 85, 247], [236, 72, 153], [14, 165, 233], [34, 197, 94],
    ];

    // Background fill
    pdf.setFillColor(...gridBg);
    pdf.rect(0, 0, pageW, pageH, 'F');

    // ---- Title area ----
    let y = margin;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(18);
    pdf.setTextColor(...textPrimary);
    pdf.text(title, margin, y + 6);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(...textSecondary);
    pdf.text(subtitle, margin, y + 12);

    // Date
    const dateStr = new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    pdf.text(`Generated: ${dateStr}`, pageW - margin, y + 6, { align: 'right' });
    pdf.text(`${schedules.length} ${mode === 'lecture' ? 'lectures' : 'exams'} scheduled`, pageW - margin, y + 12, { align: 'right' });

    y += 20;

    // ---- Grid dimensions ----
    const tableX = margin;
    const tableW = pageW - margin * 2;
    const timeLabelW = 18;
    const dayW = (tableW - timeLabelW) / 5;
    const headerH = 10;
    const rowH = (pageH - y - margin - headerH) / HOURS.length;

    // ---- Day headers ----
    // Header background
    pdf.setFillColor(...headerBg);
    pdf.roundedRect(tableX, y, tableW, headerH, 2, 2, 'F');

    // Time corner
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7);
    pdf.setTextColor(...headerText);
    pdf.text('TIME', tableX + timeLabelW / 2, y + headerH / 2 + 1.5, { align: 'center' });

    // Day names
    DAYS.forEach((day, i) => {
        const x = tableX + timeLabelW + i * dayW;
        pdf.text(day.toUpperCase(), x + dayW / 2, y + headerH / 2 + 1.5, { align: 'center' });
    });

    y += headerH;

    // ---- Grid rows ----
    HOURS.forEach((hour, rowIdx) => {
        const rowY = y + rowIdx * rowH;

        // Row background (alternating)
        pdf.setFillColor(...(rowIdx % 2 === 0 ? cellBg : gridBg));
        pdf.rect(tableX, rowY, tableW, rowH, 'F');

        // Time label
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(7);
        pdf.setTextColor(...textMuted);
        const timeText = `${hour.toString().padStart(2, '0')}:00`;
        pdf.text(timeText, tableX + timeLabelW / 2, rowY + 5, { align: 'center' });

        // Vertical grid lines
        pdf.setDrawColor(...gridBorder);
        pdf.setLineWidth(0.2);
        for (let i = 0; i <= 5; i++) {
            const lineX = tableX + timeLabelW + i * dayW;
            pdf.line(lineX, rowY, lineX, rowY + rowH);
        }

        // Horizontal grid line
        pdf.line(tableX, rowY + rowH, tableX + tableW, rowY + rowH);
    });

    // ---- Schedule events ----
    const courseColorMap = {};
    let colorIdx = 0;

    schedules.forEach((s) => {
        if (!courseColorMap[s.courseId]) {
            courseColorMap[s.courseId] = PALETTE[colorIdx % PALETTE.length];
            colorIdx++;
        }
    });

    schedules.forEach((s) => {
        const dayIdx = DAYS.indexOf(s.day);
        if (dayIdx < 0) return;

        const [startH, startM] = s.startTime.split(':').map(Number);
        const [endH, endM] = s.endTime.split(':').map(Number);

        const startOffset = (startH - 8) + startM / 60;
        const endOffset = (endH - 8) + endM / 60;
        const duration = endOffset - startOffset;

        if (startOffset < 0 || startOffset >= 10) return;

        const eventX = tableX + timeLabelW + dayIdx * dayW + 1;
        const eventY = y + startOffset * rowH + 1;
        const eventW = dayW - 2;
        const eventH = duration * rowH - 2;

        const color = courseColorMap[s.courseId] || PALETTE[0];

        // Event background
        pdf.setFillColor(color[0], color[1], color[2], 0.2);
        pdf.setFillColor(
            Math.round(gridBg[0] * 0.7 + color[0] * 0.3),
            Math.round(gridBg[1] * 0.7 + color[1] * 0.3),
            Math.round(gridBg[2] * 0.7 + color[2] * 0.3)
        );
        pdf.roundedRect(eventX, eventY, eventW, eventH, 1.5, 1.5, 'F');

        // Left accent border
        pdf.setFillColor(...color);
        pdf.rect(eventX, eventY, 1.2, eventH, 'F');

        // Course code
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(7);
        pdf.setTextColor(...color);
        pdf.text(s.courseCode || s.courseId, eventX + 3, eventY + 4.5);

        // Room name
        if (eventH > 8) {
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(5.5);
            pdf.setTextColor(...textSecondary);
            pdf.text(s.roomName || '', eventX + 3, eventY + 8);
        }

        // Time
        if (eventH > 12) {
            pdf.setFontSize(5);
            pdf.setTextColor(...textMuted);
            pdf.text(`${s.startTime}–${s.endTime}`, eventX + 3, eventY + 11);
        }
    });

    // ---- Footer ----
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6);
    pdf.setTextColor(...textMuted);
    pdf.text('UnilagSchedule — University Timetable Manager', margin, pageH - 4);
    pdf.text(`Page 1 of 1`, pageW - margin, pageH - 4, { align: 'right' });

    // Save
    const fileName = `${title.replace(/\s+/g, '_').toLowerCase()}_${new Date().toISOString().slice(0, 10)}.pdf`;
    pdf.save(fileName);
}
