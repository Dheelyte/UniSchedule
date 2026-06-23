import jsPDF from 'jspdf';
import { unilagLogoBase64 } from '@/lib/logo';
import { GENERAL_STUDIES_FACULTY } from '@/lib/utils';

/**
 * PDF timetable - Rooms × Time grid
 *
 * Layout:
 *  - Rows    = Rooms  (spills over to next page if too many rooms)
 *  - Columns = Time   (fixed 08:00–18:00 range, shown in header)
 *  - One or more pages per day
 *
 * Course cards show: course code only.
 */
export function exportTimetablePDF({ schedules, blockedSlots = [], rooms = [], title, session, semester, faculty, department, schoolName = 'University of Lagos', mode, monochrome = false, groupByFaculty = false, faculties = [] }) {
    if (!schedules || schedules.length === 0) return;

    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    const ACTIVE_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const START_H = 8;       // 08:00
    const END_H = 18;      // 18:00
    const SLOTS = END_H - START_H;   // 10 one-hour columns

    // Build room lookup
    const roomLookup = {};
    rooms.forEach((r) => { roomLookup[r.id] = r; });

    const generatedDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    // ---- Palette (color or black & white) ----
    const pageBg = monochrome ? [255, 255, 255] : [248, 250, 252];
    const white = [255, 255, 255];
    const accentBg = monochrome ? [50, 50, 50] : (mode === 'lecture' ? [99, 102, 241] : [245, 158, 11]);
    const accentFg = [255, 255, 255];
    const gridLine = monochrome ? [120, 120, 120] : [226, 232, 240];
    const rowAlt = monochrome ? [240, 240, 240] : [241, 245, 249];
    const textDark = monochrome ? [0, 0, 0] : [15, 23, 42];
    const textMid = monochrome ? [40, 40, 40] : [71, 85, 105];
    const textFaint = monochrome ? [110, 110, 110] : [148, 163, 184];

    // Light red blocked-slot highlight becomes neutral grey in black & white.
    const blockedFill = monochrome ? [235, 235, 235] : [254, 242, 242];
    const blockedText = monochrome ? [40, 40, 40] : [220, 38, 38];

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

    // In black & white every course card uses the same scheme: white fill, black outline & text.
    const MONO_SCHEME = { bg: [255, 255, 255], border: [0, 0, 0], text: [0, 0, 0] };

    const deptColor = {};
    let ci = 0;
    schedules.forEach((s) => {
        const deptKey = s.departmentId || 'unassigned';
        if (!deptColor[deptKey]) deptColor[deptKey] = monochrome ? MONO_SCHEME : PALETTE[ci++ % PALETTE.length];
    });

    // ---- Group schedules by logical day/week/date ----
    const buildDayGroups = (subset) => {
        const out = [];
        if (mode === 'exam') {
            const dates = [...new Set(subset.map((s) => s.examDate))].sort();
            dates.forEach((dateStr) => {
                const dateObj = new Date(dateStr);
                const ds = subset.filter((s) => s.examDate === dateStr);
                const ptLabel = dateObj.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
                if (ds.length) out.push({ label: ptLabel, day: dateStr, schedules: ds });
            });
        } else {
            ACTIVE_DAYS.forEach((day) => {
                const ds = subset.filter((s) => s.day === day);
                if (ds.length) out.push({ label: day, day, schedules: ds });
            });
        }
        return out;
    };

    const groups = [];
    if (groupByFaculty) {
        // Faculty sections: General Studies first, then alphabetical. Each faculty
        // starts on its own page (see packing below).
        const orderedFaculties = [...new Set(schedules.map((s) => s.facultyName || 'Unassigned'))].sort((a, b) => {
            if (a === GENERAL_STUDIES_FACULTY) return -1;
            if (b === GENERAL_STUDIES_FACULTY) return 1;
            return a.localeCompare(b);
        });
        orderedFaculties.forEach((facName) => {
            const subset = schedules.filter((s) => (s.facultyName || 'Unassigned') === facName);
            buildDayGroups(subset).forEach((g) => {
                groups.push({ ...g, faculty: facName });
            });
        });
    } else {
        buildDayGroups(schedules).forEach((g) => groups.push(g));
    }

    if (!groups.length) return;

    const pageW = 297;
    const pageH = 210;
    const margin = 10;
    const headerH = 8;

    // Height consumed by a block's grid strip header (10) + the time-header row.
    const BLOCK_HEAD_H = 10 + headerH;
    // Vertical gap between two stacked day-blocks on the same page.
    const BLOCK_GAP = 6;

    // Content top: after the main document header on page 1, or page margin on later pages.
    const mainHeaderEndY = margin + 48;
    const bottomLimit = pageH - margin;
    // Height of the per-page faculty section title band (when grouping by faculty).
    const FACULTY_BAND_H = groupByFaculty ? 9 : 0;

    // For exam timetables, stack multiple dates per page when they fit instead of
    // reserving a whole page per date. Lecture timetables keep one day per page.
    const packGroups = mode === 'exam';

    // Helper functions for room labeling and height calculation
    const getRoomLabel = (room) => {
        let roomLabel = room.name || room.id;
        const facId = room.facultyId || room.faculty_id;
        if (facId) {
            const fac = faculties.find(f => f.id === facId);
            if (fac) {
                let facShortName = fac.name;
                const prefix = "Faculty of";
                if (facShortName.toLowerCase().startsWith(prefix.toLowerCase())) {
                    facShortName = facShortName.slice(prefix.length).trim();
                }
                roomLabel = `${roomLabel} (${facShortName})`;
            } else {
                roomLabel = `${roomLabel} ()`;
            }
        }
        return roomLabel;
    };

    const getRoomRowHeight = (room) => {
        const label = getRoomLabel(room);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8);
        const lines = pdf.splitTextToSize(label, 42 - 4); // roomLabelW is 42
        const lineCount = Math.max(1, lines.length);
        return 8 + (lineCount - 1) * 4;
    };

    // Structure groups into physical pages, packing day-blocks vertically.
    const pages = [];
    let curPage = null;
    let curY = 0;
    let globalPageIsFirst = true;
    let curFaculty = null;

    const startNewPage = () => {
        curPage = { hasMainHeader: globalPageIsFirst, blocks: [], faculty: curFaculty };
        pages.push(curPage);
        curY = (globalPageIsFirst ? mainHeaderEndY : margin) + FACULTY_BAND_H;
        globalPageIsFirst = false;
    };

    groups.forEach((group) => {
        const usedRoomIds = [];
        group.schedules.forEach((s) => {
            (s.roomIds || []).forEach((rid) => {
                if (!usedRoomIds.includes(rid)) usedRoomIds.push(rid);
            });
        });

        // Ensure PDF export chunking respects the globally sorted 'rooms' array order
        usedRoomIds.sort((a, b) => {
            return rooms.findIndex(r => r.id === a) - rooms.findIndex(r => r.id === b);
        });

        // Each faculty section starts on a fresh page; lecture mode keeps one day per page.
        const facultyChanged = groupByFaculty && curPage && curPage.faculty !== group.faculty;
        if (!packGroups || !curPage || facultyChanged) {
            curFaculty = group.faculty;
            startNewPage();
        }

        let isFirstChunk = true;
        const pushBlock = (chunkRoomIds, gap, chunkHeight = 0) => {
            curPage.blocks.push({
                label: isFirstChunk ? group.label : `${group.label} (cont.)`,
                schedules: group.schedules,
                rooms: chunkRoomIds.map((rid) => roomLookup[rid] || { id: rid, name: rid }),
                day: group.day,
                gap,
            });
            curY += gap + BLOCK_HEAD_H + chunkHeight;
            isFirstChunk = false;
        };

        if (usedRoomIds.length === 0) {
            // Schedules exist but no rooms assigned — render the day header alone.
            let gap = curPage.blocks.length > 0 ? BLOCK_GAP : 0;
            if (gap > 0 && curY + gap + BLOCK_HEAD_H > bottomLimit) {
                startNewPage();
                gap = 0;
            }
            pushBlock([], gap, 0);
            return;
        }

        let i = 0;
        while (i < usedRoomIds.length) {
            const gap = curPage.blocks.length > 0 ? BLOCK_GAP : 0;
            const remainingSpace = bottomLimit - (curY + gap) - BLOCK_HEAD_H;
            
            if (remainingSpace < 0 && curPage.blocks.length > 0) {
                startNewPage();
                continue;
            }

            let chunk = [];
            let currentChunkHeight = 0;
            let j = i;

            while (j < usedRoomIds.length) {
                const room = roomLookup[usedRoomIds[j]] || { id: usedRoomIds[j], name: usedRoomIds[j] };
                const roomH = getRoomRowHeight(room);
                if (chunk.length > 0 && currentChunkHeight + roomH > remainingSpace) {
                    break;
                }
                chunk.push(usedRoomIds[j]);
                currentChunkHeight += roomH;
                j++;
            }

            if (chunk.length === 0 && j < usedRoomIds.length) {
                // Force at least one room on an empty page
                const room = roomLookup[usedRoomIds[j]] || { id: usedRoomIds[j], name: usedRoomIds[j] };
                chunk.push(usedRoomIds[j]);
                currentChunkHeight += getRoomRowHeight(room);
                j++;
            }

            pushBlock(chunk, gap, currentChunkHeight);
            i = j;
            if (i < usedRoomIds.length) startNewPage();
        }
    });

    // ---- Render each page ----
    pages.forEach((page, pi) => {
        if (pi > 0) pdf.addPage();

        pdf.setFillColor(...pageBg);
        pdf.rect(0, 0, pageW, pageH, 'F');

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
                faculty,
                department
            ].filter(Boolean).join('   ·   ');
            if (metaText) {
                pdf.text(metaText, pageW / 2, curY + 12, { align: 'center' });
            }

            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(11);
            pdf.text((title || '').toUpperCase(), pageW / 2, curY + 19, { align: 'center' });

            curY += 26;
        }

        // ---- Faculty section title band (when grouping by faculty) ----
        if (groupByFaculty && page.faculty) {
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(10);
            pdf.setTextColor(...textDark);
            pdf.text(page.faculty.toUpperCase(), pageW / 2, curY + 4, { align: 'center' });
            pdf.setDrawColor(...accentBg);
            pdf.setLineWidth(0.4);
            pdf.line(margin, curY + 6.5, pageW - margin, curY + 6.5);
            curY += FACULTY_BAND_H;
        }

        // ---- Render each stacked day-block on this page ----
        page.blocks.forEach((block, bi) => {
            const pageRooms = block.rooms;
            if (bi > 0) curY += BLOCK_GAP;

            // ---- Grid Strip Header ----
            pdf.setFillColor(...accentBg);
            pdf.roundedRect(margin, curY, pageW - margin * 2, 8, 1.5, 1.5, 'F');

            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(8);
            pdf.setTextColor(...accentFg);
            pdf.text(block.label, margin + 4, curY + 5.5);

            curY += 10;

            // ---- Grid measurements ----
            const tableX = margin;
            const tableW = pageW - margin * 2;
            const roomLabelW = 42; // Slightly wider for room names with faculty names
            const slotW = (tableW - roomLabelW) / SLOTS;

            // ---- Time header row ----
            pdf.setFillColor(...accentBg);
            pdf.rect(tableX, curY, roomLabelW, headerH, 'F');
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(8);
            pdf.setTextColor(...accentFg);
            pdf.text('ROOM', tableX + roomLabelW / 2, curY + headerH / 2 + 1.5, { align: 'center' });

            for (let h = 0; h < SLOTS; h++) {
                const hx = tableX + roomLabelW + h * slotW;
                pdf.setFillColor(...accentBg);
                pdf.rect(hx, curY, slotW, headerH, 'F');

                pdf.setFont('helvetica', 'bold');
                pdf.setFontSize(7.5);
                pdf.setTextColor(...accentFg);
                const label = `${(START_H + h).toString().padStart(2, '0')}:00`;
                pdf.text(label, hx + slotW / 2, curY + headerH / 2 + 1.5, { align: 'center' });

                pdf.setDrawColor(...gridLine);
                pdf.setLineWidth(0.15);
                pdf.line(hx, curY, hx, curY + headerH);
            }

            curY += headerH;

            // ---- Room rows ----
            let rowY = curY;
            pageRooms.forEach((room, ri) => {
                const rowH = getRoomRowHeight(room);
                const isAlt = ri % 2 === 1;

                pdf.setFillColor(...(isAlt ? rowAlt : white));
                pdf.rect(tableX, rowY, tableW, rowH, 'F');

                // Room label cell
                pdf.setFont('helvetica', 'bold');
                pdf.setFontSize(8); // Adjusted for reduced padding
                pdf.setTextColor(...textDark);

                const roomLabel = getRoomLabel(room);
                const lines = pdf.splitTextToSize(roomLabel, roomLabelW - 4);
                const lineSpacing = 3.6;
                const startY = rowY + (rowH - (lines.length - 1) * lineSpacing) / 2 + 1.2;
                lines.forEach((line, index) => {
                    pdf.text(line, tableX + 2, startY + index * lineSpacing);
                });

                // ---- Draw Blocked Slots Backgrounds ----
                const dayBlocks = blockedSlots.filter(b => {
                    if (mode === 'exam') {
                        if (b.type === 'HOLIDAY') return b.date === block.day;
                        if (b.type === 'EXTRACURRICULAR') {
                            const w = new Date(block.day).toLocaleDateString('en-US', { weekday: 'long' });
                            return b.day_of_week === w;
                        }
                    }
                    return b.day_of_week === block.day;
                }) || [];
                dayBlocks.forEach(b => {
                    pdf.setFillColor(...blockedFill);
                    if (b.type === 'HOLIDAY' || !b.start_time || !b.end_time) {
                        pdf.rect(tableX + roomLabelW, rowY, tableW - roomLabelW, rowH, 'F');
                    } else if (b.type === 'EXTRACURRICULAR' && b.start_time && b.end_time) {
                        const [sH, sM] = b.start_time.split(':').map(Number);
                        const [eH, eM] = b.end_time.split(':').map(Number);
                        const startFrac = (sH - START_H) + sM / 60;
                        const endFrac = (eH - START_H) + eM / 60;

                        if (startFrac < SLOTS && endFrac > 0) {
                            const drawStart = Math.max(0, startFrac);
                            const drawEnd = Math.min(SLOTS, endFrac);
                            const bx = tableX + roomLabelW + drawStart * slotW;
                            const bw = (drawEnd - drawStart) * slotW;
                            pdf.rect(bx, rowY, bw, rowH, 'F');
                        }
                    }
                });

                pdf.setDrawColor(...gridLine);
                pdf.setLineWidth(0.12);
                pdf.line(tableX, rowY + rowH, tableX + tableW, rowY + rowH);

                for (let h = 0; h <= SLOTS; h++) {
                    const lx = tableX + roomLabelW + h * slotW;
                    pdf.line(lx, rowY, lx, rowY + rowH);
                }

                // ---- Draw events in this room ----
                const roomSchedules = block.schedules.filter((s) =>
                    (s.roomIds || []).includes(room.id)
                );

                // Merge courses sharing the exact same time window into a single item
                // (e.g. several exams in one hall) so every course code is shown.
                const itemsByWindow = new Map();
                roomSchedules.forEach((s) => {
                    const key = `${s.startTime}-${s.endTime}`;
                    if (!itemsByWindow.has(key)) {
                        itemsByWindow.set(key, { startTime: s.startTime, endTime: s.endTime, schedules: [] });
                    }
                    itemsByWindow.get(key).schedules.push(s);
                });

                const items = [...itemsByWindow.values()].map((it) => {
                    const [sH, sM] = it.startTime.split(':').map(Number);
                    const [eH, eM] = it.endTime.split(':').map(Number);
                    return { ...it, startFrac: (sH - START_H) + sM / 60, endFrac: (eH - START_H) + eM / 60 };
                }).filter((it) => it.startFrac >= 0 && it.startFrac < SLOTS);

                // Greedy lane assignment: time-overlapping items are stacked into separate
                // horizontal lanes within the row so none are drawn on top of another.
                items.sort((a, b) => a.startFrac - b.startFrac);
                const laneEnds = [];
                items.forEach((it) => {
                    let lane = laneEnds.findIndex((end) => end <= it.startFrac + 1e-6);
                    if (lane === -1) { lane = laneEnds.length; laneEnds.push(it.endFrac); }
                    else laneEnds[lane] = it.endFrac;
                    it.lane = lane;
                });
                const numLanes = Math.max(1, laneEnds.length);

                const evH = rowH - 1;
                const laneH = evH / numLanes;

                items.forEach((it) => {
                    const clampedDur = Math.min(it.endFrac - it.startFrac, SLOTS - it.startFrac);
                    const col = deptColor[it.schedules[0].departmentId || 'unassigned'] || PALETTE[0];
                    const evX = tableX + roomLabelW + it.startFrac * slotW + 0.5;
                    const evY = rowY + 0.5 + it.lane * laneH;
                    const evW = clampedDur * slotW - 1;
                    const cellH = laneH - (numLanes > 1 ? 0.4 : 0);

                    // Event background
                    pdf.setFillColor(...col.bg);
                    pdf.roundedRect(evX, evY, evW, cellH, 0.8, 0.8, 'F');

                    // Outline instead of top accent
                    pdf.setDrawColor(...col.border);
                    pdf.setLineWidth(0.2);
                    pdf.roundedRect(evX, evY, evW, cellH, 0.8, 0.8, 'D');

                    // Course code(s) — list every course sharing this slot
                    const codeFontSize = Math.min(12, cellH * 1.6, evW / 5);
                    if (codeFontSize >= 3) {
                        pdf.setFont('helvetica', 'bold');
                        pdf.setFontSize(codeFontSize);
                        pdf.setTextColor(...col.text);

                        let codeStr = it.schedules.map((x) => x.courseCode || x.courseId).join(', ');
                        while (pdf.getTextWidth(codeStr) > evW - 2 && codeStr.length > 2) {
                            codeStr = codeStr.slice(0, -2) + '…';
                        }
                        pdf.text(codeStr, evX + 1.5, evY + cellH / 2, { baseline: 'middle' });
                    }
                });

                rowY += rowH;
            });

            // Outer box
            const gridH = pageRooms.reduce((sum, r) => sum + getRoomRowHeight(r), 0);

            // ---- Draw Blocked Slots Overlays (Text) ----
            const dayBlocksText = blockedSlots.filter(b => {
                if (mode === 'exam') {
                    if (b.type === 'HOLIDAY') return b.date === block.day;
                    if (b.type === 'EXTRACURRICULAR') {
                        const w = new Date(block.day).toLocaleDateString('en-US', { weekday: 'long' });
                        return b.day_of_week === w;
                    }
                }
                return b.day_of_week === block.day;
            }) || [];
            if (dayBlocksText.length > 0) {
                pdf.setFont('helvetica', 'bolditalic');
                pdf.setFontSize(9);
                pdf.setTextColor(...blockedText);

                dayBlocksText.forEach(b => {
                    if (b.type === 'HOLIDAY') {
                        const tx = tableX + roomLabelW + (tableW - roomLabelW) / 2;
                        const ty = curY + gridH / 2;
                        pdf.text(`HOLIDAY: ${b.name.toUpperCase()}`, tx, ty, { align: 'center', angle: -35 });
                    } else if (!b.start_time || !b.end_time) {
                        const tx = tableX + roomLabelW + (tableW - roomLabelW) / 2;
                        const ty = curY + gridH / 2;
                        pdf.text(`${b.name.toUpperCase()}`, tx, ty, { align: 'center', angle: -35 });
                    } else if (b.type === 'EXTRACURRICULAR' && b.start_time && b.end_time) {
                        const [sH, sM] = b.start_time.split(':').map(Number);
                        const [eH, eM] = b.end_time.split(':').map(Number);
                        const startFrac = (sH - START_H) + sM / 60;
                        const endFrac = (eH - START_H) + eM / 60;
                        if (startFrac < SLOTS && endFrac > 0) {
                            const drawStart = Math.max(0, startFrac);
                            const drawEnd = Math.min(SLOTS, endFrac);
                            const bMidX = tableX + roomLabelW + (drawStart + (drawEnd - drawStart) / 2) * slotW;
                            pdf.text(`${b.name.toUpperCase()}`, bMidX, curY + gridH / 2, { align: 'center', angle: -90 });
                        }
                    }
                });
            }

            pdf.setDrawColor(...gridLine);
            pdf.setLineWidth(0.25);
            pdf.rect(tableX, curY, tableW, gridH);

            // Advance past this block's grid so the next stacked block starts below it.
            curY += gridH;
        });

        // ---- Footer ----
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(5.5);
        pdf.setTextColor(...textFaint);
        pdf.text('University of Lagos Timetable Manager', margin, pageH - 3);
        pdf.text(`Generated: ${generatedDate}`, pageW / 2, pageH - 3, { align: 'center' });
        pdf.text(`Page ${pi + 1} of ${pages.length}`, pageW - margin, pageH - 3, { align: 'right' });
    });

    const fileName = `${title.replace(/\s+/g, '_').toLowerCase()}_${new Date().toISOString().slice(0, 10)}.pdf`;
    pdf.save(fileName);
}
