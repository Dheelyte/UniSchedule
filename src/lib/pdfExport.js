import jsPDF from 'jspdf';
import { unilagLogoBase64 } from '@/lib/logo';

/**
 * PDF timetable — Rooms × Time grid
 *
 * Layout:
 *  - Rows    = Rooms  (spills over to next page if too many rooms)
 *  - Columns = Time   (fixed 08:00–18:00 range, shown in header)
 *  - One or more pages per day
 *
 * Course cards show: course code only.
 */
export function exportTimetablePDF({ schedules, rooms = [], title, session, semester, faculty, schoolName = 'University of Lagos', mode }) {
    if (!schedules || schedules.length === 0) return;

    const ACTIVE_DAYS = mode === 'exam'
        ? ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
        : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const START_H = 8;       // 08:00
    const END_H = 18;      // 18:00
    const SLOTS = END_H - START_H;   // 10 one-hour columns

    // Build room lookup
    const roomLookup = {};
    rooms.forEach((r) => { roomLookup[r.id] = r; });

    // ---- Light-mode palette ----
    const pageBg = [248, 250, 252];
    const white = [255, 255, 255];
    const accentBg = mode === 'lecture' ? [99, 102, 241] : [245, 158, 11];
    const accentFg = [255, 255, 255];
    const gridLine = [226, 232, 240];
    const rowAlt = [241, 245, 249];
    const textDark = [15, 23, 42];
    const textMid = [71, 85, 105];
    const textFaint = [148, 163, 184];

    const PALETTE = [
        { bg: [238, 240, 255], border: [99, 102, 241], text: [67, 56, 202] },
        { bg: [224, 247, 250], border: [6, 182, 212], text: [14, 116, 144] },
        { bg: [220, 252, 231], border: [16, 185, 129], text: [4, 120, 87] },
        { bg: [255, 247, 237], border: [245, 158, 11], text: [180, 83, 9] },
        { bg: [243, 232, 255], border: [168, 85, 247], text: [124, 58, 237] },
        { bg: [253, 232, 243], border: [236, 72, 153], text: [190, 24, 93] },
        { bg: [224, 242, 254], border: [14, 165, 233], text: [3, 105, 161] },
        { bg: [220, 252, 231], border: [34, 197, 94], text: [21, 128, 61] },
        { bg: [255, 237, 213], border: [234, 88, 12], text: [194, 65, 12] },
        { bg: [254, 226, 226], border: [239, 68, 68], text: [185, 28, 28] },
    ];

    const deptColor = {};
    let ci = 0;
    schedules.forEach((s) => {
        const deptKey = s.departmentId || 'unassigned';
        if (!deptColor[deptKey]) deptColor[deptKey] = PALETTE[ci++ % PALETTE.length];
    });

    // ---- Group schedules by logical day/week ----
    const groups = [];
    if (mode === 'exam') {
        const weeks = [...new Set(schedules.map((s) => s.week || 1))].sort((a, b) => a - b);
        weeks.forEach((week) => {
            ACTIVE_DAYS.forEach((day) => {
                const ds = schedules.filter((s) => s.day === day && (s.week || 1) === week);
                if (ds.length) groups.push({ label: `Week ${week} — ${day}`, day, week, schedules: ds });
            });
        });
    } else {
        ACTIVE_DAYS.forEach((day) => {
            const ds = schedules.filter((s) => s.day === day);
            if (ds.length) groups.push({ label: day, day, schedules: ds });
        });
    }

    if (!groups.length) return;

    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageW = 297;
    const pageH = 210;
    const margin = 10;
    const headerH = 8;

    // Page 1 has Logo (18), School Name (6), Meta (6), Title (7), Margin to strip (15) = 52
    const firstPageStartY = margin + 52 + 10 + headerH;
    const subPageStartY = margin + 10 + headerH;

    const availH_first = pageH - firstPageStartY - margin;
    const availH_sub = pageH - subPageStartY - margin;

    const ROW_H = 8;
    const maxFirstRows = Math.max(1, Math.floor(availH_first / ROW_H));
    const maxSubRows = Math.max(1, Math.floor(availH_sub / ROW_H));

    // Structure groups into physical pages based on dynamic MAX_ROWS
    const pages = [];
    let globalPageIsFirst = true;

    groups.forEach((group) => {
        const usedRoomIds = [];
        group.schedules.forEach((s) => {
            (s.roomIds || []).forEach((rid) => {
                if (!usedRoomIds.includes(rid)) usedRoomIds.push(rid);
            });
        });

        let i = 0;
        let isFirstDayChunk = true;

        if (usedRoomIds.length === 0) {
            // Push an empty page if there are schedules but no rooms assigned
            pages.push({
                label: group.label,
                hasMainHeader: globalPageIsFirst,
                schedules: group.schedules,
                rooms: []
            });
            globalPageIsFirst = false;
        }

        // Split rooms into chunks dynamically
        while (i < usedRoomIds.length) {
            const allowedRows = globalPageIsFirst ? maxFirstRows : maxSubRows;
            const chunkRoomIds = usedRoomIds.slice(i, i + allowedRows);
            const isContinuation = !isFirstDayChunk;
            const ptLabel = isContinuation ? `${group.label} (cont.)` : group.label;

            pages.push({
                label: ptLabel,
                hasMainHeader: globalPageIsFirst,
                schedules: group.schedules,
                rooms: chunkRoomIds.map((rid) => roomLookup[rid] || { id: rid, name: rid }),
            });

            i += allowedRows;
            isFirstDayChunk = false;
            globalPageIsFirst = false;
        }
    });

    // ---- Render each page ----
    pages.forEach((page, pi) => {
        if (pi > 0) pdf.addPage();

        pdf.setFillColor(...pageBg);
        pdf.rect(0, 0, pageW, pageH, 'F');

        const pageRooms = page.rooms;

        // ---- Document Header ----
        let curY = margin;

        if (page.hasMainHeader) {
            // Draw Logo
            const logoSize = 18;
            pdf.addImage(unilagLogoBase64, 'PNG', pageW / 2 - logoSize / 2, curY, logoSize, logoSize);
            curY += logoSize + 4;

            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(14);
            pdf.setTextColor(...textDark);
            pdf.text((schoolName || '').toUpperCase(), pageW / 2, curY + 6, { align: 'center' });

            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(9);
            pdf.setTextColor(...textMid);
            const metaText = [
                session ? `${session} Session` : null,
                semester,
                faculty
            ].filter(Boolean).join('   ·   ');
            if (metaText) {
                pdf.text(metaText, pageW / 2, curY + 12, { align: 'center' });
            }

            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(11);
            pdf.text((title || '').toUpperCase(), pageW / 2, curY + 19, { align: 'center' });

            curY += 26;
        }

        // ---- Grid Strip Header ----
        pdf.setFillColor(...accentBg);
        pdf.roundedRect(margin, curY, pageW - margin * 2, 8, 1.5, 1.5, 'F');

        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8);
        pdf.setTextColor(...accentFg);
        pdf.text(page.label, margin + 4, curY + 5.5);

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(6);
        const dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
        pdf.text(`Generated: ${dateStr}`, pageW - margin - 2, curY + 5.5, { align: 'right' });

        curY += 10;

        // ---- Grid measurements ----
        const tableX = margin;
        const tableW = pageW - margin * 2;
        const roomLabelW = 34; // Slightly wider for room names
        const slotW = (tableW - roomLabelW) / SLOTS;

        // ---- Time header row ----
        pdf.setFillColor(...accentBg);
        pdf.rect(tableX, curY, roomLabelW, headerH, 'F');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(6);
        pdf.setTextColor(...accentFg);
        pdf.text('ROOM', tableX + roomLabelW / 2, curY + headerH / 2 + 1.5, { align: 'center' });

        for (let h = 0; h < SLOTS; h++) {
            const hx = tableX + roomLabelW + h * slotW;
            pdf.setFillColor(...accentBg);
            pdf.rect(hx, curY, slotW, headerH, 'F');

            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(5.5);
            pdf.setTextColor(...accentFg);
            const label = `${(START_H + h).toString().padStart(2, '0')}:00`;
            pdf.text(label, hx + slotW / 2, curY + headerH / 2 + 1.5, { align: 'center' });

            pdf.setDrawColor(...gridLine);
            pdf.setLineWidth(0.15);
            pdf.line(hx, curY, hx, curY + headerH);
        }

        curY += headerH;

        // ---- Room rows ----
        pageRooms.forEach((room, ri) => {
            const rowY = curY + ri * ROW_H;
            const isAlt = ri % 2 === 1;

            pdf.setFillColor(...(isAlt ? rowAlt : white));
            pdf.rect(tableX, rowY, tableW, ROW_H, 'F');

            // Room label cell
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(6); // Adjusted for reduced padding
            pdf.setTextColor(...textDark);

            let roomLabel = room.name || room.id;
            while (pdf.getTextWidth(roomLabel) > roomLabelW - 3 && roomLabel.length > 3) {
                roomLabel = roomLabel.slice(0, -2) + '…';
            }
            pdf.text(roomLabel, tableX + 2, rowY + ROW_H / 2 + 1.5);

            pdf.setDrawColor(...gridLine);
            pdf.setLineWidth(0.12);
            pdf.line(tableX, rowY + ROW_H, tableX + tableW, rowY + ROW_H);

            for (let h = 0; h <= SLOTS; h++) {
                const lx = tableX + roomLabelW + h * slotW;
                pdf.line(lx, rowY, lx, rowY + ROW_H);
            }

            // ---- Draw events in this room ----
            const roomSchedules = page.schedules.filter((s) =>
                (s.roomIds || []).includes(room.id)
            );

            roomSchedules.forEach((s) => {
                const [sH, sM] = s.startTime.split(':').map(Number);
                const [eH, eM] = s.endTime.split(':').map(Number);
                const startFrac = (sH - START_H) + sM / 60;
                const endFrac = (eH - START_H) + eM / 60;
                const dur = endFrac - startFrac;

                if (startFrac < 0 || startFrac >= SLOTS) return;
                const clampedDur = Math.min(dur, SLOTS - startFrac);

                const col = deptColor[s.departmentId || 'unassigned'] || PALETTE[0];
                const evX = tableX + roomLabelW + startFrac * slotW + 0.5;
                const evY = rowY + 0.5;
                const evW = clampedDur * slotW - 1;
                const evH = ROW_H - 1;

                // Event background
                pdf.setFillColor(...col.bg);
                pdf.roundedRect(evX, evY, evW, evH, 0.8, 0.8, 'F');

                // Outline instead of top accent
                pdf.setDrawColor(...col.border);
                pdf.setLineWidth(0.2);
                pdf.roundedRect(evX, evY, evW, evH, 0.8, 0.8, 'D');

                // Course code only
                const codeFontSize = Math.min(6, evH * 0.55, evW / 5);
                if (codeFontSize >= 3) {
                    pdf.setFont('helvetica', 'bold');
                    pdf.setFontSize(codeFontSize);
                    pdf.setTextColor(...col.text);

                    let code = s.courseCode || s.courseId;
                    while (pdf.getTextWidth(code) > evW - 2 && code.length > 2) {
                        code = code.slice(0, -2) + '…';
                    }
                    pdf.text(code, evX + 1.5, evY + evH / 2 + codeFontSize * 0.35);
                }
            });
        });

        // Outer box
        const gridH = pageRooms.length * ROW_H;
        pdf.setDrawColor(...gridLine);
        pdf.setLineWidth(0.25);
        pdf.rect(tableX, curY, tableW, gridH);

        // ---- Footer ----
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(5.5);
        pdf.setTextColor(...textFaint);
        pdf.text('UnilagSchedule — University Timetable Manager', margin, pageH - 3);
        pdf.text(`Page ${pi + 1} of ${pages.length}`, pageW - margin, pageH - 3, { align: 'right' });
    });

    const fileName = `${title.replace(/\s+/g, '_').toLowerCase()}_${new Date().toISOString().slice(0, 10)}.pdf`;
    pdf.save(fileName);
}
