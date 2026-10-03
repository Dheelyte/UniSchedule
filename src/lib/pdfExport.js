import jsPDF from "jspdf";
import { unilagLogoBase64 } from "@/lib/logo";
import { GENERAL_STUDIES_FACULTY, isGeneralStudiesCourse } from "@/lib/utils";
import { assignLanes, computeDayRange, fitChipText } from "@/lib/timetableLayout";
import { robotoCondensedRegular, robotoCondensedBold } from "@/lib/fonts/robotoCondensed";

export function exportTimetablePDF({
	schedules,
	blockedSlots = [],
	rooms = [],
	faculties = [],
	departments = [],
	enrollments = [],
	title,
	session,
	semester,
	faculty,
	department,
	level,
	schoolName = "University of Lagos",
	mode,
	monochrome = false,
	groupByFaculty = false,
	paperSize = "a4",
	structured = false,
	gstOnly = false,
	isLocked = false,
}) {
	if (!schedules || schedules.length === 0) return;

	// Combined "Department · Level" label used for subtitles/titles/filenames.
	// The cover page below renders department and level as separate labeled
	// rows instead, so it never conflates a level-only export with "Department".
	const scopeLabel = [department, level].filter(Boolean).join(" · ") || null;



	// Helper: get Monday of date string
	const getMondayOfDate = (dateStr) => {
		const d = new Date(dateStr);
		const day = d.getDay();
		const diff = d.getDate() - day + (day === 0 ? -6 : 1);
		const monday = new Date(d.setDate(diff));
		return monday.toISOString().slice(0, 10);
	};

	// Helper: format room label with brackets and faculty name (common helper)
	const getRoomLabel = (room) => {
		let roomLabel = room.name || room.id;
		const facId = room.facultyId || room.faculty_id;
		if (facId) {
			const fac = faculties.find(f => String(f.id) === String(facId));
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

	// Helper: wrap long vertical column headers with hyphens (common helper)
	const wrapTextWithHyphens = (pdfInstance, text, maxWidth) => {
		const words = text.split(/\s+/);
		const lines = [];
		let currentLine = "";

		for (let i = 0; i < words.length; i++) {
			const word = words[i];
			const testLine = currentLine ? `${currentLine} ${word}` : word;
			
			if (pdfInstance.getTextWidth(testLine) <= maxWidth) {
				currentLine = testLine;
			} else {
				if (currentLine) {
					lines.push(currentLine);
					currentLine = "";
				}
				
				if (pdfInstance.getTextWidth(word) <= maxWidth) {
					currentLine = word;
				} else {
					let remaining = word;
					while (remaining.length > 0) {
						let j = 1;
						while (j <= remaining.length && pdfInstance.getTextWidth(remaining.substring(0, j) + "-") <= maxWidth) {
							j++;
						}
						j--;
						
						if (j === 0) {
							j = 1;
						}
						
						if (j >= remaining.length) {
							currentLine = remaining;
							remaining = "";
						} else {
							lines.push(remaining.substring(0, j) + "-");
							remaining = remaining.substring(j);
						}
					}
				}
			}
		}
		
		if (currentLine) {
			lines.push(currentLine);
		}
		
		return lines;
	};

	// Helper: generate export file name dynamically based on chosen scope/filters
	const getTimetableTypeLabel = (titleVal, facultyVal, departmentVal) => {
		const isAllFaculty = !facultyVal || facultyVal.toLowerCase() === "all faculties" || facultyVal.toLowerCase() === "all";
		const isAllDept = !departmentVal || departmentVal.toLowerCase() === "all departments" || departmentVal.toLowerCase() === "all";
		const modeStr = titleVal.toLowerCase().includes("exam") ? "EXAMINATION" : "LECTURE";

		if (isAllFaculty && isAllDept) {
			return `GENERAL UNIVERSITY ${modeStr} TIMETABLE`;
		} else if (!isAllFaculty && isAllDept) {
			return `${facultyVal.toUpperCase()} ${modeStr} TIMETABLE`;
		} else {
			return `${departmentVal.toUpperCase()} ${modeStr} TIMETABLE`;
		}
	};

	const getWeekNumberForDate = (dateStr, minDateStr) => {
		if (!dateStr || !minDateStr) return 1;
		const d = new Date(dateStr);
		const minD = new Date(getMondayOfDate(minDateStr));
		const diffTime = Math.abs(d - minD);
		const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
		return Math.floor(diffDays / 7) + 1;
	};

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

		const modeStr = titleVal.toLowerCase().includes("exam") ? "Exams" : "Lectures";
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
		return `${baseName.toLowerCase()}_${dateStr}${suffix}.pdf`;
	};

	// ---- Group schedules by logical day/week/date ----
	const buildDayGroups = (subset) => {
		const out = [];
		if (mode === "exam") {
			const dates = [...new Set(subset.map((s) => s.examDate))].sort();
			dates.forEach((dateStr) => {
				const dateObj = new Date(dateStr);
				const ds = subset.filter((s) => s.examDate === dateStr);
				const ptLabel = dateObj.toLocaleDateString("en-GB", {
					weekday: "long",
					day: "numeric",
					month: "long",
					year: "numeric",
				});
				if (ds.length) out.push({ label: ptLabel, day: dateStr, schedules: ds });
			});
		} else {
			const ACTIVE_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
			ACTIVE_DAYS.forEach((day) => {
				const ds = subset.filter((s) => s.day === day);
				if (ds.length) out.push({ label: day, day, schedules: ds });
			});
		}
		return out;
	};

	const groups = [];
	if (groupByFaculty) {
		const orderedFaculties = [
			...new Set(schedules.map((s) => s.facultyName || "Unassigned")),
		].sort((a, b) => {
			if (a === GENERAL_STUDIES_FACULTY) return -1;
			if (b === GENERAL_STUDIES_FACULTY) return 1;
			return a.localeCompare(b);
		});
		orderedFaculties.forEach((facName) => {
			const subset = schedules.filter(
				(s) => (s.facultyName || "Unassigned") === facName,
			);
			buildDayGroups(subset).forEach((g) => {
				groups.push({ ...g, faculty: facName });
			});
		});
	} else {
		buildDayGroups(schedules).forEach((g) => groups.push(g));
	}

	if (!groups.length) return;

	// Helper for converting time HH:MM to minutes
	function timeToMinutes(timeStr) {
		if (!timeStr) return 0;
		const [h, m] = timeStr.split(":").map(Number);
		return h * 60 + (m || 0);
	}

	// Pack a list of schedule items into the fewest parallel "lanes" such that
	// no two items sharing a lane overlap in time. Used to size/lay out
	// simultaneous lectures within a single room+day.
	function packLanes(items) {
		const sorted = [...items].sort((a, b) => {
			const startA = timeToMinutes(a.startTime);
			const startB = timeToMinutes(b.startTime);
			if (startA !== startB) return startA - startB;
			return timeToMinutes(a.endTime) - timeToMinutes(b.endTime);
		});
		const lanes = [];
		sorted.forEach((si) => {
			const startMin = timeToMinutes(si.startTime);
			const endMin = timeToMinutes(si.endTime);
			let placed = false;
			for (let i = 0; i < lanes.length; i++) {
				const hasOverlap = lanes[i].some((item) => {
					const itemStart = timeToMinutes(item.startTime);
					const itemEnd = timeToMinutes(item.endTime);
					return startMin < itemEnd && itemStart < endMin;
				});
				if (!hasOverlap) {
					lanes[i].push(si);
					placed = true;
					break;
				}
			}
			if (!placed) lanes.push([si]);
		});
		return lanes;
	}

	// Draws one rounded course-code card inside a lane, auto-shrinking the
	// font until it fits both the card's height and width. Used by the A3
	// exam grid only; lecture chips use drawLectureChip (fixed sizes + lanes).
	function drawTimetableCard(pdf, itemX, itemW, laneY, laneH, si, monochrome) {
		const code = si.courseCode || si.courseId || "N/A";
		const codeParts = code.split(/[,/]+/).map(p => p.trim()).filter(Boolean);
		const cleanCode = codeParts.join(" / ");

		// If the joined single-line code doesn't fit even at a comfortable
		// floor font, and there's more than one distinct code (a merged /
		// cross-listed cell), render each on its own line instead of shrinking
		// further.
		let parts = [cleanCode];
		if (codeParts.length > 1) {
			pdf.setFont("helvetica", "bold");
			pdf.setFontSize(6.5);
			const fitsJoined = pdf.getTextWidth(cleanCode) <= itemW - 1.5;
			if (!fitsJoined) {
				parts = codeParts;
			}
		}

		let fs = 7.8;
		let lineHeight = fs * 0.3528 * 1.3;
		let totalH = parts.length * lineHeight;

		const standardCardH = 5.2;
		let cardH = Math.min(laneH - 0.8, standardCardH);

		const requiredH = totalH + 1.2;
		if (requiredH > cardH && requiredH <= laneH - 0.6) {
			cardH = requiredH;
		}

		const cardY = laneY + (laneH - cardH) / 2;
		const isMono = monochrome;
		const bgCol = isMono ? [255, 255, 255] : [239, 246, 255];
		const borderCol = isMono ? [156, 163, 175] : [191, 219, 254];
		const textCol = isMono ? [75, 85, 99] : [29, 78, 216];

		pdf.setFillColor(...bgCol);
		pdf.roundedRect(itemX + 0.6, cardY, itemW - 1.2, cardH, 0.6, 0.6, "F");

		pdf.setDrawColor(...borderCol);
		pdf.setLineWidth(0.12);
		pdf.roundedRect(itemX + 0.6, cardY, itemW - 1.2, cardH, 0.6, 0.6, "D");

		const exceedsWidth = () => {
			pdf.setFontSize(fs);
			pdf.setFont("helvetica", "bold");
			for (let line of parts) {
				if (pdf.getTextWidth(line) > itemW - 1.5) {
					return true;
				}
			}
			return false;
		};

		while ((totalH > cardH - 1.0 || exceedsWidth()) && fs > 4.5) {
			fs -= 0.5;
			lineHeight = fs * 0.3528 * 1.3;
			totalH = parts.length * lineHeight;
		}

		pdf.setFontSize(fs);
		pdf.setFont("helvetica", "bold");
		pdf.setTextColor(...textCol);

		const startY = cardY + cardH / 2 - totalH / 2 + (fs * 0.3528 * 0.85);
		parts.forEach((line, idx) => {
			pdf.text(line, itemX + itemW / 2, startY + idx * lineHeight, { align: "center" });
		});
	}

	// =========================================================================
	// STRUCTURED A3 LAYOUT
	// =========================================================================
	// Lecture timetables always use this room x day grid; paperSize picks A3
	// (default, whole week on one page) or A4 (week split Mon-Wed / Thu-Fri).
	if (paperSize === "a3" || structured || mode === "lecture") {
		const pageFormat = mode === "lecture" && paperSize === "a4" ? "a4" : "a3";
		const pdfA3 = new jsPDF({
			orientation: "landscape",
			unit: "mm",
			format: pageFormat,
		});
		const pageW = pageFormat === "a4" ? 297 : 420; // mm (landscape)
		const pageH = pageFormat === "a4" ? 210 : 297;
		const m = 12;

		// Condensed face used only for lecture course chips.
		const CHIP_FONT = "RobotoCondensed";
		if (mode === "lecture") {
			pdfA3.addFileToVFS("RobotoCondensed-Regular.ttf", robotoCondensedRegular);
			pdfA3.addFont("RobotoCondensed-Regular.ttf", CHIP_FONT, "normal");
			pdfA3.addFileToVFS("RobotoCondensed-Bold.ttf", robotoCondensedBold);
			pdfA3.addFont("RobotoCondensed-Bold.ttf", CHIP_FONT, "bold");
		}

		const generatedDate = new Date().toLocaleDateString("en-GB", {
			day: "numeric",
			month: "long",
			year: "numeric",
		});

		// Lecture timetables use a flexible hourly grid (8am-6pm, mirroring the
		// A4 layout) since lecture durations vary (1/2/3hr) and can start as
		// early as 8am. Exam timetables keep their fixed 9am-12pm / 12-3pm /
		// 3-6pm blocks untouched.
		const GRID_START_H = mode === "exam" ? 9 : 8;
		const GRID_END_H = 18;
		const SLOT_HOURS = mode === "exam" ? 3 : 1;
		const NUM_SLOTS = (GRID_END_H - GRID_START_H) / SLOT_HOURS;

		// Helper: get blocked slots for a specific day/timeslot
		function getBlockedSlotsForSlot(dayOrDate, slotIdx) {
			const slotStartMin = (GRID_START_H + slotIdx * SLOT_HOURS) * 60;
			const slotEndMin = slotStartMin + SLOT_HOURS * 60;

			const isDate = !dayOrDate.startsWith("legacy:") && dayOrDate.includes("-");
			let dateVal = null;
			let dayVal = dayOrDate;
			if (isDate) {
				dateVal = dayOrDate;
				dayVal = new Date(dayOrDate).toLocaleDateString("en-US", { weekday: "long" });
			} else {
				dayVal = dayOrDate.replace("legacy:", "");
			}

			return blockedSlots.filter(b => {
				if (mode === "exam" && b.applies_to === "LECTURE_ONLY") return false;
				if (mode === "lecture" && b.applies_to === "EXAM_ONLY") return false;

				const dateMatch = dateVal && b.date === dateVal;
				const dayMatch = b.day_of_week && b.day_of_week.toLowerCase() === dayVal.toLowerCase();
				if (!dateMatch && !dayMatch) return false;

				if (b.type === "HOLIDAY") return true;

				if (b.type === "EXTRACURRICULAR" && b.start_time && b.end_time) {
					const [sH, sM] = b.start_time.split(":").map(Number);
					const [eH, eM] = b.end_time.split(":").map(Number);
					const bStart = sH * 60 + sM;
					const bEnd = eH * 60 + eM;
					return bStart < slotEndMin && bEnd > slotStartMin;
				}
				return false;
			});
		}

		// Helper: check if a timeslot is blocked (General Event)
		function getGeneralEvent(dayOrDate, slotIdx) {
			const matches = getBlockedSlotsForSlot(dayOrDate, slotIdx);
			return matches.length > 0 ? matches[0].name : null;
		}

		// Lecture-only: same blocked-slot lookup as getBlockedSlotsForSlot, but
		// scoped to an explicit minute range instead of a fixed-width slot index,
		// since lecture columns are now variable-width merged segments.
		function getBlockedSlotsForRange(dayOrDate, startMin, endMin) {
			const isDate = !dayOrDate.startsWith("legacy:") && dayOrDate.includes("-");
			let dateVal = null;
			let dayVal = dayOrDate;
			if (isDate) {
				dateVal = dayOrDate;
				dayVal = new Date(dayOrDate).toLocaleDateString("en-US", { weekday: "long" });
			} else {
				dayVal = dayOrDate.replace("legacy:", "");
			}

			return blockedSlots.filter(b => {
				if (mode === "exam" && b.applies_to === "LECTURE_ONLY") return false;
				if (mode === "lecture" && b.applies_to === "EXAM_ONLY") return false;

				const dateMatch = dateVal && b.date === dateVal;
				const dayMatch = b.day_of_week && b.day_of_week.toLowerCase() === dayVal.toLowerCase();
				if (!dateMatch && !dayMatch) return false;

				if (b.type === "HOLIDAY") return true;

				if (b.type === "EXTRACURRICULAR" && b.start_time && b.end_time) {
					const [sH, sM] = b.start_time.split(":").map(Number);
					const [eH, eM] = b.end_time.split(":").map(Number);
					const bStart = sH * 60 + sM;
					const bEnd = eH * 60 + eM;
					return bStart < endMin && bEnd > startMin;
				}
				return false;
			});
		}

		// Formats a minute-range as a natural clock label, e.g. "8 - 10am",
		// "11am - 1pm", "3 - 6pm". Drops the repeated am/pm suffix from the
		// start when both ends share the same period.
		function formatHourRangeLabel(startMin, endMin) {
			// Only the end time carries am/pm (e.g. "11 - 1pm", "8 - 10am") to
			// save horizontal space in narrow segment headers.
			const fmtClock = (min, includePeriod) => {
				const h = Math.floor(min / 60);
				const mm = min % 60;
				const period = h < 12 ? "am" : "pm";
				let h12 = h % 12;
				if (h12 === 0) h12 = 12;
				const base = mm === 0 ? `${h12}` : `${h12}:${String(mm).padStart(2, "0")}`;
				return includePeriod ? `${base}${period}` : base;
			};
			return `${fmtClock(startMin, false)} - ${fmtClock(endMin, true)}`;
		}

		// Lecture-only: hour range shared by every day of one faculty table.
		// Defaults to 08:00-18:00 and widens to cover any class outside it, so
		// a chip can never run past its day's wall into the next day.
		function getLectureDayRange(facName, facSchedules) {
			const range = computeDayRange(facSchedules, GRID_START_H, GRID_END_H);
			if (range.outOfRange.length > 0) {
				console.warn(
					`[pdfExport] ${facName}: ${range.outOfRange.length} class(es) outside ` +
					`${GRID_START_H}:00-${GRID_END_H}:00; grid extended to ${range.startH}:00-${range.endH}:00`,
					range.outOfRange.map((si) => `${si.courseCode} ${si.day} ${si.startTime}-${si.endTime}`),
				);
			}
			return range;
		}

		// Lecture chip geometry (mm) and fixed font sizes (pt). Overlapping
		// classes stack in lanes; text is never shrunk below these sizes.
		const CHIP_H = 6.6;
		const LANE_PITCH = 7.2;
		const ROW_PAD = 1.0;
		const CHIP_INSET = 0.5;
		const CHIP_PAD_X = 0.35;
		const CHIP_SIZES = { main: 7, prefix: 6 };
		const PT_TO_MM = 0.3528;
		const CAP_RATIO = 0.71;

		const measureChipText = (text, size, bold) => {
			pdfA3.setFont(CHIP_FONT, bold ? "bold" : "normal");
			pdfA3.setFontSize(size);
			return pdfA3.getTextWidth(text);
		};

		// Draws one lecture chip at a fixed size. Returns true when the code's
		// prefix had to be dropped (a "•" in the chip corner, explained in the
		// page legend).
		function drawLectureChip(x, y, w, si) {
			const bgCol = monochrome ? [255, 255, 255] : [239, 246, 255];
			const borderCol = monochrome ? [156, 163, 175] : [191, 219, 254];
			const textCol = monochrome ? [75, 85, 99] : [29, 78, 216];
			const prefixCol = monochrome ? [107, 114, 128] : [100, 116, 139];

			pdfA3.setFillColor(...bgCol);
			pdfA3.setDrawColor(...borderCol);
			pdfA3.setLineWidth(0.12);
			pdfA3.roundedRect(x, y, w, CHIP_H, 0.6, 0.6, "FD");

			const innerW = w - 2 * CHIP_PAD_X;
			const fit = fitChipText(si.courseCode || si.courseId, innerW, measureChipText, CHIP_SIZES);
			const mainCap = CHIP_SIZES.main * PT_TO_MM * CAP_RATIO;
			const prefixCap = CHIP_SIZES.prefix * PT_TO_MM * CAP_RATIO;
			const lineGap = 0.9;
			const cx = x + w / 2;

			if (fit.kind === "two-line") {
				const top = y + (CHIP_H - (prefixCap + lineGap + mainCap)) / 2;
				pdfA3.setFont(CHIP_FONT, "normal");
				pdfA3.setFontSize(CHIP_SIZES.prefix);
				pdfA3.setTextColor(...prefixCol);
				pdfA3.text(fit.prefix, cx, top + prefixCap, { align: "center" });
				pdfA3.setFont(CHIP_FONT, "bold");
				pdfA3.setFontSize(CHIP_SIZES.main);
				pdfA3.setTextColor(...textCol);
				pdfA3.text(fit.lines[0], cx, top + prefixCap + lineGap + mainCap, { align: "center" });
			} else {
				const blockH = fit.lines.length * mainCap + (fit.lines.length - 1) * lineGap;
				const top = y + (CHIP_H - blockH) / 2;
				pdfA3.setFont(CHIP_FONT, "bold");
				pdfA3.setFontSize(CHIP_SIZES.main);
				pdfA3.setTextColor(...textCol);
				fit.lines.forEach((line, idx) => {
					pdfA3.text(line, cx, top + mainCap + idx * (mainCap + lineGap), { align: "center" });
				});
			}
			if (fit.marked) {
				pdfA3.setFont(CHIP_FONT, "bold");
				pdfA3.setFontSize(CHIP_SIZES.prefix);
				pdfA3.setTextColor(...prefixCol);
				pdfA3.text("•", x + w - 0.3, y + 1.9, { align: "right" });
			}
			return fit.marked;
		}

		// 1. Gather all unique dates (or legacy days) from schedules
		const uniqueDates = [];
		const STANDARD_SLOTS = [
			{ id: 0, label: "9am - 12pm", start: "09:00", end: "12:00" },
			{ id: 1, label: "12pm - 3pm", start: "12:00", end: "15:00" },
			{ id: 2, label: "3pm - 6pm", start: "15:00", end: "18:00" }
		];
		// Lecture grid: one column per hour, 8am-6pm, instead of exam's 3 fixed blocks.
		const activeSlots = mode === "exam"
			? STANDARD_SLOTS
			: Array.from({ length: NUM_SLOTS }, (_, i) => {
				const h = GRID_START_H + i;
				const label = h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`;
				return { id: i, label, start: `${String(h).padStart(2, "0")}:00`, end: `${String(h + 1).padStart(2, "0")}:00` };
			});

		if (mode === "exam") {
			const calendarDates = schedules
				.map(s => s.examDate)
				.filter(d => d && d !== "TBD" && !d.startsWith("legacy:") && d.includes("-"));

			if (calendarDates.length > 0) {
				const sortedDates = [...new Set(calendarDates)].sort();
				const minDate = sortedDates[0];
				const maxDate = sortedDates[sortedDates.length - 1];

				let currentMondayStr = getMondayOfDate(minDate);
				const maxMondayStr = getMondayOfDate(maxDate);

				while (currentMondayStr <= maxMondayStr) {
					const currentMonday = new Date(currentMondayStr);
					for (let i = 0; i < 6; i++) {
						const nextDate = new Date(currentMonday);
						nextDate.setDate(currentMonday.getDate() + i);
						uniqueDates.push(nextDate.toISOString().slice(0, 10));
					}
					currentMonday.setDate(currentMonday.getDate() + 7);
					currentMondayStr = currentMonday.toISOString().slice(0, 10);
				}
			} else {
				uniqueDates.push("legacy:Monday", "legacy:Tuesday", "legacy:Wednesday", "legacy:Thursday", "legacy:Friday", "legacy:Saturday");
			}
		} else {
			// Saturday is an optional lecture day - only show its column when
			// something is actually scheduled on a Saturday.
			const hasSaturdayLecture = schedules.some((s) => s.day === "Saturday");
			uniqueDates.push("Monday", "Tuesday", "Wednesday", "Thursday", "Friday");
			if (hasSaturdayLecture) uniqueDates.push("Saturday");
		}

		// 2. Identify active rooms and map them to faculties
		const activeRoomIds = new Set();
		schedules.forEach(s => {
			const ids = s.roomIds || (s.roomId ? [s.roomId] : []);
			ids.forEach(id => activeRoomIds.add(id));
		});

		const activeRooms = rooms.filter(r => activeRoomIds.has(r.id));
		activeRoomIds.forEach(id => {
			if (!activeRooms.some(r => r.id === id)) {
				activeRooms.push({ id, name: `Room ${id}`, faculty_id: null });
			}
		});
		activeRooms.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

		const roomFaculties = {};
		activeRooms.forEach(r => {
			const fac = faculties.find(f => String(f.id) === String(r.faculty_id));
			if (fac) {
				roomFaculties[r.id] = fac.name;
			} else {
				const sched = schedules.find(s => (s.roomIds || []).includes(r.id) || s.roomId === r.id);
				if (sched && sched.facultyName && sched.facultyName !== "NIL") {
					roomFaculties[r.id] = sched.facultyName;
				} else {
					roomFaculties[r.id] = "SHARED";
				}
			}
		});

		const venueColW = 35; // Wider column for rooms
		const facultyColW = 0;  // No faculty column
		// Hoisted so the pagination pre-pass below can also compute a
		// per-dayChunk dayWidth (needed to size day segments before we know
		// how many rooms fit on a page).
		const tableW = pageW - 2 * m;
		const remainingW = tableW - venueColW - facultyColW;

		// Lecture: one room's classes on one day, de-duplicated by course code
		// and lane-assigned so overlapping classes stack instead of shrinking.
		const getLectureRoomDayLanes = (room, targetSchedules, dayVal) => {
			const seen = new Set();
			const unique = targetSchedules.filter((si) => {
				const rids = si.roomIds || (si.roomId ? [si.roomId] : []);
				if (!rids.includes(room.id) || si.day !== dayVal) return false;
				const code = si.courseCode || si.courseId || "N/A";
				if (seen.has(code)) return false;
				seen.add(code);
				return true;
			});
			return assignLanes(unique);
		};

		// Dynamic row height calculator for A3 (based on a custom list of schedules)
		const getA3RoomRowHeight = (room, targetSchedules) => {
			const label = getRoomLabel(room);
			pdfA3.setFont("helvetica", "bold");
			pdfA3.setFontSize(7.5);
			const roomLines = pdfA3.splitTextToSize(label, venueColW - 2);
			const labelLinesCount = Math.max(1, roomLines.length);
			const labelH = 8 + (labelLinesCount - 1) * 3.6;

			if (mode !== "exam") {
				// Row height = most lanes this room needs on any day x lane pitch.
				let maxLanes = 1;
				uniqueDates.forEach((dayVal) => {
					const placed = getLectureRoomDayLanes(room, targetSchedules, dayVal);
					if (placed.length) maxLanes = Math.max(maxLanes, placed[0].laneCount);
				});
				return Math.max(labelH, maxLanes * LANE_PITCH + 2 * ROW_PAD - (LANE_PITCH - CHIP_H));
			}

			const roomSchedules = targetSchedules.filter(si => {
				const rids = si.roomIds || (si.roomId ? [si.roomId] : []);
				return rids.includes(room.id);
			});

			let maxLinesInAnySlot = 1;
			const slotGroups = {};
			roomSchedules.forEach(si => {
				const dayOrDate = si.examDate || si.day || "legacy";
				const startMin = timeToMinutes(si.startTime);
				const endMin = timeToMinutes(si.endTime);
				for (let slotIdx = 0; slotIdx < NUM_SLOTS; slotIdx++) {
					const slotStartMin = (GRID_START_H + slotIdx * SLOT_HOURS) * 60;
					const slotEndMin = slotStartMin + SLOT_HOURS * 60;
					if (startMin < slotEndMin && slotStartMin < endMin) {
						const key = `${dayOrDate}-${slotIdx}`;
						if (!slotGroups[key]) slotGroups[key] = [];
						slotGroups[key].push(si);
					}
				}
			});

			Object.keys(slotGroups).forEach(key => {
				const sittings = slotGroups[key];
				// Deduplicate by courseCode to avoid duplicate lanes for identical courses
				const uniqueSittings = [];
				const seen = new Set();
				sittings.forEach(si => {
					const code = si.courseCode || si.courseId || "N/A";
					if (!seen.has(code)) {
						seen.add(code);
						uniqueSittings.push(si);
					}
				});
				maxLinesInAnySlot = Math.max(maxLinesInAnySlot, packLanes(uniqueSittings).length);
			});

			const eventsH = maxLinesInAnySlot * 6.0 + 3.0;
			return Math.max(12, labelH, eventsH);
		};

		// Helper: Find enrolling faculties for a course
		const getEnrolledFaculties = (courseId, ownerFacultyId) => {
			const enrollingFacs = new Set();
			
			// Find all enrollments for this course
			const courseEnrs = enrollments.filter(e => String(e.course_id) === String(courseId));
			courseEnrs.forEach(e => {
				const dept = departments.find(d => String(d.id) === String(e.department_id));
				if (dept && dept.facultyId) {
					const fac = faculties.find(f => String(f.id) === String(dept.facultyId));
					if (fac) enrollingFacs.add(fac.name);
				}
			});

			// If no enrollments are found, fall back to the owner faculty of the course
			if (enrollingFacs.size === 0) {
				if (ownerFacultyId) {
					const fac = faculties.find(f => String(f.id) === String(ownerFacultyId));
					if (fac) enrollingFacs.add(fac.name);
				}
			}

			// Edge case: if it is a general studies course and we still have no enrolling faculties,
			// map it to GENERAL_STUDIES_FACULTY
			if (enrollingFacs.size === 0) {
				enrollingFacs.add(GENERAL_STUDIES_FACULTY);
			}

			return Array.from(enrollingFacs);
		};

		// 3. Dynamic row slicing per week and faculty grouping
		// A4 lectures split the week across two pages (Mon-Wed, Thu-Fri[-Sat]).
		const daysPerPage = pageFormat === "a4" ? 3 : 6;
		const dayChunks = [];
		for (let i = 0; i < uniqueDates.length; i += daysPerPage) {
			dayChunks.push(uniqueDates.slice(i, i + daysPerPage));
		}

		// Vertical space for room rows below the repeated day/hour header,
		// leaving room for the lecture legend + footer.
		const maxGridH = mode === "exam" ? 230 : pageH - 13 - (34 + 14);

		// Build all pages to print in order: GST section first, then normal section
		const pagesToRender = [];

		const isAllFaculty = !faculty || faculty.toLowerCase() === "all faculties" || faculty.toLowerCase() === "all";
		const cleanSelectedFaculty = faculty ? faculty.trim().toLowerCase() : "";

		// Determine which weeks contain General Studies exams
		const gstWeekIndexes = [];
		dayChunks.forEach((dayChunk, idx) => {
			const hasGST = schedules.some(si => {
				const inWeek = mode === "exam" ? dayChunk.includes(si.examDate) : dayChunk.includes(si.day);
				return inWeek && isGeneralStudiesCourse(si.courseCode);
			});
			if (hasGST) {
				gstWeekIndexes.push(idx);
			}
		});

		// Phase 1: General Studies Examination Timetable pages (Prioritized first)
		gstWeekIndexes.forEach(weekIdx => {
			const dayChunk = dayChunks[weekIdx];
			const weekGstSchedules = schedules.filter(si => {
				const inWeek = mode === "exam" ? dayChunk.includes(si.examDate) : dayChunk.includes(si.day);
				return inWeek && isGeneralStudiesCourse(si.courseCode);
			});

			// Group GST schedules by enrolling faculty name
			const gstFacultySchedules = {};
			weekGstSchedules.forEach(si => {
				const allFacs = getEnrolledFaculties(si.courseId, si.facultyId);
				const targetFacs = allFacs.filter(f => {
					if (isAllFaculty) return true;
					return f.toLowerCase().trim() === cleanSelectedFaculty;
				});
				targetFacs.forEach(facName => {
					if (!gstFacultySchedules[facName]) {
						gstFacultySchedules[facName] = [];
					}
					if (!gstFacultySchedules[facName].some(x => x.id === si.id)) {
						gstFacultySchedules[facName].push(si);
					}
				});
			});

			// Sort faculties alphabetically, with SHARED last
			const sortedGstFacs = Object.keys(gstFacultySchedules).sort((a, b) => {
				if (a === "SHARED" && b !== "SHARED") return 1;
				if (a !== "SHARED" && b === "SHARED") return -1;
				return a.localeCompare(b);
			});

			sortedGstFacs.forEach(facName => {
				const facSchedules = gstFacultySchedules[facName];
				const facRooms = activeRooms.filter(r => {
					return facSchedules.some(si => (si.roomIds || [si.roomId]).includes(r.id));
				});
				if (facRooms.length === 0) return;

				const dayRange = mode === "exam" ? null : getLectureDayRange(facName, facSchedules);

				// Slice active rooms of this faculty into page row chunks (vertical fit)
				const rowChunks = [];
				let idxRoom = 0;
				while (idxRoom < facRooms.length) {
					let currentHeight = 0;
					let chunk = [];
					let j = idxRoom;
					while (j < facRooms.length) {
						const rowH = getA3RoomRowHeight(facRooms[j], facSchedules);
						if (chunk.length > 0 && currentHeight + rowH > maxGridH) {
							break;
						}
						chunk.push(facRooms[j]);
						currentHeight += rowH;
						j++;
					}
					if (chunk.length === 0 && j < facRooms.length) {
						chunk.push(facRooms[j]);
						j++;
					}
					rowChunks.push(chunk);
					idxRoom = j;
				}

				rowChunks.forEach(rowChunk => {
					pagesToRender.push({
						weekIdx,
						dayChunk,
						facultyName: facName,
						rowChunk,
						facWeekSchedules: facSchedules,
						dayRange,
						isGSTSection: true
					});
				});
			});
		});

		// Phase 2: Departmental / Normal Examination Timetable pages (Remaining courses)
		if (!gstOnly) {
			dayChunks.forEach((dayChunk, weekIdx) => {
			const weekNormalSchedules = schedules.filter(si => {
				const inWeek = mode === "exam" ? dayChunk.includes(si.examDate) : dayChunk.includes(si.day);
				return inWeek && !isGeneralStudiesCourse(si.courseCode);
			});

			if (weekNormalSchedules.length === 0) return;

			// Group normal schedules by enrolling faculty name (prioritize faculty of concern)
			const normalFacultySchedules = {};
			weekNormalSchedules.forEach(si => {
				const allFacs = getEnrolledFaculties(si.courseId, si.facultyId);
				const targetFacs = allFacs.filter(f => {
					if (isAllFaculty) return true;
					return f.toLowerCase().trim() === cleanSelectedFaculty;
				});
				targetFacs.forEach(facName => {
					if (!normalFacultySchedules[facName]) {
						normalFacultySchedules[facName] = [];
					}
					if (!normalFacultySchedules[facName].some(x => x.id === si.id)) {
						normalFacultySchedules[facName].push(si);
					}
				});
			});

			// Sort faculties alphabetically, with SHARED last
			const sortedNormalFacs = Object.keys(normalFacultySchedules).sort((a, b) => {
				if (a === "SHARED" && b !== "SHARED") return 1;
				if (a !== "SHARED" && b === "SHARED") return -1;
				return a.localeCompare(b);
			});

			sortedNormalFacs.forEach(facName => {
				const facSchedules = normalFacultySchedules[facName];
				const facRooms = activeRooms.filter(r => {
					return facSchedules.some(si => (si.roomIds || [si.roomId]).includes(r.id));
				});
				if (facRooms.length === 0) return;

				const dayRange = mode === "exam" ? null : getLectureDayRange(facName, facSchedules);

				// Slice active rooms of this faculty into page row chunks (vertical fit)
				const rowChunks = [];
				let idxRoom = 0;
				while (idxRoom < facRooms.length) {
					let currentHeight = 0;
					let chunk = [];
					let j = idxRoom;
					while (j < facRooms.length) {
						const rowH = getA3RoomRowHeight(facRooms[j], facSchedules);
						if (chunk.length > 0 && currentHeight + rowH > maxGridH) {
							break;
						}
						chunk.push(facRooms[j]);
						currentHeight += rowH;
						j++;
					}
					if (chunk.length === 0 && j < facRooms.length) {
						chunk.push(facRooms[j]);
						j++;
					}
					rowChunks.push(chunk);
					idxRoom = j;
				}

				rowChunks.forEach(rowChunk => {
					pagesToRender.push({
						weekIdx,
						dayChunk,
						facultyName: facName,
						rowChunk,
						facWeekSchedules: facSchedules,
						dayRange,
						isGSTSection: false
					});
				});
			});
		});
		}

		// A4 lectures: keep each faculty's Mon-Wed and Thu-Fri pages together
		// (stable sort by the faculty table's first appearance), and give both
		// halves the same hour range so their columns line up.
		if (mode !== "exam" && dayChunks.length > 1) {
			const firstIdx = new Map();
			const tableRange = new Map();
			pagesToRender.forEach((p, i) => {
				const key = `${p.isGSTSection}|${p.facultyName}`;
				if (!firstIdx.has(key)) firstIdx.set(key, i);
				const r = tableRange.get(key);
				tableRange.set(key, r
					? { startH: Math.min(r.startH, p.dayRange.startH), endH: Math.max(r.endH, p.dayRange.endH) }
					: { startH: p.dayRange.startH, endH: p.dayRange.endH });
			});
			pagesToRender.forEach((p) => {
				p.dayRange = tableRange.get(`${p.isGSTSection}|${p.facultyName}`);
			});
			pagesToRender.sort((a, b) =>
				firstIdx.get(`${a.isGSTSection}|${a.facultyName}`) - firstIdx.get(`${b.isGSTSection}|${b.facultyName}`));
		}

		// ---------- Front cover page (light mode) ----------
		const drawCoverPage = () => {
			const cx = pageW / 2;

			// Accent bands top & bottom + a subtle inner frame
			pdfA3.setFillColor(99, 102, 241);
			pdfA3.rect(0, 0, pageW, 5, "F");
			pdfA3.rect(0, pageH - 5, pageW, 5, "F");
			pdfA3.setDrawColor(226, 232, 240);
			pdfA3.setLineWidth(0.4);
			pdfA3.rect(m, 14, pageW - 2 * m, pageH - 28, "D");

			// University logo (centered)
			const logoSize = 46;
			try {
				pdfA3.addImage(unilagLogoBase64, "PNG", cx - logoSize / 2, 58, logoSize, logoSize);
			} catch (e) {}

			// University name
			pdfA3.setFont("helvetica", "bold");
			pdfA3.setFontSize(30);
			pdfA3.setTextColor(15, 23, 42);
			pdfA3.text((schoolName || "University of Lagos").toUpperCase(), cx, 120, { align: "center" });

			// Accent divider
			pdfA3.setDrawColor(99, 102, 241);
			pdfA3.setLineWidth(0.8);
			pdfA3.line(cx - 38, 130, cx + 38, 130);

			// Timetable type
			const coverType = mode === "exam" ? "EXAMINATION TIMETABLE" : "LECTURE TIMETABLE";
			pdfA3.setFont("helvetica", "bold");
			pdfA3.setFontSize(44);
			pdfA3.setTextColor(99, 102, 241);
			pdfA3.text(coverType, cx, 156, { align: "center" });

			// Session · Semester
			pdfA3.setFont("helvetica", "normal");
			pdfA3.setFontSize(15);
			pdfA3.setTextColor(71, 85, 105);
			pdfA3.text(`${session} Session   ·   ${semester}`, cx, 170, { align: "center" });

			// Details panel
			const rows = [["Faculty", faculty || "All Faculties"]];
			if (department) rows.push(["Department", department]);
			if (level) rows.push(["Level", level]);
			rows.push(["Status", isLocked ? "Final Timetable" : "Draft Timetable"]);
			rows.push(["Generated", generatedDate]);

			const panelW = 210;
			const rowH = 13;
			const panelPadY = 8;
			const panelH = rows.length * rowH + panelPadY;
			const panelX = cx - panelW / 2;
			const panelY = 190;
			pdfA3.setFillColor(248, 250, 252);
			pdfA3.setDrawColor(226, 232, 240);
			pdfA3.setLineWidth(0.3);
			pdfA3.roundedRect(panelX, panelY, panelW, panelH, 3, 3, "FD");

			rows.forEach((r, i) => {
				const ry = panelY + panelPadY + rowH * i + 3;
				pdfA3.setFont("helvetica", "bold");
				pdfA3.setFontSize(9.5);
				pdfA3.setTextColor(100, 116, 139);
				pdfA3.text(r[0].toUpperCase(), panelX + 12, ry);
				pdfA3.setFont("helvetica", "bold");
				pdfA3.setFontSize(12);
				if (r[0] === "Status") {
					pdfA3.setTextColor(...(isLocked ? [16, 185, 129] : [245, 158, 11]));
				} else {
					pdfA3.setTextColor(15, 23, 42);
				}
				pdfA3.text(String(r[1]), panelX + panelW - 12, ry, { align: "right" });
				if (i < rows.length - 1) {
					const dividerY = panelY + panelPadY + rowH * (i + 1) - 2;
					pdfA3.setDrawColor(226, 232, 240);
					pdfA3.setLineWidth(0.2);
					pdfA3.line(panelX + 10, dividerY, panelX + panelW - 10, dividerY);
				}
			});

			// Footnote
			pdfA3.setFont("helvetica", "italic");
			pdfA3.setFontSize(10);
			pdfA3.setTextColor(148, 163, 184);
			pdfA3.text("Generated using University of Lagos Timetable Software", cx, pageH - 12, { align: "center" });
		};
		// The cover is laid out for A3; A4 lecture exports start straight on
		// the timetable (as the previous A4 layout did).
		const hasCover = pageFormat === "a3";
		if (hasCover) drawCoverPage();

		// Now render all built pages (cover occupies the first page)
		let pageIdx = 0;
		pagesToRender.forEach(pageSpec => {
			const { weekIdx, dayChunk, facultyName: facName, rowChunk, facWeekSchedules, dayRange, isGSTSection } = pageSpec;

			if (hasCover || pageIdx > 0) pdfA3.addPage();

			// Render Header
			let y = 12;
			const logoSize = 16;
			try {
				pdfA3.addImage(unilagLogoBase64, "PNG", m, y, logoSize, logoSize);
			} catch (e) {}

			pdfA3.setFont("helvetica", "bold");
			pdfA3.setFontSize(16);
			pdfA3.setTextColor(15, 23, 42);
			pdfA3.text((schoolName || "University of Lagos").toUpperCase(), m + logoSize + 4, y + 5);

			// Subtitle: Replace generic faculty filter with printed faculty name
			let currentFacultyName = facName.toUpperCase();
			if (isGSTSection) {
				if (facName.toLowerCase().includes("general studies")) {
					currentFacultyName = "GENERAL STUDIES TIMETABLE";
				} else {
					currentFacultyName = `GENERAL STUDIES TIMETABLE - ${facName.toUpperCase()}`;
				}
			}

			// Helper to draw mixed normal/bold text for the subtitle
			const drawMixedSubtitle = (pdf, startX, startY, maxW) => {
				let curX = startX;
				let curY = startY;
				
				const parts = [
					{ text: `${session} Session`, bold: false },
					{ text: `   ·   ${semester}   ·   `, bold: false },
					{ text: currentFacultyName, bold: true }
				];
				if (scopeLabel) {
					parts.push({ text: `   ·   ${scopeLabel}`, bold: false });
				}

				parts.forEach(part => {
					pdf.setFont("helvetica", part.bold ? "bold" : "normal");
					const tokens = part.text.split(/(\s+)/);
					tokens.forEach(token => {
						if (!token) return;
						if (token.trim() === "") {
							curX += pdf.getTextWidth(token);
						} else {
							const tokenW = pdf.getTextWidth(token);
							if (curX + tokenW > startX + maxW) {
								curX = startX;
								curY += 4.5;
							}
							pdf.text(token, curX, curY);
							curX += tokenW;
						}
					});
				});
			};

			pdfA3.setFontSize(11);
			pdfA3.setTextColor(71, 85, 105);
			const maxSubW = pageW / 2 - (m + logoSize + 8);
			drawMixedSubtitle(pdfA3, m + logoSize + 4, y + 12, maxSubW);

			// WEEK label at the center (exam only - lectures recur weekly by
			// day-of-week, so there's no meaningful "week" concept to show).
			if (mode === "exam") {
				const weekLabel = `WEEK ${weekIdx + 1}`;
				pdfA3.setFont("helvetica", "bold");
				pdfA3.setFontSize(14);
				pdfA3.setTextColor(15, 23, 42);
				pdfA3.text(weekLabel, pageW / 2, y + 8, { align: "center" });
			}

			// Title
			let timetableTitle = getTimetableTypeLabel(title, facName, scopeLabel);
			if (isGSTSection) {
				timetableTitle = "GENERAL STUDIES EXAMINATION TIMETABLE";
			}
			pdfA3.setFont("helvetica", "bold");
			pdfA3.setFontSize(14);
			pdfA3.setTextColor(15, 23, 42);
			const maxTitleW = pageW / 2 - m - 20;
			const titleLines = pdfA3.splitTextToSize(timetableTitle.toUpperCase(), maxTitleW);
			titleLines.forEach((line, idx) => {
				pdfA3.text(line, pageW - m, y + 5 + idx * 5.5, { align: "right" });
			});

			const docStatus = isLocked ? "FINAL TIMETABLE" : "DRAFT TIMETABLE";
			pdfA3.setFontSize(10);
			pdfA3.setFont("helvetica", "bold");
			pdfA3.setTextColor(...(isLocked ? [16, 185, 129] : [245, 158, 11]));
			pdfA3.text(docStatus, pageW - m, y + 12 + (titleLines.length - 1) * 5.5, { align: "right" });

			// Render Grid Table
			const tableStartY = 34;
			const dayWidth = remainingW / dayChunk.length;
			const slotWidth = dayWidth / NUM_SLOTS;
			// Lecture grid: the day's hour range maps linearly onto its column,
			// with one hourly sub-column per hour.
			const rangeStartMin = dayRange ? dayRange.startH * 60 : 0;
			const rangeMin = dayRange ? (dayRange.endH - dayRange.startH) * 60 : 1;
			const xForMinute = (dayX, minuteVal) => dayX + ((minuteVal - rangeStartMin) / rangeMin) * dayWidth;

			// Gridline styles: dotted at odd hours, 0.5pt at even hours, and a
			// ~1.75pt wall at every day boundary.
			const setOddHourLine = () => {
				pdfA3.setDrawColor(203, 213, 225);
				pdfA3.setLineWidth(0.12);
				pdfA3.setLineDashPattern([0.4, 0.6], 0);
			};
			const setEvenHourLine = () => {
				pdfA3.setDrawColor(148, 163, 184);
				pdfA3.setLineWidth(0.18);
				pdfA3.setLineDashPattern([], 0);
			};
			const setDayWallLine = () => {
				pdfA3.setDrawColor(51, 65, 85);
				pdfA3.setLineWidth(0.6);
				pdfA3.setLineDashPattern([], 0);
			};
			const resetLine = () => {
				pdfA3.setDrawColor(71, 85, 105);
				pdfA3.setLineWidth(0.2);
				pdfA3.setLineDashPattern([], 0);
			};
			let pageHasMarkedChip = false;

			// Draw Header background
			pdfA3.setFillColor(241, 245, 249);
			pdfA3.rect(m, tableStartY, tableW, 14, "F");

			// Draw Grid Border lines and background
			pdfA3.setDrawColor(71, 85, 105);
			pdfA3.setLineWidth(0.2);
			pdfA3.rect(m, tableStartY, tableW, 14, "D");

			// Draw Day/Slot Headers
			dayChunk.forEach((dayVal, dIdx) => {
				const dayX = m + venueColW + facultyColW + dIdx * dayWidth;

				// Day boundary lines
				if (mode !== "exam") {
					setDayWallLine();
					pdfA3.line(dayX, tableStartY, dayX, tableStartY + 14);
					resetLine();
				} else if (dIdx > 0) {
					pdfA3.line(dayX, tableStartY, dayX, tableStartY + 14);
				}

				// Day Label
				const isDate = !dayVal.startsWith("legacy:") && dayVal.includes("-");
				const formattedDayStr = isDate
					? new Date(dayVal).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })
					: dayVal.replace("legacy:", "");

				pdfA3.setFont("helvetica", "bold");
				pdfA3.setFontSize(8.5);
				pdfA3.setTextColor(15, 23, 42);
				pdfA3.text(formattedDayStr.toUpperCase(), dayX + dayWidth / 2, tableStartY + 5, { align: "center" });

				// Slots
				if (mode === "exam") {
					activeSlots.forEach((slot, sIdx) => {
						const slotX = dayX + sIdx * slotWidth;
						if (sIdx > 0) {
							pdfA3.setDrawColor(148, 163, 184);
							pdfA3.setLineWidth(0.08);
							pdfA3.line(slotX, tableStartY + 7, slotX, tableStartY + 14);
							pdfA3.setDrawColor(71, 85, 105);
							pdfA3.setLineWidth(0.2);
						}

						const slotLabel = slot.label;
						const eventName = getGeneralEvent(dayVal, sIdx);

						pdfA3.setFont("helvetica", eventName ? "bold" : "normal");
						pdfA3.setFontSize(7);
						pdfA3.setTextColor(15, 23, 42);
						pdfA3.text(slotLabel, slotX + slotWidth / 2, tableStartY + 11.5, { align: "center" });
					});
				} else {
					// Lecture: 2-hour header labels over the hourly grid, with a
					// tick at each even hour.
					for (let h = dayRange.startH; h < dayRange.endH; h += 2) {
						const segStart = h * 60;
						const segEnd = Math.min(h + 2, dayRange.endH) * 60;
						const segX = xForMinute(dayX, segStart);
						if (h > dayRange.startH) {
							pdfA3.setDrawColor(148, 163, 184);
							pdfA3.setLineWidth(0.08);
							pdfA3.line(segX, tableStartY + 7, segX, tableStartY + 14);
							resetLine();
						}

						const eventMatches = getBlockedSlotsForRange(dayVal, segStart, segEnd);
						const eventName = eventMatches.length > 0 ? eventMatches[0].name : null;

						pdfA3.setFont("helvetica", eventName ? "bold" : "normal");
						pdfA3.setFontSize(7);
						pdfA3.setTextColor(15, 23, 42);
						const segW = xForMinute(dayX, segEnd) - segX;
						pdfA3.text(formatHourRangeLabel(segStart, segEnd), segX + segW / 2, tableStartY + 11.5, { align: "center" });
					}
				}
			});

			// Render Grid Rows
			let rowY = tableStartY + 14;
			const pageBlockedCols = new Map();

			rowChunk.forEach((room) => {
				const rowH = getA3RoomRowHeight(room, facWeekSchedules);

				pdfA3.setDrawColor(71, 85, 105);
				pdfA3.setLineWidth(0.2);

				// Draw Room Cell
				pdfA3.setFillColor(255, 255, 255);
				pdfA3.rect(m, rowY, venueColW, rowH, "F");
				pdfA3.rect(m, rowY, venueColW, rowH, "D");

				pdfA3.setFont("helvetica", "bold");
				pdfA3.setFontSize(7.5);
				pdfA3.setTextColor(15, 23, 42);

				const roomLabel = getRoomLabel(room);
				const roomLines = pdfA3.splitTextToSize(roomLabel, venueColW - 2);
				const rLineSpacing = 3.6;
				const rStartY = rowY + (rowH - (roomLines.length - 1) * rLineSpacing) / 2 + 1;
				roomLines.forEach((line, index) => {
					pdfA3.text(line, m + venueColW / 2, rStartY + index * rLineSpacing, { align: "center" });
				});

				// Draw Grid Cells
				dayChunk.forEach((dayVal, dIdx) => {
					const dayX = m + venueColW + facultyColW + dIdx * dayWidth;

					if (mode === "exam") {
						activeSlots.forEach((slot, sIdx) => {
							const cellX = dayX + sIdx * slotWidth;

							// Fetch scheduled sittings for this faculty/room/day/timeslot
							const cellSchedules = facWeekSchedules.filter(si => {
								const rids = si.roomIds || (si.roomId ? [si.roomId] : []);
								if (!rids.includes(room.id)) return false;

								if (!dayVal.startsWith("legacy:")) {
									if (si.examDate !== dayVal) return false;
								} else {
									const targetDay = dayVal.replace("legacy:", "");
									if (si.day !== targetDay) return false;
								}

								const startMin = timeToMinutes(si.startTime);
								const endMin = timeToMinutes(si.endTime);
								const slotStartMin = (GRID_START_H + sIdx * SLOT_HOURS) * 60;
								const slotEndMin = slotStartMin + SLOT_HOURS * 60;
								return startMin < slotEndMin && slotStartMin < endMin;
							});

							// Deduplicate cellSchedules by courseCode to avoid duplicate cards in the cell
							const uniqueCellSchedules = [];
							const seenCodes = new Set();
							cellSchedules.forEach(si => {
								const code = si.courseCode || si.courseId || "N/A";
								if (!seenCodes.has(code)) {
									seenCodes.add(code);
									uniqueCellSchedules.push(si);
								}
							});

							pdfA3.setDrawColor(71, 85, 105);
							pdfA3.setLineWidth(0.2);
							pdfA3.setFillColor(255, 255, 255);
							pdfA3.rect(cellX, rowY, slotWidth, rowH, "F");
							pdfA3.rect(cellX, rowY, slotWidth, rowH, "D");

							// Internal hour ticks within a slot (only meaningful when a slot
							// spans more than one hour, i.e. exam's 3-hour blocks).
							if (SLOT_HOURS > 1) {
								pdfA3.setDrawColor(226, 232, 240);
								pdfA3.setLineWidth(0.08);
								for (let hIdx = 1; hIdx < SLOT_HOURS; hIdx++) {
									const tickX = cellX + (hIdx / SLOT_HOURS) * slotWidth;
									pdfA3.line(tickX, rowY, tickX, rowY + rowH);
								}
								pdfA3.setDrawColor(71, 85, 105);
								pdfA3.setLineWidth(0.2);
							}

							// Render blocked slots inside each room row timeslot cell (add to page-wide overlays)
							const cellBlockedSlots = getBlockedSlotsForSlot(dayVal, sIdx);
							if (cellBlockedSlots.length > 0) {
								cellBlockedSlots.forEach(b => {
									let relStart = 0;
									let relEnd = 1;
									const slotStartMin = (GRID_START_H + sIdx * SLOT_HOURS) * 60;
									const slotDurationMin = SLOT_HOURS * 60;

									if (b.type === "EXTRACURRICULAR" && b.start_time && b.end_time) {
										const [sH, sM] = b.start_time.split(":").map(Number);
										const [eH, eM] = b.end_time.split(":").map(Number);
										const startMin = sH * 60 + sM;
										const endMin = eH * 60 + eM;
										relStart = Math.max(0.0, (startMin - slotStartMin) / slotDurationMin);
										relEnd = Math.min(1.0, (endMin - slotStartMin) / slotDurationMin);
									}

									const itemX = cellX + relStart * slotWidth;
									const itemW = (relEnd - relStart) * slotWidth;

									const colKey = `${dIdx}-${sIdx}-${b.id}`;
									if (!pageBlockedCols.has(colKey)) {
										pageBlockedCols.set(colKey, {
											x: itemX,
											width: itemW,
											name: b.name
										});
									}
								});
								return;
							}

							if (uniqueCellSchedules.length > 0) {
								const sortedSchedules = [...uniqueCellSchedules].sort((a, b) => {
									const startA = timeToMinutes(a.startTime);
									const startB = timeToMinutes(b.startTime);
									if (startA !== startB) return startA - startB;
									return timeToMinutes(a.endTime) - timeToMinutes(b.endTime);
								});

								const lanes = packLanes(sortedSchedules);
								const numLanes = lanes.length;
								const laneH = rowH / numLanes;
								const slotStartHour = GRID_START_H + sIdx * SLOT_HOURS;

								lanes.forEach((laneSchedules, laneIdx) => {
									const laneY = rowY + laneIdx * laneH;
									laneSchedules.forEach(si => {
										const startHour = timeToMinutes(si.startTime) / 60.0;
										const endHour = timeToMinutes(si.endTime) / 60.0;

										let relStart = (startHour - slotStartHour) / SLOT_HOURS;
										let relEnd = (endHour - slotStartHour) / SLOT_HOURS;
										relStart = Math.max(0.0, Math.min(1.0, relStart));
										relEnd = Math.max(0.0, Math.min(1.0, relEnd));

										const itemX = cellX + relStart * slotWidth;
										const itemW = (relEnd - relStart) * slotWidth;
										drawTimetableCard(pdfA3, itemX, itemW, laneY, laneH, si, monochrome);
									});
								});
							}
						});
					} else {
						// Lecture: hourly grid. Each class is one chip positioned purely
						// by time inside its day, so it can never cross the day wall;
						// overlapping classes stack in lanes.
						pdfA3.setFillColor(255, 255, 255);
						pdfA3.rect(dayX, rowY, dayWidth, rowH, "F");

						// Blocked windows (e.g. Jumat) are shaded under this row's
						// chips; the band's border and single rotated label are drawn
						// once per page below.
						const dayStartMin = rangeStartMin;
						const dayEndMin = rangeStartMin + rangeMin;
						const dayBlocks = getBlockedSlotsForRange(dayVal, dayStartMin, dayEndMin).map((b) => {
							let bStart = dayStartMin;
							let bEnd = dayEndMin;
							if (b.type === "EXTRACURRICULAR" && b.start_time && b.end_time) {
								bStart = Math.max(dayStartMin, timeToMinutes(b.start_time));
								bEnd = Math.min(dayEndMin, timeToMinutes(b.end_time));
							}
							return { ...b, bStart, bEnd };
						});
						dayBlocks.forEach((b) => {
							const bx = xForMinute(dayX, b.bStart);
							const bw = xForMinute(dayX, b.bEnd) - bx;
							pdfA3.setFillColor(254, 242, 242); // very light red/rose
							pdfA3.rect(bx, rowY, bw, rowH, "F");
							const colKey = `${dIdx}-${b.id}`;
							if (!pageBlockedCols.has(colKey)) {
								pageBlockedCols.set(colKey, { x: bx, width: bw, name: b.name, underlay: true });
							}
						});

						for (let h = dayRange.startH + 1; h < dayRange.endH; h++) {
							if (h % 2 === 0) setEvenHourLine();
							else setOddHourLine();
							const lineX = xForMinute(dayX, h * 60);
							pdfA3.line(lineX, rowY, lineX, rowY + rowH);
						}
						resetLine();

						const placed = getLectureRoomDayLanes(room, facWeekSchedules, dayVal.replace("legacy:", ""));
						const laneCount = placed.length ? placed[0].laneCount : 1;
						const lanesTop = rowY + (rowH - (laneCount * LANE_PITCH - (LANE_PITCH - CHIP_H))) / 2;
						placed.forEach((si) => {
							const startMin = timeToMinutes(si.startTime);
							const endMin = timeToMinutes(si.endTime);
							if (endMin <= startMin) return;

							const blocked = dayBlocks.find((b) => startMin < b.bEnd && b.bStart < endMin);
							if (blocked) {
								console.warn(
									`[pdfExport] Scheduling conflict: ${si.courseCode} in ${room.name || room.id} ` +
									`(${si.day} ${si.startTime}-${si.endTime}) overlaps blocked slot "${blocked.name}"`,
								);
							}

							const chipX = xForMinute(dayX, startMin) + CHIP_INSET;
							const chipW = xForMinute(dayX, endMin) - xForMinute(dayX, startMin) - 2 * CHIP_INSET;
							if (drawLectureChip(chipX, lanesTop + si.lane * LANE_PITCH, chipW, si)) {
								pageHasMarkedChip = true;
							}
						});
					}
				});

				// Lecture: row border, then the heavy day walls on top.
				if (mode !== "exam") {
					resetLine();
					pdfA3.rect(m + venueColW, rowY, tableW - venueColW, rowH, "D");
					setDayWallLine();
					dayChunk.forEach((_, dIdx) => {
						const wallX = m + venueColW + facultyColW + dIdx * dayWidth;
						pdfA3.line(wallX, rowY, wallX, rowY + rowH);
					});
					resetLine();
				}

				rowY += rowH;
			});

			// Render Blocked Column Overlays (General Events)
			const totalGridHeight = rowChunk.reduce((sum, r) => sum + getA3RoomRowHeight(r, facWeekSchedules), 0);
			pageBlockedCols.forEach((colInfo) => {
				const { x, width, name, underlay } = colInfo;
				const gridStartY = tableStartY + 14;

				// Lecture bands were already shaded under the chips.
				if (!underlay) {
					pdfA3.setFillColor(254, 242, 242); // very light red/rose
					pdfA3.rect(x, gridStartY, width, totalGridHeight, "F");
				}

				pdfA3.setDrawColor(252, 165, 165); // light red border color
				pdfA3.setLineWidth(0.25);
				pdfA3.rect(x, gridStartY, width, totalGridHeight, "D");

				let fs = 7.5;
				pdfA3.setFont("helvetica", "bold");
				pdfA3.setFontSize(fs);
				const nameUpper = name.toUpperCase();
				let textWidth = pdfA3.getTextWidth(nameUpper);
				const minLabelFs = mode === "exam" ? 5 : 6;
				while (textWidth > totalGridHeight - 8 && fs > minLabelFs) {
					fs -= 0.5;
					pdfA3.setFontSize(fs);
					textWidth = pdfA3.getTextWidth(nameUpper);
				}
				pdfA3.setTextColor(220, 38, 38); // red text color

				const charHeight = fs * 0.3528 * 0.7;
				const xCenter = x + width / 2;
				const yCenter = gridStartY + totalGridHeight / 2;
				const lineX = xCenter - charHeight / 2;
				const lineY = yCenter + textWidth / 2;

				pdfA3.text(nameUpper, lineX, lineY, {
					align: "left",
					angle: 90
				});
			});

			// Legend for chips whose code prefix was dropped to fit.
			if (pageHasMarkedChip) {
				pdfA3.setFont("helvetica", "normal");
				pdfA3.setFontSize(7);
				pdfA3.setTextColor(71, 85, 105);
				pdfA3.text("• Course code has a LAG-/UNILAG- or similar prefix", m, pageH - 10.5);
			}

			// Render Footer
			pdfA3.setFont("helvetica", "normal");
			pdfA3.setFontSize(7);
			pdfA3.setTextColor(148, 163, 184);
			pdfA3.text("University of Lagos Timetable Manager", m, pageH - 6);
			pdfA3.setFont("helvetica", "bold");
			pdfA3.setFontSize(9);
			pdfA3.setTextColor(15, 23, 42);
			pdfA3.text(`Generated: ${generatedDate}`, pageW / 2, pageH - 6, { align: "center" });
			pdfA3.setFont("helvetica", "normal");
			pdfA3.setFontSize(7);
			pdfA3.setTextColor(148, 163, 184);
			pdfA3.text(`Page ${pageIdx + 1}`, pageW - m, pageH - 6, { align: "right" });

			pageIdx++;
		});

		const fname = getExportFileName(title, session, semester, faculty, scopeLabel, "a3");
		pdfA3.save(fname);
		return;
	}

	// =========================================================================
	// STANDARD A4 LAYOUT
	// =========================================================================
	const pageBg = monochrome ? [255, 255, 255] : [248, 250, 252];
	const white = [255, 255, 255];
	const accentBg = monochrome ? [50, 50, 50] : (mode === "lecture" ? [99, 102, 241] : [245, 158, 11]);
	const accentFg = [255, 255, 255];
	const gridLine = monochrome ? [120, 120, 120] : [226, 232, 240];
	const rowAlt = monochrome ? [240, 240, 240] : [241, 245, 249];
	const textDark = monochrome ? [0, 0, 0] : [15, 23, 42];
	const textMid = monochrome ? [40, 40, 40] : [71, 85, 105];
	const textFaint = monochrome ? [110, 110, 110] : [148, 163, 184];

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

	const MONO_SCHEME = { bg: [255, 255, 255], border: [0, 0, 0], text: [0, 0, 0] };

	const deptColor = {};
	let ci = 0;
	schedules.forEach((s) => {
		const deptKey = s.departmentId || "unassigned";
		if (!deptColor[deptKey]) deptColor[deptKey] = monochrome ? MONO_SCHEME : PALETTE[ci++ % PALETTE.length];
	});

	const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
	const pageW = 297;
	const pageH = 210;
	const margin = 10;
	const headerH = 8;
	const START_H = 8; // 08:00
	const END_H = 18; // 18:00
	const SLOTS = END_H - START_H; // 10 one-hour columns

	const BLOCK_HEAD_H = 10 + headerH;
	const BLOCK_GAP = 6;
	const mainHeaderEndY = margin + 48;
	const bottomLimit = pageH - margin;
	const FACULTY_BAND_H = groupByFaculty ? 9 : 0;
	const packGroups = mode === "exam";

	// Room lookup mapping
	const roomLookup = {};
	rooms.forEach((r) => { roomLookup[r.id] = r; });
	const generatedDate = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

	const getRoomRowHeight = (room, blockSchedules) => {
		const label = getRoomLabel(room);
		pdf.setFont("helvetica", "bold");
		pdf.setFontSize(8);
		const labelLines = pdf.splitTextToSize(label, 42 - 4); // roomLabelW is 42
		const labelHeight = 8 + (Math.max(1, labelLines.length) - 1) * 4;

		const roomSchedules = blockSchedules.filter((s) =>
			(s.roomIds || []).includes(room.id)
		);

		const itemsByWindow = new Map();
		roomSchedules.forEach((s) => {
			const key = `${s.startTime}-${s.endTime}`;
			if (!itemsByWindow.has(key)) {
				itemsByWindow.set(key, { startTime: s.startTime, endTime: s.endTime, schedules: [] });
			}
			itemsByWindow.get(key).schedules.push(s);
		});

		const items = [...itemsByWindow.values()].map((it) => {
			const [sH, sM] = it.startTime.split(":").map(Number);
			const [eH, eM] = it.endTime.split(":").map(Number);
			return { ...it, startFrac: (sH - START_H) + sM / 60, endFrac: (eH - START_H) + eM / 60 };
		}).filter((it) => it.startFrac >= 0 && it.startFrac < SLOTS);

		items.sort((a, b) => a.startFrac - b.startFrac);
		const laneEnds = [];
		items.forEach((it) => {
			let lane = laneEnds.findIndex((end) => end <= it.startFrac + 1e-6);
			if (lane === -1) { lane = laneEnds.length; laneEnds.push(it.endFrac); }
			else laneEnds[lane] = it.endFrac;
		});
		const numLanes = Math.max(1, laneEnds.length);

		let maxCodesInAnyItem = 1;
		items.forEach((it) => {
			const codes = [];
			it.schedules.forEach(si => {
				const code = si.courseCode || si.courseId || "N/A";
				const parts = code.split(/[,/]+/).map(p => p.trim()).filter(Boolean);
				codes.push(...parts);
			});
			maxCodesInAnyItem = Math.max(maxCodesInAnyItem, codes.length);
		});

		const eventsHeight = numLanes * (maxCodesInAnyItem * 3.6) + 1.6;
		return Math.max(labelHeight, eventsHeight, 8);
	};

	const pages = [];
	let curPage = null;
	let curY = 0;
	let globalPageIsFirst = true;
	let curFaculty = null;

	const startNewPage = () => {
		curPage = {
			hasMainHeader: true,
			blocks: [],
			faculty: curFaculty,
		};
		pages.push(curPage);
		curY = (margin + 16) + FACULTY_BAND_H;
		globalPageIsFirst = false;
	};

	groups.forEach((group) => {
		const usedRoomIds = [];
		group.schedules.forEach((s) => {
			(s.roomIds || []).forEach((rid) => {
				if (!usedRoomIds.includes(rid)) usedRoomIds.push(rid);
			});
		});

		usedRoomIds.sort((a, b) => {
			return (
				rooms.findIndex((r) => r.id === a) - rooms.findIndex((r) => r.id === b)
			);
		});

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
				rooms: chunkRoomIds.map(
					(rid) => roomLookup[rid] || { id: rid, name: rid },
				),
				day: group.day,
				gap,
			});
			curY += gap + BLOCK_HEAD_H + chunkHeight;
			isFirstChunk = false;
		};

		if (usedRoomIds.length === 0) {
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
				const roomH = getRoomRowHeight(room, group.schedules);
				if (chunk.length > 0 && currentChunkHeight + roomH > remainingSpace) {
					break;
				}
				chunk.push(usedRoomIds[j]);
				currentChunkHeight += roomH;
				j++;
			}

			if (chunk.length === 0 && j < usedRoomIds.length) {
				const room = roomLookup[usedRoomIds[j]] || { id: usedRoomIds[j], name: usedRoomIds[j] };
				chunk.push(usedRoomIds[j]);
				currentChunkHeight += getRoomRowHeight(room, group.schedules);
				j++;
			}

			pushBlock(chunk, gap, currentChunkHeight);
			i = j;
			if (i < usedRoomIds.length) startNewPage();
		}
	});

	pages.forEach((page, pi) => {
		if (pi > 0) pdf.addPage();

		pdf.setFillColor(...pageBg);
		pdf.rect(0, 0, pageW, pageH, "F");

		let y = margin;
		const logoSize = 12;
		try {
			pdf.addImage(unilagLogoBase64, "PNG", margin, y, logoSize, logoSize);
		} catch (e) {}

		pdf.setFont("helvetica", "bold");
		pdf.setFontSize(12);
		pdf.setTextColor(...textDark);
		pdf.text((schoolName || "University of Lagos").toUpperCase(), margin + logoSize + 3, y + 4.5);

		pdf.setFontSize(8.5);
		pdf.setFont("helvetica", "normal");
		pdf.setTextColor(...textMid);
		const sub = [`${session} Session`, semester, faculty, scopeLabel].filter(Boolean).join("   ·   ");
		const maxSubW = pageW / 2 - (margin + logoSize + 6); // ~108mm max width
		const subLines = pdf.splitTextToSize(sub, maxSubW);
		subLines.forEach((line, idx) => {
			pdf.text(line, margin + logoSize + 3, y + 10 + idx * 3.5);
		});

		// Week label in the center (exam only - lectures recur weekly by
		// day-of-week, so there's no meaningful "week" concept to show).
		if (mode === "exam") {
			pdf.setFont("helvetica", "bold");
			pdf.setFontSize(12);
			pdf.setTextColor(...textDark);

			let pageWeekNum = 1;
			if (page.blocks.length > 0 && page.blocks[0].day && page.blocks[0].day.includes("-")) {
				const examDates = schedules.map(s => s.examDate).filter(d => d && d !== "TBD" && !d.startsWith("legacy:") && d.includes("-"));
				if (examDates.length > 0) {
					const sortedDates = [...new Set(examDates)].sort();
					pageWeekNum = getWeekNumberForDate(page.blocks[0].day, sortedDates[0]);
				}
			}
			const weekLabel = `WEEK ${pageWeekNum}`;
			pdf.text(weekLabel, pageW / 2, y + 6, { align: "center" });
		}

		// Timetable title on the right
		const timetableTitle = getTimetableTypeLabel(title, faculty, scopeLabel);
		pdf.setFont("helvetica", "bold");
		pdf.setFontSize(11);
		pdf.setTextColor(...textDark);
		const maxTitleW = pageW / 2 - margin - 15; // ~123.5mm max width
		const titleLines = pdf.splitTextToSize(timetableTitle.toUpperCase(), maxTitleW);
		titleLines.forEach((line, idx) => {
			pdf.text(line, pageW - margin, y + 4.5 + idx * 4.5, { align: "right" });
		});

		const docStatus = isLocked ? "FINAL TIMETABLE" : "DRAFT TIMETABLE";
		pdf.setFontSize(8.5);
		pdf.setFont("helvetica", "bold");
		pdf.setTextColor(...(isLocked ? [16, 185, 129] : [245, 158, 11]));
		pdf.text(docStatus, pageW - margin, y + 10 + (titleLines.length - 1) * 4.5, { align: "right" });

		let curY = margin + 16;

		if (groupByFaculty && page.faculty) {
			pdf.setFont("helvetica", "bold");
			pdf.setFontSize(10);
			pdf.setTextColor(...textDark);
			pdf.text(page.faculty.toUpperCase(), pageW / 2, curY + 4, {
				align: "center",
			});
			pdf.setDrawColor(...accentBg);
			pdf.setLineWidth(0.4);
			pdf.line(margin, curY + 6.5, pageW - margin, curY + 6.5);
			curY += FACULTY_BAND_H;
		}

		page.blocks.forEach((block, bi) => {
			const pageRooms = block.rooms;
			if (bi > 0) curY += BLOCK_GAP;

			pdf.setFillColor(...accentBg);
			pdf.roundedRect(margin, curY, pageW - margin * 2, 8, 1.5, 1.5, "F");

			pdf.setFont("helvetica", "bold");
			pdf.setFontSize(8);
			pdf.setTextColor(...accentFg);
			pdf.text(block.label, margin + 4, curY + 5.5);

			curY += 10;

			const tableX = margin;
			const tableW = pageW - margin * 2;
			const roomLabelW = 42; // Width of room label cell
			const slotW = (tableW - roomLabelW) / SLOTS;

			pdf.setFillColor(...accentBg);
			pdf.rect(tableX, curY, roomLabelW, headerH, "F");
			pdf.setFont("helvetica", "bold");
			pdf.setFontSize(8);
			pdf.setTextColor(...accentFg);
			pdf.text("ROOM", tableX + roomLabelW / 2, curY + headerH / 2 + 1.5, {
				align: "center",
			});

			for (let h = 0; h < SLOTS; h++) {
				const hx = tableX + roomLabelW + h * slotW;
				pdf.setFillColor(...accentBg);
				pdf.rect(hx, curY, slotW, headerH, "F");

				pdf.setFont("helvetica", "bold");
				pdf.setFontSize(7.5);
				pdf.setTextColor(...accentFg);
				const label = `${(START_H + h).toString().padStart(2, "0")}:00`;
				pdf.text(label, hx + slotW / 2, curY + headerH / 2 + 1.5, {
					align: "center",
				});

				pdf.setDrawColor(...gridLine);
				pdf.setLineWidth(0.15);
				pdf.line(hx, curY, hx, curY + headerH);
			}

			curY += headerH;

			let rowY = curY;
			pageRooms.forEach((room, ri) => {
				const rowH = getRoomRowHeight(room, block.schedules);
				const isAlt = ri % 2 === 1;

				pdf.setFillColor(...(isAlt ? rowAlt : white));
				pdf.rect(tableX, rowY, tableW, rowH, "F");

				pdf.setFont("helvetica", "bold");
				pdf.setFontSize(8);
				pdf.setTextColor(...textDark);

				const roomLabel = getRoomLabel(room);
				const lines = pdf.splitTextToSize(roomLabel, roomLabelW - 4);
				const lineSpacing = 3.6;
				const startY = rowY + (rowH - (lines.length - 1) * lineSpacing) / 2 + 1.2;
				lines.forEach((line, index) => {
					pdf.text(line, tableX + 2, startY + index * lineSpacing);
				});

				// Blocked slots backgrounds
				const dayBlocks =
					blockedSlots.filter((b) => {
						if (mode === "exam") {
							if (b.type === "HOLIDAY") return b.date === block.day;
							if (b.type === "EXTRACURRICULAR") {
								const w = new Date(block.day).toLocaleDateString("en-US", {
									weekday: "long",
								});
								return b.day_of_week === w;
							}
						}
						return b.day_of_week === block.day;
					}) || [];
				dayBlocks.forEach((b) => {
					pdf.setFillColor(...blockedFill);
					if (b.type === "HOLIDAY" || !b.start_time || !b.end_time) {
						pdf.rect(
							tableX + roomLabelW,
							rowY,
							tableW - roomLabelW,
							rowH,
							"F",
						);
					} else if (
						b.type === "EXTRACURRICULAR" &&
						b.start_time &&
						b.end_time
					) {
						const [sH, sM] = b.start_time.split(":").map(Number);
						const [eH, eM] = b.end_time.split(":").map(Number);
						const startFrac = sH - START_H + sM / 60;
						const endFrac = eH - START_H + eM / 60;

						if (startFrac < SLOTS && endFrac > 0) {
							const drawStart = Math.max(0, startFrac);
							const drawEnd = Math.min(SLOTS, endFrac);
							const bx = tableX + roomLabelW + drawStart * slotW;
							const bw = (drawEnd - drawStart) * slotW;
							pdf.rect(bx, rowY, bw, rowH, "F");
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

				// Draw events in this room
				const roomSchedules = block.schedules.filter((s) =>
					(s.roomIds || []).includes(room.id),
				);

				const itemsByWindow = new Map();
				roomSchedules.forEach((s) => {
					const key = `${s.startTime}-${s.endTime}`;
					if (!itemsByWindow.has(key)) {
						itemsByWindow.set(key, {
							startTime: s.startTime,
							endTime: s.endTime,
							schedules: [],
						});
					}
					itemsByWindow.get(key).schedules.push(s);
				});

				const items = [...itemsByWindow.values()]
					.map((it) => {
						const [sH, sM] = it.startTime.split(":").map(Number);
						const [eH, eM] = it.endTime.split(":").map(Number);
						return {
							...it,
							startFrac: sH - START_H + sM / 60,
							endFrac: eH - START_H + eM / 60,
						};
					})
					.filter((it) => it.startFrac >= 0 && it.startFrac < SLOTS);

				items.sort((a, b) => a.startFrac - b.startFrac);
				const laneEnds = [];
				items.forEach((it) => {
					let lane = laneEnds.findIndex((end) => end <= it.startFrac + 1e-6);
					if (lane === -1) {
						lane = laneEnds.length;
						laneEnds.push(it.endFrac);
					} else laneEnds[lane] = it.endFrac;
					it.lane = lane;
				});
				const numLanes = Math.max(1, laneEnds.length);

				const evH = rowH - 1;
				const laneH = evH / numLanes;

				items.forEach((it) => {
					const clampedDur = Math.min(
						it.endFrac - it.startFrac,
						SLOTS - it.startFrac,
					);
					const col =
						deptColor[it.schedules[0].departmentId || "unassigned"] ||
						PALETTE[0];
					const evX = tableX + roomLabelW + it.startFrac * slotW + 0.5;
					const evY = rowY + 0.5 + it.lane * laneH;
					const evW = clampedDur * slotW - 1;
					const cellH = laneH - (numLanes > 1 ? 0.4 : 0);

					pdf.setFillColor(...col.bg);
					pdf.roundedRect(evX, evY, evW, cellH, 0.8, 0.8, "F");

					pdf.setDrawColor(...col.border);
					pdf.setLineWidth(0.2);
					pdf.roundedRect(evX, evY, evW, cellH, 0.8, 0.8, "D");

					const courseCodes = [];
					it.schedules.forEach(si => {
						const code = si.courseCode || si.courseId || "N/A";
						const parts = code.split(/[,/]+/).map(p => p.trim()).filter(Boolean);
						courseCodes.push(...parts);
					});

					let codeFontSize = 9.0;
					let lineHeight = codeFontSize * 0.3528 * 1.25;
					let totalHeight = courseCodes.length * lineHeight;
					
					// Dynamic font size adjustment for both height and width constraints
					while (codeFontSize > 5) {
						pdf.setFontSize(codeFontSize);
						let fitsWidth = true;
						courseCodes.forEach(line => {
							if (pdf.getTextWidth(line) > evW - 1.2) {
								fitsWidth = false;
							}
						});
						
						const tempLineHeight = codeFontSize * 0.3528 * 1.25;
						const tempTotalHeight = courseCodes.length * tempLineHeight;
						const fitsHeight = tempTotalHeight <= cellH - 1.2;
						
						if (fitsWidth && fitsHeight) {
							break;
						}
						codeFontSize -= 0.5;
					}
					
					lineHeight = codeFontSize * 0.3528 * 1.25;
					totalHeight = courseCodes.length * lineHeight;

					if (codeFontSize >= 3) {
						pdf.setFont("helvetica", "bold");
						pdf.setFontSize(codeFontSize);
						pdf.setTextColor(...col.text);

						const startY = evY + cellH / 2 - totalHeight / 2 + (codeFontSize * 0.3528 * 0.85);

						courseCodes.forEach((line, index) => {
							let lineStr = line;
							while (pdf.getTextWidth(lineStr) > evW - 2 && lineStr.length > 2) {
								lineStr = lineStr.slice(0, -2) + "…";
							}
							pdf.text(lineStr, evX + 1.5, startY + index * lineHeight);
						});
					}
				});

				rowY += rowH;
			});

			const gridH = pageRooms.reduce((sum, r) => sum + getRoomRowHeight(r, block.schedules), 0);

			const dayBlocks =
				blockedSlots.filter((b) => {
					if (mode === "exam") {
						if (b.type === "HOLIDAY") return b.date === block.day;
						if (b.type === "EXTRACURRICULAR") {
							const w = new Date(block.day).toLocaleDateString("en-US", {
								weekday: "long",
							});
							return b.day_of_week === w;
						}
					}
					return b.day_of_week === block.day;
				}) || [];
			if (dayBlocks.length > 0) {
				pdf.setFont("helvetica", "bolditalic");
				pdf.setFontSize(9);
				pdf.setTextColor(...blockedText);

				dayBlocks.forEach((b) => {
					if (b.type === "HOLIDAY") {
						const tx = tableX + roomLabelW + (tableW - roomLabelW) / 2;
						const ty = curY + gridH / 2;
						pdf.text(`HOLIDAY: ${b.name.toUpperCase()}`, tx, ty, {
							align: "center",
							angle: -35,
						});
					} else if (!b.start_time || !b.end_time) {
						const tx = tableX + roomLabelW + (tableW - roomLabelW) / 2;
						const ty = curY + gridH / 2;
						pdf.text(`${b.name.toUpperCase()}`, tx, ty, {
							align: "center",
							angle: -35,
						});
					} else if (
						b.type === "EXTRACURRICULAR" &&
						b.start_time &&
						b.end_time
					) {
						const [sH, sM] = b.start_time.split(":").map(Number);
						const [eH, eM] = b.end_time.split(":").map(Number);
						const startFrac = sH - START_H + sM / 60;
						const endFrac = eH - START_H + eM / 60;
						if (startFrac < SLOTS && endFrac > 0) {
							const drawStart = Math.max(0, startFrac);
							const drawEnd = Math.min(SLOTS, endFrac);
							const bMidX =
								tableX +
								roomLabelW +
								(drawStart + (drawEnd - drawStart) / 2) * slotW;
							pdf.text(`${b.name.toUpperCase()}`, bMidX, curY + gridH / 2, {
								align: "center",
								angle: -90,
							});
						}
					}
				});
			}

			pdf.setDrawColor(...gridLine);
			pdf.setLineWidth(0.25);
			pdf.rect(tableX, curY, tableW, gridH);

			curY += gridH;
		});

		pdf.setFont("helvetica", "normal");
		pdf.setFontSize(5.5);
		pdf.setTextColor(...textFaint);
		pdf.text("University of Lagos Timetable Manager", margin, pageH - 3);
		pdf.setFont("helvetica", "bold");
		pdf.setFontSize(7.5);
		pdf.setTextColor(...textDark);
		pdf.text(`Generated: ${generatedDate}`, pageW / 2, pageH - 3, {
			align: "center",
		});
		pdf.setFont("helvetica", "normal");
		pdf.setFontSize(5.5);
		pdf.setTextColor(...textFaint);
		pdf.text(`Page ${pi + 1} of ${pages.length}`, pageW - margin, pageH - 3, {
			align: "right",
		});
	});

	const fileName = getExportFileName(title, session, semester, faculty, scopeLabel, "a4");
	pdf.save(fileName);
}
