// Daily ("1 day per page") lecture timetable PDF.
//
// An alternate export layout that sits alongside the standard week grid in
// pdfExport.js; that file is not touched. It mirrors the standard lecture
// export (cover page, page header, venue column, chip styling, blocked-slot
// bands, footer, file naming) and differs only in the time axis: each lecture
// day gets its own page(s), with fixed, equal-width time slots from
// DAILY_EXPORT_FORMATS (timetableLayout.js):
//   - "daily-hourly": Undergraduate, 1-hour slots 8am-6pm   ("8 - 9:00am" ... "5 - 6:00pm")
//   - "daily-ice-30": ICE, 30-minute slots 4pm-10pm         ("4:00 - 4:30pm" ... "9:30 - 10:00pm")
// General Studies sections only print the days that actually have GST schedules.
// Classes that fall outside the window are never silently dropped: they are
// listed in a note under that day's grid, and classes cut by the window edge
// are drawn clipped with an edge marker.

import { jsPDF } from "jspdf";
import { unilagLogoBase64 } from "./logo.js";
import { GENERAL_STUDIES_FACULTY, isGeneralStudiesCourse } from "./utils.js";
import {
	assignLanes,
	buildTimeSlots,
	clipSchedulesToWindow,
	formatCompactClock,
	getDailyExportFormat,
	isScheduleOnline,
	layoutChipLabel,
	mergeAdjacentCourseSchedules,
	ONLINE_ROOM_ID,
	ONLINE_ROOM_NAME,
	scheduleMatchesRoom,
	timeToMinutes,
} from "./timetableLayout.js";
import { UG_CONFIG, DEFAULT_REALM, lecturePdfDays } from "./realm.js";
import { robotoCondensedRegular, robotoCondensedBold } from "./fonts/robotoCondensed.js";

const WEEK_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const PT_TO_MM = 0.3528;
const CAP_RATIO = 0.71;
const CHIP_FONT = "RobotoCondensed";

const normDay = (d) => String(d || "").replace("legacy:", "").trim().toLowerCase();
const isAll = (v) => !v || ["all", "all faculties", "all departments"].includes(String(v).toLowerCase());

/** "08:00" -> "8:00am"; used in notes, where the real (unclipped) time matters. */
function clockWithPeriod(time) {
	const min = timeToMinutes(time);
	return `${formatCompactClock(min)}${Math.floor(min / 60) % 24 < 12 ? "am" : "pm"}`;
}

/** Blocked-band header text, e.g. "1pm - 3pm". */
function blockRangeLabel(startMin, endMin) {
	const p = (min) => (Math.floor(min / 60) % 24 < 12 ? "am" : "pm");
	return `${formatCompactClock(startMin)}${p(startMin)} - ${formatCompactClock(endMin)}${p(endMin)}`;
}

export function exportDailyTimetablePDF({
	schedules,
	blockedSlots = [],
	rooms = [],
	faculties = [],
	departments = [],
	enrollments = [],
	title = "Lecture Timetable",
	session,
	semester,
	faculty,
	department,
	level,
	schoolName = "University of Lagos",
	monochrome = false,
	groupByFaculty = false,
	paperSize = "a3",
	isLocked = false,
	config = UG_CONFIG,
	realmKey = DEFAULT_REALM,
	realmName = null,
	layout = "daily-hourly",
}) {
	const fmt = getDailyExportFormat(layout);
	if (!fmt) throw new Error(`[pdfExportDaily] Unknown daily layout: ${layout}`);
	if (!schedules || schedules.length === 0) return null;

	const pageFormat = paperSize === "a4" ? "a4" : "a3";
	const isA3 = pageFormat === "a3";
	const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: pageFormat });
	const pageW = pageFormat === "a4" ? 297 : 420;
	const pageH = pageFormat === "a4" ? 210 : 297;
	pdf.addFileToVFS("RobotoCondensed-Regular.ttf", robotoCondensedRegular);
	pdf.addFont("RobotoCondensed-Regular.ttf", CHIP_FONT, "normal");
	pdf.addFileToVFS("RobotoCondensed-Bold.ttf", robotoCondensedBold);
	pdf.addFont("RobotoCondensed-Bold.ttf", CHIP_FONT, "bold");

	// ---- Geometry (same as the standard lecture export) ----
	const m = 8;
	const venueColW = 24;
	const tableW = pageW - 2 * m;
	const gridX = m + venueColW;
	const gridW = tableW - venueColW;
	const slots = buildTimeSlots(fmt.startMin, fmt.endMin, fmt.stepMin, fmt.labelStyle);
	const span = fmt.endMin - fmt.startMin;
	const xForMin = (min) => gridX + ((min - fmt.startMin) / span) * gridW;
	const tableStartY = 34;
	const HEAD_H = 14;
	const bodyBottom = pageH - 13;
	const CHIP_H = 6.6;
	const LANE_PITCH = 7.2;
	const ROW_PAD = 1.0;
	const CHIP_INSET = 0.5;

	// ---- Labels & names ----
	const otherRealm = realmKey && realmKey !== DEFAULT_REALM;
	const realmTitlePrefix = otherRealm ? `${String(realmName || realmKey).toUpperCase()} ` : "";
	const realmFilePrefix = otherRealm ? `${String(realmKey).toLowerCase()}_` : "";
	const scopeLabel = [department, level].filter(Boolean).join(" · ") || null;
	const generatedDate = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

	// Section = one faculty's pages. `section.name` is null only for the unscoped fallback.
	const facultyNameFor = (section) => section?.name || (!isAll(faculty) ? String(faculty) : "ALL FACULTIES");
	const titleFor = (section) => {
		if (section?.isGST) return `${realmTitlePrefix}GENERAL STUDIES LECTURE TIMETABLE`;
		if (!isAll(scopeLabel)) return `${realmTitlePrefix}${String(scopeLabel).toUpperCase()} LECTURE TIMETABLE`;
		if (section?.name) return `${realmTitlePrefix}${section.name.toUpperCase()} LECTURE TIMETABLE`;
		if (!isAll(faculty)) return `${realmTitlePrefix}${String(faculty).toUpperCase()} LECTURE TIMETABLE`;
		return `${realmTitlePrefix}GENERAL UNIVERSITY LECTURE TIMETABLE`;
	};

	// Standard export file name convention (mirrors getExportFileName in pdfExport.js)
	const getExportFileName = (titleVal, sessionVal, semesterVal, facultyVal, departmentVal, paperSizeVal) => {
		let baseName = "";
		const isAllFaculty = !facultyVal || facultyVal.toLowerCase() === "all faculties" || facultyVal.toLowerCase() === "all";
		const isAllDept = !departmentVal || departmentVal.toLowerCase() === "all departments" || departmentVal.toLowerCase() === "all";

		if (isAllFaculty && isAllDept) {
			baseName = "General_University_Timetable";
		} else if (!isAllFaculty && isAllDept) {
			baseName = `${facultyVal.replace(/\s+/g, "_")}_Timetable`;
		} else {
			baseName = `${departmentVal.replace(/\s+/g, "_")}_Timetable`;
		}

		const modeStr = (titleVal || "").toLowerCase().includes("exam") ? "Exams" : "Lectures";
		baseName = `${baseName}_${modeStr}`;

		if (sessionVal) {
			baseName = `${baseName}_${sessionVal.replace(/[/]+/g, "-").replace(/\s+/g, "_")}`;
		}
		if (semesterVal) {
			baseName = `${baseName}_${semesterVal.replace(/\s+/g, "_")}`;
		}

		baseName = baseName.replace(/[^a-zA-Z0-9_-]/g, "").replace(/__+/g, "_");

		const suffix = paperSizeVal === "a3" ? "_a3" : "";
		const dateStr = new Date().toISOString().slice(0, 10);
		return `${realmFilePrefix}${baseName.toLowerCase()}_${dateStr}${suffix}.pdf`;
	};

	const roomById = new Map(rooms.map((r) => [r.id, r]));
	const facultyById = new Map(faculties.map((f) => [String(f.id), f]));
	const roomLabel = (room) => {
		if (room.id === ONLINE_ROOM_ID || room.isOnline) return room.name || ONLINE_ROOM_NAME;
		let label = room.name || `Room ${room.id}`;
		const fac = facultyById.get(String(room.facultyId ?? room.faculty_id ?? ""));
		if (fac) label = `${label} (${fac.name.replace(/^faculty of\s*/i, "")})`;
		return label;
	};

	// ---- Days: the realm's lecture days plus any other day in use ----
	const usedDays = schedules.map((s) => s.day);
	const configDays = config.lecture_days || UG_CONFIG.lecture_days;
	const candidateDays = WEEK_ORDER.filter((d) => configDays.includes(d) || usedDays.includes(d));
	const days = lecturePdfDays(candidateDays, usedDays, config);

	// ---- Sections: same grouping as the standard export ----
	// Classes are grouped by the faculties whose students are enrolled (falling back to the
	// owning faculty); General Studies sections come first, "SHARED" last. When a single
	// faculty is exported, only that faculty's section is printed.
	const allFaculty = isAll(faculty);
	const selectedFacultyKey = faculty ? String(faculty).trim().toLowerCase() : "";
	const getEnrolledFaculties = (courseId, ownerFacultyId, ownerFacultyName) => {
		const names = new Set();
		enrollments
			.filter((e) => String(e.course_id) === String(courseId))
			.forEach((e) => {
				const dept = departments.find((d) => String(d.id) === String(e.department_id));
				const fac = dept && dept.facultyId ? facultyById.get(String(dept.facultyId)) : null;
				if (fac) names.add(fac.name);
			});
		if (names.size === 0 && ownerFacultyId) {
			const fac = facultyById.get(String(ownerFacultyId));
			if (fac) names.add(fac.name);
		}
		if (names.size === 0 && ownerFacultyName && ownerFacultyName !== "NIL") names.add(ownerFacultyName);
		if (names.size === 0) names.add(GENERAL_STUDIES_FACULTY);
		return [...names];
	};
	const buildSections = (subset, isGST) => {
		const byFaculty = {};
		subset.forEach((si) => {
			getEnrolledFaculties(si.courseId, si.facultyId, si.facultyName)
				.filter((f) => allFaculty || f.toLowerCase().trim() === selectedFacultyKey)
				.forEach((name) => {
					byFaculty[name] = byFaculty[name] || [];
					if (!byFaculty[name].some((x) => x.id === si.id)) byFaculty[name].push(si);
				});
		});
		return Object.keys(byFaculty)
			.sort((a, b) => (a === "SHARED") - (b === "SHARED") || a.localeCompare(b))
			.map((name) => ({ name, isGST, schedules: byFaculty[name] }));
	};
	const sections = [
		...buildSections(schedules.filter((s) => isGeneralStudiesCourse(s.courseCode)), true),
		...buildSections(schedules.filter((s) => !isGeneralStudiesCourse(s.courseCode)), false),
	];
	if (sections.length === 0) return null;

	// ---- Blocked slots for a day, as minute ranges clipped to the window ----
	const blocksForDay = (day) =>
		blockedSlots
			.filter((b) => b.applies_to !== "EXAM_ONLY" && b.day_of_week && normDay(b.day_of_week) === normDay(day))
			.map((b) => {
				if (b.type === "HOLIDAY" || !b.start_time || !b.end_time) {
					return { name: b.name, startMin: fmt.startMin, endMin: fmt.endMin };
				}
				return {
					name: b.name,
					startMin: Math.max(fmt.startMin, timeToMinutes(b.start_time)),
					endMin: Math.min(fmt.endMin, timeToMinutes(b.end_time)),
				};
			})
			.filter((b) => b.endMin > b.startMin);

	// ---- Line styles (same palette as the standard export) ----
	const setWall = () => {
		pdf.setDrawColor(51, 65, 85);
		pdf.setLineWidth(0.6);
	};
	const setReset = () => {
		pdf.setDrawColor(71, 85, 105);
		pdf.setLineWidth(0.2);
	};
	// Every slot boundary is a clear solid line; whole hours are heavier.
	const setSlotLine = (onHour) => {
		pdf.setDrawColor(...(onHour ? [71, 85, 105] : [100, 116, 139]));
		pdf.setLineWidth(onHour ? 0.28 : 0.2);
	};

	// ---- Cover page (same design as the standard A3 cover, scaled to the paper) ----
	const drawCoverPage = () => {
		const k = pageW / 420;
		const cx = pageW / 2;
		pdf.setFillColor(99, 102, 241);
		pdf.rect(0, 0, pageW, 5 * k, "F");
		pdf.rect(0, pageH - 5 * k, pageW, 5 * k, "F");
		pdf.setDrawColor(226, 232, 240);
		pdf.setLineWidth(0.4);
		pdf.rect(m, 14 * k, pageW - 2 * m, pageH - 28 * k, "D");

		const logoSize = 46 * k;
		try {
			pdf.addImage(unilagLogoBase64, "PNG", cx - logoSize / 2, 58 * k, logoSize, logoSize);
		} catch {
			/* logo is optional */
		}

		pdf.setFont("helvetica", "bold");
		pdf.setFontSize(30 * k);
		pdf.setTextColor(15, 23, 42);
		pdf.text((schoolName || "University of Lagos").toUpperCase(), cx, 120 * k, { align: "center" });

		pdf.setDrawColor(99, 102, 241);
		pdf.setLineWidth(0.8);
		pdf.line(cx - 38 * k, 130 * k, cx + 38 * k, 130 * k);

		pdf.setFont("helvetica", "bold");
		pdf.setFontSize(44 * k);
		pdf.setTextColor(99, 102, 241);
		pdf.text(`${realmTitlePrefix}LECTURE TIMETABLE`, cx, 156 * k, { align: "center" });

		pdf.setFont("helvetica", "normal");
		pdf.setFontSize(15 * k);
		pdf.setTextColor(71, 85, 105);
		pdf.text(`${session} Session   ·   ${semester}`, cx, 170 * k, { align: "center" });

		const rows = [["Faculty", faculty || "All Faculties"]];
		if (department) rows.push(["Department", department]);
		if (level) rows.push(["Level", level]);
		rows.push(["Status", isLocked ? "Final Timetable" : "Draft Timetable"]);
		rows.push(["Generated", generatedDate]);

		const panelW = 210 * k;
		const rowH = 13 * k;
		const panelPadY = 8 * k;
		const panelH = rows.length * rowH + panelPadY;
		const panelX = cx - panelW / 2;
		const panelY = 190 * k;
		pdf.setFillColor(248, 250, 252);
		pdf.setDrawColor(226, 232, 240);
		pdf.setLineWidth(0.3);
		pdf.roundedRect(panelX, panelY, panelW, panelH, 3 * k, 3 * k, "FD");

		rows.forEach((r, i) => {
			const ry = panelY + panelPadY + rowH * i + 3 * k;
			pdf.setFont("helvetica", "bold");
			pdf.setFontSize(9.5 * k);
			pdf.setTextColor(100, 116, 139);
			pdf.text(r[0].toUpperCase(), panelX + 12 * k, ry);
			pdf.setFontSize(12 * k);
			if (r[0] === "Status") pdf.setTextColor(...(isLocked ? [16, 185, 129] : [245, 158, 11]));
			else pdf.setTextColor(15, 23, 42);
			pdf.text(String(r[1]), panelX + panelW - 12 * k, ry, { align: "right" });
			if (i < rows.length - 1) {
				const dividerY = panelY + panelPadY + rowH * (i + 1) - 2 * k;
				pdf.setDrawColor(226, 232, 240);
				pdf.setLineWidth(0.2);
				pdf.line(panelX + 10 * k, dividerY, panelX + panelW - 10 * k, dividerY);
			}
		});

		pdf.setFont("helvetica", "italic");
		pdf.setFontSize(10 * k);
		pdf.setTextColor(148, 163, 184);
		pdf.text("Generated using University of Lagos Timetable Software", cx, pageH - 12 * k, { align: "center" });
	};

	// ---- Chips (same look as the standard lecture chip) ----
	const measureChipPt = (text, size) => {
		pdf.setFont(CHIP_FONT, "bold");
		pdf.setFontSize(size);
		return pdf.getTextWidth(text) * (72 / 25.4);
	};

	const drawChip = (x, y, w, h, si) => {
		const bgCol = monochrome ? [255, 255, 255] : [239, 246, 255];
		const borderCol = monochrome ? [156, 163, 175] : [191, 219, 254];
		const textCol = monochrome ? [75, 85, 99] : [29, 78, 216];
		pdf.setFillColor(...bgCol);
		pdf.setDrawColor(...borderCol);
		pdf.setLineWidth(0.12);
		pdf.roundedRect(x, y, w, h, 0.6, 0.6, "FD");

		const durationMin = Math.max(1, timeToMinutes(si.endTime) - timeToMinutes(si.startTime));
		const lay = layoutChipLabel(si.courseCode || si.courseId, w * (72 / 25.4), h * (72 / 25.4), measureChipPt, { durationMin });
		pdf.setFont(CHIP_FONT, "bold");
		pdf.setFontSize(lay.fontSizePt);
		pdf.setTextColor(...textCol);
		const pitch = lay.fontSizePt * PT_TO_MM * 1.1;
		const cap = lay.fontSizePt * PT_TO_MM * CAP_RATIO;
		if (lay.rotated) {
			const cy = y + h / 2;
			if (lay.lines.length === 1) {
				pdf.text(lay.lines[0], x + w / 2, cy, { align: "center", angle: 90 });
			} else {
				pdf.text(lay.lines[0], x + w / 2 - pitch / 2, cy, { align: "center", angle: 90 });
				pdf.text(lay.lines[1], x + w / 2 + pitch / 2, cy, { align: "center", angle: 90 });
			}
		} else {
			const blockH = (lay.lines.length - 1) * pitch + cap;
			const top = y + (h - blockH) / 2;
			lay.lines.forEach((line, i) => pdf.text(line, x + w / 2, top + cap + i * pitch, { align: "center" }));
		}

		// Edge markers for classes cut by the window ("continues outside").
		if (si.clipped) {
			pdf.setFillColor(...textCol);
			const my = y + h / 2;
			if (timeToMinutes(si.originalStartTime) < fmt.startMin) pdf.triangle(x + 0.4, my, x + 1.6, my - 1, x + 1.6, my + 1, "F");
			if (timeToMinutes(si.originalEndTime) > fmt.endMin) pdf.triangle(x + w - 0.4, my, x + w - 1.6, my - 1, x + w - 1.6, my + 1, "F");
		}
	};

	// ---- Page header (same as the standard lecture export) ----
	const drawPageHeader = (section) => {
		const y = 12;
		const logoSize = 16;
		try {
			pdf.addImage(unilagLogoBase64, "PNG", m, y, logoSize, logoSize);
		} catch {
			/* logo is optional */
		}
		pdf.setFont("helvetica", "bold");
		pdf.setFontSize(16);
		pdf.setTextColor(15, 23, 42);
		pdf.text((schoolName || "University of Lagos").toUpperCase(), m + logoSize + 4, y + 5);

		// Subtitle: session · semester · FACULTY (bold) · department · level
		let facName = facultyNameFor(section).toUpperCase();
		if (section?.isGST) {
			facName = facName.toLowerCase().includes("general studies") ? "GENERAL STUDIES TIMETABLE" : `GENERAL STUDIES TIMETABLE - ${facName}`;
		}
		const parts = [
			{ text: `${session} Session`, bold: false },
			{ text: `   ·   ${semester}   ·   `, bold: false },
			{ text: facName, bold: true },
		];
		if (scopeLabel) parts.push({ text: `   ·   ${scopeLabel}`, bold: false });
		pdf.setFontSize(11);
		pdf.setTextColor(71, 85, 105);
		const startX = m + logoSize + 4;
		const maxW = pageW / 2 - (m + logoSize + 8);
		let curX = startX;
		let curY = y + 12;
		parts.forEach((part) => {
			pdf.setFont("helvetica", part.bold ? "bold" : "normal");
			part.text.split(/(\s+)/).forEach((token) => {
				if (!token) return;
				const w = pdf.getTextWidth(token);
				if (token.trim() === "") {
					curX += w;
					return;
				}
				if (curX + w > startX + maxW) {
					curX = startX;
					curY += 4.5;
				}
				pdf.text(token, curX, curY);
				curX += w;
			});
		});

		// Title and status, right-aligned
		pdf.setFont("helvetica", "bold");
		pdf.setFontSize(14);
		pdf.setTextColor(15, 23, 42);
		const titleLines = pdf.splitTextToSize(titleFor(section).toUpperCase(), pageW / 2 - m - 20);
		titleLines.forEach((line, idx) => pdf.text(line, pageW - m, y + 5 + idx * 5.5, { align: "right" }));
		pdf.setFontSize(10);
		pdf.setTextColor(...(isLocked ? [16, 185, 129] : [245, 158, 11]));
		pdf.text(isLocked ? "FINAL TIMETABLE" : "DRAFT TIMETABLE", pageW - m, y + 12 + (titleLines.length - 1) * 5.5, { align: "right" });
	};

	// Day label over the top half, time-slot labels in the bottom half.
	const drawGridHeader = (day, continued, blocks) => {
		const top = tableStartY;
		pdf.setFillColor(241, 245, 249);
		pdf.rect(m, top, tableW, HEAD_H, "F");
		blocks.forEach((b) => {
			pdf.setFillColor(254, 242, 242);
			pdf.rect(xForMin(b.startMin), top + 7, xForMin(b.endMin) - xForMin(b.startMin), 7, "F");
		});

		// Heavy wall at the start of the day, then the day label.
		setWall();
		pdf.line(gridX, top, gridX, top + HEAD_H);
		setReset();
		pdf.setFont("helvetica", "bold");
		pdf.setFontSize(8.5);
		pdf.setTextColor(15, 23, 42);
		pdf.text((continued ? `${day} (continued)` : day).toUpperCase(), gridX + gridW / 2, top + 5, { align: "center" });

		// Divider between the day label and the time slots.
		pdf.setDrawColor(100, 116, 139);
		pdf.setLineWidth(0.2);
		pdf.line(gridX, top + 7, m + tableW, top + 7);

		const insideBlock = (min) => blocks.some((b) => min > b.startMin && min < b.endMin);
		slots.forEach((slot, i) => {
			if (i > 0 && !insideBlock(slot.startMin)) {
				setSlotLine(slot.startMin % 60 === 0);
				const x = xForMin(slot.startMin);
				pdf.line(x, top + 7, x, top + HEAD_H);
			}
		});
		setReset();

		slots.forEach((slot) => {
			const mid = slot.startMin + (slot.endMin - slot.startMin) / 2;
			if (blocks.some((b) => b.startMin <= slot.startMin && b.endMin >= slot.endMin)) return;
			pdf.setFont("helvetica", "normal");
			pdf.setFontSize(isA3 ? 8 : 6.8);
			pdf.setTextColor(15, 23, 42);
			pdf.text(slot.label, xForMin(mid), top + 11.5, { align: "center" });
		});
		blocks.forEach((b) => {
			const x0 = xForMin(b.startMin);
			const w = xForMin(b.endMin) - x0;
			pdf.setFont("helvetica", "bold");
			pdf.setFontSize(w < 12 ? 5.5 : 7);
			pdf.setTextColor(185, 28, 28);
			pdf.text(blockRangeLabel(b.startMin, b.endMin), x0 + w / 2, top + 11.5, { align: "center", maxWidth: w - 1 });
		});

		setReset();
		pdf.rect(m, top, tableW, HEAD_H, "D");
		return top + HEAD_H;
	};

	const drawNotes = (top, notes) => {
		let y = top + 4;
		pdf.setFont("helvetica", "bold");
		pdf.setFontSize(7.5);
		pdf.setTextColor(15, 23, 42);
		pdf.text(notes.heading, m, y);
		pdf.setFont("helvetica", "normal");
		pdf.setTextColor(100, 116, 139);
		const text = pdf.splitTextToSize(notes.lines.join(";   "), tableW);
		const maxLines = Math.max(1, Math.floor((bodyBottom - y - 1) / 3.2));
		const shown = text.slice(0, maxLines);
		if (text.length > maxLines) shown[shown.length - 1] += "  …(more not shown)";
		shown.forEach((line) => {
			y += 3.2;
			pdf.text(line, m, y);
		});
	};

	// ---- Render ----
	drawCoverPage();
	let pageCount = 0;
	const newPage = () => {
		pdf.addPage(); // the cover is page 1
		pageCount++;
	};

	sections.forEach((section) => {
		// Chip height for the section: tall enough for its longest course code in its narrowest slot.
		let chipH = CHIP_H;
		section.schedules.forEach((s) => {
			const a = Math.max(timeToMinutes(s.startTime), fmt.startMin);
			const b = Math.min(timeToMinutes(s.endTime), fmt.endMin);
			if (b <= a) return;
			const wPt = (((b - a) / span) * gridW - 2 * CHIP_INSET) * (72 / 25.4);
			const lay = layoutChipLabel(s.courseCode || s.courseId, wPt, CHIP_H * (72 / 25.4), measureChipPt, { durationMin: b - a });
			chipH = Math.max(chipH, lay.requiredHeightPt * (25.4 / 72));
		});
		const lanePitch = Math.max(LANE_PITCH, chipH + 0.6);

		// General Studies sections only generate pages for the days that actually have GST schedules.
		const sectionDays = section.isGST
			? days.filter((day) => section.schedules.some((s) => normDay(s.day) === normDay(day)))
			: days;

		sectionDays.forEach((day) => {
			const daySchedules = section.schedules.filter((s) => normDay(s.day) === normDay(day));
			const { inside, outside } = clipSchedulesToWindow(daySchedules, fmt.startMin, fmt.endMin);
			const blocks = blocksForDay(day);

			// Rooms with classes in the window: online first, then by name.
			const roomIds = new Set();
			inside.forEach((s) => {
				if (isScheduleOnline(s)) return;
				(s.roomIds || (s.roomId != null ? [s.roomId] : [])).forEach((id) => roomIds.add(id));
			});
			const dayRooms = [...roomIds]
				.map((id) => roomById.get(id) || { id, name: `Room ${id}` })
				.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
			if (inside.some(isScheduleOnline)) dayRooms.unshift({ id: ONLINE_ROOM_ID, name: ONLINE_ROOM_NAME, isOnline: true });

			pdf.setFont("helvetica", "bold");
			pdf.setFontSize(7.5);
			const rows = dayRooms.map((room) => {
				const placed = assignLanes(mergeAdjacentCourseSchedules(inside.filter((s) => scheduleMatchesRoom(s, room)), { room }));
				const laneCount = placed.length ? placed[0].laneCount : 1;
				const labelLines = pdf.splitTextToSize(roomLabel(room), venueColW - 2);
				const labelH = 8 + (Math.max(1, labelLines.length) - 1) * 3.6;
				const h = Math.max(labelH, laneCount * lanePitch + 2 * ROW_PAD - (lanePitch - chipH));
				return { room, placed, labelLines, laneCount, h };
			});

			// Notes for classes outside, or cut by, the window.
			const noteLines = [
				...outside.map((s) => `${s.courseCode || s.courseId} ${clockWithPeriod(s.startTime)}-${clockWithPeriod(s.endTime)}`),
				...inside.filter((s) => s.clipped).map((s) => `${s.courseCode || s.courseId} ${clockWithPeriod(s.originalStartTime)}-${clockWithPeriod(s.originalEndTime)} (partly shown)`),
			];
			if (noteLines.length) {
				console.warn(`[pdfExportDaily] ${day}: ${noteLines.length} class(es) outside the ${fmt.key} window`, noteLines);
			}
			const notes = noteLines.length ? { heading: "Outside this day's time window:", lines: noteLines } : null;
			const NOTES_H = 14;

			// Paginate rows into pages for this day.
			let rowIdx = 0;
			let continued = false;
			do {
				newPage();
				drawPageHeader(section);
				const top = drawGridHeader(day, continued, blocks);
				let y = top;
				const pageRows = [];
				while (rowIdx < rows.length && (pageRows.length === 0 || y + rows[rowIdx].h <= bodyBottom)) {
					pageRows.push({ ...rows[rowIdx], y });
					y += rows[rowIdx].h;
					rowIdx++;
				}

				if (pageRows.length === 0) {
					y = top + 14;
					pdf.setFillColor(255, 255, 255);
					pdf.rect(m, top, tableW, 14, "F");
					setReset();
					pdf.rect(m, top, tableW, 14, "D");
					pdf.setFont("helvetica", "italic");
					pdf.setFontSize(9);
					pdf.setTextColor(100, 116, 139);
					pdf.text("No lectures scheduled in this window.", m + 3, top + 8.5);
				} else {
					pageRows.forEach((r) => {
						// Venue cell
						setReset();
						pdf.setFillColor(255, 255, 255);
						pdf.rect(m, r.y, venueColW, r.h, "FD");
						pdf.setFont("helvetica", "bold");
						pdf.setFontSize(7.5);
						pdf.setTextColor(15, 23, 42);
						const startY = r.y + (r.h - (r.labelLines.length - 1) * 3.6) / 2 + 1;
						r.labelLines.forEach((line, i) => pdf.text(line, m + venueColW / 2, startY + i * 3.6, { align: "center" }));

						// Day cell, blocked bands under the chips, slot lines
						pdf.setFillColor(255, 255, 255);
						pdf.rect(gridX, r.y, gridW, r.h, "F");
						blocks.forEach((b) => {
							pdf.setFillColor(254, 242, 242);
							pdf.rect(xForMin(b.startMin), r.y, xForMin(b.endMin) - xForMin(b.startMin), r.h, "F");
						});
						slots.forEach((slot, i) => {
							if (i === 0) return;
							setSlotLine(slot.startMin % 60 === 0);
							const x = xForMin(slot.startMin);
							pdf.line(x, r.y, x, r.y + r.h);
						});
						setReset();

						const lanesTop = r.y + (r.h - (r.laneCount * lanePitch - (lanePitch - chipH))) / 2;
						r.placed.forEach((si) => {
							const x0 = xForMin(timeToMinutes(si.startTime));
							const x1 = xForMin(timeToMinutes(si.endTime));
							drawChip(x0 + CHIP_INSET, lanesTop + si.lane * lanePitch, x1 - x0 - 2 * CHIP_INSET, chipH, si);
						});

						// Row border, then the heavy wall at the start of the day.
						setReset();
						pdf.rect(gridX, r.y, gridW, r.h, "D");
						setWall();
						pdf.line(gridX, r.y, gridX, r.y + r.h);
						setReset();
					});

					// Blocked-slot bands: border and one rotated label over the whole grid.
					const gridH = y - top;
					blocks.forEach((b) => {
						const x = xForMin(b.startMin);
						const w = xForMin(b.endMin) - x;
						pdf.setDrawColor(252, 165, 165);
						pdf.setLineWidth(0.25);
						pdf.rect(x, top, w, gridH, "D");
						let fs = 7.5;
						pdf.setFont("helvetica", "bold");
						pdf.setFontSize(fs);
						const name = String(b.name || "Blocked").toUpperCase();
						while (pdf.getTextWidth(name) > gridH - 8 && fs > 6) {
							fs -= 0.5;
							pdf.setFontSize(fs);
						}
						pdf.setTextColor(220, 38, 38);
						const charH = fs * PT_TO_MM * 0.7;
						pdf.text(name, x + w / 2 - charH / 2, top + gridH / 2 + pdf.getTextWidth(name) / 2, { align: "left", angle: 90 });
					});
					setReset();
				}

				const lastPageOfDay = rowIdx >= rows.length;
				if (lastPageOfDay && notes) {
					if (y + NOTES_H > bodyBottom) {
						newPage();
						drawPageHeader(section);
						y = tableStartY;
					}
					drawNotes(y, notes);
				}
				continued = true;
			} while (rowIdx < rows.length);
		});
	});

	// Footers (same as the standard export; the cover is unnumbered).
	const total = pdf.getNumberOfPages();
	for (let p = 2; p <= total; p++) {
		pdf.setPage(p);
		pdf.setFont("helvetica", "normal");
		pdf.setFontSize(7);
		pdf.setTextColor(148, 163, 184);
		pdf.text("University of Lagos Timetable Manager", m, pageH - 6);
		pdf.setFont("helvetica", "bold");
		pdf.setFontSize(9);
		pdf.setTextColor(15, 23, 42);
		pdf.text(`Generated: ${generatedDate}`, pageW / 2, pageH - 6, { align: "center" });
		pdf.setFont("helvetica", "normal");
		pdf.setFontSize(7);
		pdf.setTextColor(148, 163, 184);
		pdf.text(`Page ${p - 1}`, pageW - m, pageH - 6, { align: "right" });
	}
	pdf.setPage(total);

	const fileName = getExportFileName(title, session, semester, faculty, scopeLabel, pageFormat);
	if (typeof window !== "undefined") pdf.save(fileName);
	pdf.fileName = fileName;
	pdf.dailyPageCount = pageCount;
	return pdf;
}
