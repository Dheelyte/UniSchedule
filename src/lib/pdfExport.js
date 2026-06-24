import jsPDF from "jspdf";
import { unilagLogoBase64 } from "@/lib/logo";
import { GENERAL_STUDIES_FACULTY } from "@/lib/utils";

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
export function exportTimetablePDF({
	schedules,
	blockedSlots = [],
	rooms = [],
	faculties = [],
	title,
	session,
	semester,
	faculty,
	department,
	schoolName = "University of Lagos",
	mode,
	monochrome = false,
	groupByFaculty = false,
	paperSize = "a4",
	structured = false,
	isLocked = false,
}) {
	if (!schedules || schedules.length === 0) return;

	const ACTIVE_DAYS = [
		"Monday",
		"Tuesday",
		"Wednesday",
		"Thursday",
		"Friday",
		"Saturday",
	];
	const START_H = 8; // 08:00
	const END_H = 18; // 18:00
	const SLOTS = END_H - START_H; // 10 one-hour columns

	// Build room lookup
	const roomLookup = {};
	rooms.forEach((r) => {
		roomLookup[r.id] = r;
	});

	const generatedDate = new Date().toLocaleDateString("en-GB", {
		day: "numeric",
		month: "long",
		year: "numeric",
	});

	// ---- Palette (color or black & white) ----
	const pageBg = monochrome ? [255, 255, 255] : [248, 250, 252];
	const white = [255, 255, 255];
	const accentBg = monochrome
		? [50, 50, 50]
		: mode === "lecture"
			? [99, 102, 241]
			: [245, 158, 11];
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
	const MONO_SCHEME = {
		bg: [255, 255, 255],
		border: [0, 0, 0],
		text: [0, 0, 0],
	};

	const deptColor = {};
	let ci = 0;
	schedules.forEach((s) => {
		const deptKey = s.departmentId || "unassigned";
		if (!deptColor[deptKey])
			deptColor[deptKey] = monochrome
				? MONO_SCHEME
				: PALETTE[ci++ % PALETTE.length];
	});

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
				if (ds.length)
					out.push({ label: ptLabel, day: dateStr, schedules: ds });
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

	// Structured A3 layout: metadata + date-ordered table (for large, printable A3 exports)
	if (paperSize === "a3" || structured) {
		const pdfA3 = new jsPDF({
			orientation: "landscape",
			unit: "mm",
			format: "a3",
		});
		const a3W = 420; // mm (landscape)
		const a3H = 297;
		const m = 12;

		const generatedDate = new Date().toLocaleDateString("en-GB", {
			day: "numeric",
			month: "long",
			year: "numeric",
		});

		// Helper: convert time HH:MM to minutes from midnight
		function timeToMinutes(timeStr) {
			if (!timeStr) return 0;
			const [h, m] = timeStr.split(":").map(Number);
			return h * 60 + (m || 0);
		}

		// Helper: check if a timeslot is blocked (General Event)
		function getGeneralEvent(dayOrDate, slotIdx) {
			const slotStartMin = slotIdx === 0 ? 9 * 60 : slotIdx === 1 ? 12 * 60 : 15 * 60;
			const slotEndMin = slotIdx === 0 ? 12 * 60 : slotIdx === 1 ? 15 * 60 : 18 * 60;

			const isDate = !dayOrDate.startsWith("legacy:") && dayOrDate.includes("-");
			let dateVal = null;
			let dayVal = dayOrDate;
			if (isDate) {
				dateVal = dayOrDate;
				dayVal = new Date(dayOrDate).toLocaleDateString("en-US", { weekday: "long" });
			} else {
				dayVal = dayOrDate.replace("legacy:", "");
			}

			const match = blockedSlots.find(b => {
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

			return match ? match.name : null;
		}

		// Helper: draw centered course code list text inside grid cells
		function drawCenteredText(pdf, lines, x, y, w, h) {
			let fs = 7.5;
			let lineHeight = fs * 0.3528 * 1.3;
			let totalH = lines.length * lineHeight;
			while (totalH > h - 1.5 && fs > 5) {
				fs -= 0.5;
				lineHeight = fs * 0.3528 * 1.3;
				totalH = lines.length * lineHeight;
			}
			pdf.setFontSize(fs);
			pdf.setFont("helvetica", "bold");
			pdf.setTextColor(15, 23, 42);
			const startY = y + h / 2 - totalH / 2 + (fs * 0.3528 * 0.85);
			lines.forEach((line, idx) => {
				pdf.text(line, x + w / 2, startY + idx * lineHeight, { align: "center" });
			});
		}

		// Helper: get Monday of date string
		function getMondayOfDate(dateStr) {
			const d = new Date(dateStr);
			const day = d.getDay();
			const diff = d.getDate() - day + (day === 0 ? -6 : 1);
			const monday = new Date(d.setDate(diff));
			return monday.toISOString().slice(0, 10);
		}

		// 1. Gather all unique dates (or legacy days) from schedules, filled as standard Monday–Saturday weeks
		const uniqueDates = [];
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
				// Fallback to legacy days
				uniqueDates.push("legacy:Monday", "legacy:Tuesday", "legacy:Wednesday", "legacy:Thursday", "legacy:Friday", "legacy:Saturday");
			}
		} else {
			// Lecture mode is always standard week days
			uniqueDates.push("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday");
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
			const fac = faculties.find(f => f.id === r.faculty_id);
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

		const facultyGroups = {};
		activeRooms.forEach(r => {
			const facName = roomFaculties[r.id] || "SHARED";
			if (!facultyGroups[facName]) facultyGroups[facName] = [];
			facultyGroups[facName].push(r);
		});

		const sortedFacultyNames = Object.keys(facultyGroups).sort((a, b) => {
			const isAGS = a.toLowerCase().includes("general studies") || a === GENERAL_STUDIES_FACULTY;
			const isBGS = b.toLowerCase().includes("general studies") || b === GENERAL_STUDIES_FACULTY;
			if (isAGS && !isBGS) return -1;
			if (!isAGS && isBGS) return 1;
			if (a === "SHARED" && b !== "SHARED") return 1;
			if (a !== "SHARED" && b === "SHARED") return -1;
			return a.localeCompare(b);
		});

		const allRows = [];
		sortedFacultyNames.forEach(facName => {
			const facRooms = facultyGroups[facName];
			facRooms.forEach((room, idx) => {
				allRows.push({
					room,
					facultyName: facName,
					isFirstInBlock: idx === 0,
					blockLength: facRooms.length
				});
			});
		});

		// 3. Pagination limits and slicing
		const daysPerPage = 6;
		const rowsPerPage = 18;

		const dayChunks = [];
		for (let i = 0; i < uniqueDates.length; i += daysPerPage) {
			dayChunks.push(uniqueDates.slice(i, i + daysPerPage));
		}

		const rowChunks = [];
		for (let i = 0; i < allRows.length; i += rowsPerPage) {
			rowChunks.push(allRows.slice(i, i + rowsPerPage));
		}

		const STANDARD_SLOTS = [
			{ id: 0, label: "9am - 12pm", start: "09:00", end: "12:00" },
			{ id: 1, label: "12pm - 3pm", start: "12:00", end: "15:00" },
			{ id: 2, label: "3pm - 6pm", start: "15:00", end: "18:00" }
		];

		let pageIdx = 0;
		dayChunks.forEach((dayChunk, dayChunkIdx) => {
			rowChunks.forEach((rowChunk, rowChunkIdx) => {
				if (pageIdx > 0) {
					pdfA3.addPage();
				}

				// Compute dynamic page-specific faculty blocks
				const pageRows = [];
				let currentFac = null;
				let facStartIndex = 0;

				rowChunk.forEach((row, idx) => {
					const info = {
						...row,
						isFirstInPageBlock: false,
						pageBlockLength: 1
					};
					pageRows.push(info);

					if (row.facultyName !== currentFac) {
						if (currentFac !== null) {
							pageRows[facStartIndex].pageBlockLength = idx - facStartIndex;
						}
						info.isFirstInPageBlock = true;
						currentFac = row.facultyName;
						facStartIndex = idx;
					}
				});
				if (currentFac !== null) {
					pageRows[facStartIndex].pageBlockLength = rowChunk.length - facStartIndex;
				}

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

				pdfA3.setFontSize(11);
				pdfA3.setFont("helvetica", "normal");
				pdfA3.setTextColor(71, 85, 105);
				const sub = [`${session} Session`, semester, faculty, department].filter(Boolean).join("   ·   ");
				pdfA3.text(sub, m + logoSize + 4, y + 12);

				pdfA3.setFont("helvetica", "bold");
				pdfA3.setFontSize(14);
				pdfA3.setTextColor(15, 23, 42);
				pdfA3.text((title || "TIMETABLE").toUpperCase(), a3W - m, y + 5, { align: "right" });

				const docStatus = isLocked ? "FINAL TIMETABLE" : "DRAFT TIMETABLE";
				pdfA3.setFontSize(10);
				pdfA3.setFont("helvetica", "bold");
				pdfA3.setTextColor(...(isLocked ? [16, 185, 129] : [245, 158, 11]));
				pdfA3.text(docStatus, a3W - m, y + 12, { align: "right" });

				// Render Grid Table
				const tableStartY = 34;
				const tableW = a3W - 2 * m; // 396
				const venueColW = 22;
				const facultyColW = 28;
				const remainingW = tableW - venueColW - facultyColW; // 346
				const dayWidth = remainingW / dayChunk.length;
				const slotWidth = dayWidth / 3;

				// Draw Header background
				pdfA3.setFillColor(241, 245, 249);
				pdfA3.rect(m, tableStartY, tableW, 14, "F");

				// Header grid outlines & text
				pdfA3.setDrawColor(71, 85, 105);
				pdfA3.setLineWidth(0.2);
				pdfA3.rect(m, tableStartY, venueColW, 14, "D");
				pdfA3.rect(m + venueColW, tableStartY, facultyColW, 14, "D");

				pdfA3.setFont("helvetica", "bold");
				pdfA3.setFontSize(8.5);
				pdfA3.setTextColor(15, 23, 42);
				pdfA3.text("VENUE", m + venueColW / 2, tableStartY + 8.5, { align: "center" });
				pdfA3.text("FACULTY", m + venueColW + facultyColW / 2, tableStartY + 8.5, { align: "center" });

				dayChunk.forEach((dayVal, dIdx) => {
					const dayX = m + venueColW + facultyColW + dIdx * dayWidth;

					// Format Day/Date Label
					let dateLabel = "";
					if (mode === "exam") {
						if (dayVal.startsWith("legacy:")) {
							dateLabel = dayVal.replace("legacy:", "").toUpperCase();
						} else {
							const dateObj = new Date(dayVal);
							const dayIndex = uniqueDates.indexOf(dayVal) + 1;
							const formattedDate = dateObj.toLocaleDateString("en-GB", {
								weekday: "long",
								day: "2-digit",
								month: "long",
								year: "numeric"
							}).toUpperCase();
							dateLabel = `DAY ${dayIndex}: ${formattedDate}`;
						}
					} else {
						dateLabel = dayVal.toUpperCase();
					}

					// Day block
					pdfA3.rect(dayX, tableStartY, dayWidth, 7, "D");
					pdfA3.setFont("helvetica", "bold");
					pdfA3.setFontSize(8);
					pdfA3.setTextColor(15, 23, 42);
					pdfA3.text(dateLabel, dayX + dayWidth / 2, tableStartY + 4.5, { align: "center" });

					// Timeslots
					STANDARD_SLOTS.forEach((slot, sIdx) => {
						const slotX = dayX + sIdx * slotWidth;
						const eventName = getGeneralEvent(dayVal, sIdx);
						const slotLabel = eventName ? eventName.toUpperCase() : slot.label;

						if (eventName) {
							pdfA3.setFillColor(229, 231, 235); // darker grey fill for blocked slots
							pdfA3.rect(slotX, tableStartY + 7, slotWidth, 7, "F");
						}
						pdfA3.rect(slotX, tableStartY + 7, slotWidth, 7, "D");

						pdfA3.setFont("helvetica", eventName ? "bold" : "normal");
						pdfA3.setFontSize(7);
						pdfA3.setTextColor(15, 23, 42);
						pdfA3.text(slotLabel, slotX + slotWidth / 2, tableStartY + 11.5, { align: "center" });
					});
				});

				// Render Grid Rows
				let rowY = tableStartY + 14;
				const rowH = 12;
				const pageBlockedCols = new Map(); // tracks column block overlays to draw at the end

				pageRows.forEach((r, rIdx) => {
					// Draw Room Cell
					pdfA3.setFillColor(255, 255, 255);
					pdfA3.rect(m, rowY, venueColW, rowH, "F");
					pdfA3.rect(m, rowY, venueColW, rowH, "D");

					pdfA3.setFont("helvetica", "bold");
					pdfA3.setFontSize(7.5);
					pdfA3.setTextColor(15, 23, 42);
					pdfA3.text(r.room.name || r.room.id, m + venueColW / 2, rowY + rowH / 2 + 1, { align: "center" });

					// Draw Faculty Cell (merged vertically)
					if (r.isFirstInPageBlock) {
						const spanH = r.pageBlockLength * rowH;
						pdfA3.setFillColor(255, 255, 255);
						pdfA3.rect(m + venueColW, rowY, facultyColW, spanH, "F");
						pdfA3.rect(m + venueColW, rowY, facultyColW, spanH, "D");

						let fSize = 8.5;
						pdfA3.setFont("helvetica", "bold");
						pdfA3.setFontSize(fSize);
						const facNameUpper = r.facultyName.toUpperCase();
						while (pdfA3.getTextWidth(facNameUpper) > spanH - 6 && fSize > 5.5) {
							fSize -= 0.5;
							pdfA3.setFontSize(fSize);
						}
						pdfA3.setTextColor(71, 85, 105);
						const textWidth = pdfA3.getTextWidth(facNameUpper);
						const charHeight = fSize * 0.3528 * 0.7;
						const xCenter = m + venueColW + facultyColW / 2;
						const yCenter = rowY + spanH / 2;
						pdfA3.text(facNameUpper, xCenter + charHeight / 2, yCenter + textWidth / 2, {
							align: "left",
							angle: 90
						});
					}

					// Draw Grid Cells
					dayChunk.forEach((dayVal, dIdx) => {
						const dayX = m + venueColW + facultyColW + dIdx * dayWidth;

						STANDARD_SLOTS.forEach((slot, sIdx) => {
							const cellX = dayX + sIdx * slotWidth;
							const eventName = getGeneralEvent(dayVal, sIdx);

							if (eventName) {
								const colKey = `${dIdx}-${sIdx}`;
								if (!pageBlockedCols.has(colKey)) {
									pageBlockedCols.set(colKey, {
										x: cellX,
										width: slotWidth,
										name: eventName
									});
								}
								return; // skip drawing individual cell, handled by vertical overlay later
							}

							// Fetch scheduled sittings in this room/day/timeslot
							const cellSchedules = schedules.filter(si => {
								const rids = si.roomIds || (si.roomId ? [si.roomId] : []);
								if (!rids.includes(r.room.id)) return false;

								if (mode === "exam" && !dayVal.startsWith("legacy:")) {
									if (si.examDate !== dayVal) return false;
								} else {
									const targetDay = dayVal.replace("legacy:", "");
									if (si.day !== targetDay) return false;
								}

								const startMin = timeToMinutes(si.startTime);
								if (sIdx === 0) return startMin < 12 * 60;
								if (sIdx === 1) return startMin >= 12 * 60 && startMin < 15 * 60;
								return startMin >= 15 * 60;
							});

							pdfA3.setFillColor(255, 255, 255);
							pdfA3.rect(cellX, rowY, slotWidth, rowH, "F");
							pdfA3.rect(cellX, rowY, slotWidth, rowH, "D");

							if (cellSchedules.length > 0) {
								const courseCodes = cellSchedules.map(si => si.courseCode || si.courseId || "N/A");
								drawCenteredText(pdfA3, courseCodes, cellX, rowY, slotWidth, rowH);
							}
						});
					});

					rowY += rowH;
				});

				// Render Blocked Column Overlays (General Events)
				const totalGridHeight = pageRows.length * rowH;
				pageBlockedCols.forEach((colInfo) => {
					const { x, width, name } = colInfo;
					const gridStartY = tableStartY + 14;

					pdfA3.setFillColor(243, 244, 246); // light grey vertical span
					pdfA3.rect(x, gridStartY, width, totalGridHeight, "F");
					pdfA3.rect(x, gridStartY, width, totalGridHeight, "D");

					let fs = 9;
					pdfA3.setFont("helvetica", "bold");
					pdfA3.setFontSize(fs);
					const nameUpper = name.toUpperCase();
					while (pdfA3.getTextWidth(nameUpper) > totalGridHeight - 8 && fs > 6) {
						fs -= 0.5;
						pdfA3.setFontSize(fs);
					}
					pdfA3.setTextColor(71, 85, 105);
					const textWidth = pdfA3.getTextWidth(nameUpper);
					const charHeight = fs * 0.3528 * 0.7;
					const xCenter = x + width / 2;
					const yCenter = gridStartY + totalGridHeight / 2;
					pdfA3.text(nameUpper, xCenter + charHeight / 2, yCenter + textWidth / 2, {
						align: "left",
						angle: 90
					});
				});

				// Render Footer
				pdfA3.setFont("helvetica", "normal");
				pdfA3.setFontSize(7);
				pdfA3.setTextColor(148, 163, 184);
				pdfA3.text("University of Lagos Timetable Manager", m, a3H - 6);
				pdfA3.text(`Generated: ${generatedDate}`, a3W / 2, a3H - 6, { align: "center" });
				pdfA3.text(`Page ${pageIdx + 1}`, a3W - m, a3H - 6, { align: "right" });

				pageIdx++;
			});
		});

		const fname = `${title.replace(/\s+/g, "_").toLowerCase()}_${new Date().toISOString().slice(0, 10)}_a3.pdf`;
		pdfA3.save(fname);
		return;
	}

	const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
	const pageW = 297;
	const pageH = 210;
	const margin = 10;
	const headerH = 8;

	const ROW_H = 8;
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
	const packGroups = mode === "exam";

	// Structure groups into physical pages, packing day-blocks vertically.
	const pages = [];
	let curPage = null;
	let curY = 0;
	let globalPageIsFirst = true;
	let curFaculty = null;

	const startNewPage = () => {
		curPage = {
			hasMainHeader: globalPageIsFirst,
			blocks: [],
			faculty: curFaculty,
		};
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
			return (
				rooms.findIndex((r) => r.id === a) - rooms.findIndex((r) => r.id === b)
			);
		});

		// Each faculty section starts on a fresh page; lecture mode keeps one day per page.
		const facultyChanged =
			groupByFaculty && curPage && curPage.faculty !== group.faculty;
		if (!packGroups || !curPage || facultyChanged) {
			curFaculty = group.faculty;
			startNewPage();
		}

		let isFirstChunk = true;
		const pushBlock = (chunkRoomIds, gap) => {
			curPage.blocks.push({
				label: isFirstChunk ? group.label : `${group.label} (cont.)`,
				schedules: group.schedules,
				rooms: chunkRoomIds.map(
					(rid) => roomLookup[rid] || { id: rid, name: rid },
				),
				day: group.day,
				gap,
			});
			curY += gap + BLOCK_HEAD_H + chunkRoomIds.length * ROW_H;
			isFirstChunk = false;
		};

		if (usedRoomIds.length === 0) {
			// Schedules exist but no rooms assigned — render the day header alone.
			let gap = curPage.blocks.length > 0 ? BLOCK_GAP : 0;
			if (gap > 0 && curY + gap + BLOCK_HEAD_H > bottomLimit) {
				startNewPage();
				gap = 0;
			}
			pushBlock([], gap);
			return;
		}

		let i = 0;
		while (i < usedRoomIds.length) {
			const gap = curPage.blocks.length > 0 ? BLOCK_GAP : 0;
			let rowsFit = Math.floor(
				(bottomLimit - (curY + gap) - BLOCK_HEAD_H) / ROW_H,
			);
			if (rowsFit < 1) {
				// No room left on this page; continue on a fresh one (force 1 row if the
				// page is already empty, to guarantee progress).
				if (curPage.blocks.length > 0) {
					startNewPage();
					continue;
				}
				rowsFit = 1;
			}
			const chunk = usedRoomIds.slice(i, i + rowsFit);
			pushBlock(chunk, gap);
			i += chunk.length;
			// Remaining rooms for this same day continue on the next page.
			if (i < usedRoomIds.length) startNewPage();
		}
	});

	// ---- Render each page ----
	pages.forEach((page, pi) => {
		if (pi > 0) pdf.addPage();

		pdf.setFillColor(...pageBg);
		pdf.rect(0, 0, pageW, pageH, "F");

		// ---- Document Header ----
		let curY = margin;

		if (page.hasMainHeader) {
			// Draw Logo
			const logoSize = 18;
			pdf.addImage(
				unilagLogoBase64,
				"PNG",
				pageW / 2 - logoSize / 2,
				curY,
				logoSize,
				logoSize,
			);
			curY += logoSize + 4;

			pdf.setFont("helvetica", "bold");
			pdf.setFontSize(14);
			pdf.setTextColor(...textDark);
			pdf.text((schoolName || "").toUpperCase(), pageW / 2, curY + 6, {
				align: "center",
			});

			pdf.setFont("helvetica", "normal");
			pdf.setFontSize(9);
			pdf.setTextColor(...textMid);
			const metaText = [
				session ? `${session} Session` : null,
				semester,
				faculty,
				department,
			]
				.filter(Boolean)
				.join("   ·   ");
			if (metaText) {
				pdf.text(metaText, pageW / 2, curY + 12, { align: "center" });
			}

			pdf.setFont("helvetica", "bold");
			pdf.setFontSize(11);
			pdf.text((title || "").toUpperCase(), pageW / 2, curY + 19, {
				align: "center",
			});

			curY += 26;
		}

		// ---- Faculty section title band (when grouping by faculty) ----
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

		// ---- Render each stacked day-block on this page ----
		page.blocks.forEach((block, bi) => {
			const pageRooms = block.rooms;
			if (bi > 0) curY += BLOCK_GAP;

			// ---- Grid Strip Header ----
			pdf.setFillColor(...accentBg);
			pdf.roundedRect(margin, curY, pageW - margin * 2, 8, 1.5, 1.5, "F");

			pdf.setFont("helvetica", "bold");
			pdf.setFontSize(8);
			pdf.setTextColor(...accentFg);
			pdf.text(block.label, margin + 4, curY + 5.5);

			curY += 10;

			// ---- Grid measurements ----
			const tableX = margin;
			const tableW = pageW - margin * 2;
			const roomLabelW = 34; // Slightly wider for room names
			const slotW = (tableW - roomLabelW) / SLOTS;

			// ---- Time header row ----
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

			// ---- Room rows ----
			pageRooms.forEach((room, ri) => {
				const rowY = curY + ri * ROW_H;
				const isAlt = ri % 2 === 1;

				pdf.setFillColor(...(isAlt ? rowAlt : white));
				pdf.rect(tableX, rowY, tableW, ROW_H, "F");

				// Room label cell
				pdf.setFont("helvetica", "bold");
				pdf.setFontSize(8); // Adjusted for reduced padding
				pdf.setTextColor(...textDark);

				let roomLabel = room.name || room.id;
				while (
					pdf.getTextWidth(roomLabel) > roomLabelW - 3 &&
					roomLabel.length > 3
				) {
					roomLabel = roomLabel.slice(0, -2) + "…";
				}
				pdf.text(roomLabel, tableX + 2, rowY + ROW_H / 2 + 1.5);

				// ---- Draw Blocked Slots Backgrounds ----
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
							ROW_H,
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
							pdf.rect(bx, rowY, bw, ROW_H, "F");
						}
					}
				});

				pdf.setDrawColor(...gridLine);
				pdf.setLineWidth(0.12);
				pdf.line(tableX, rowY + ROW_H, tableX + tableW, rowY + ROW_H);

				for (let h = 0; h <= SLOTS; h++) {
					const lx = tableX + roomLabelW + h * slotW;
					pdf.line(lx, rowY, lx, rowY + ROW_H);
				}

				// ---- Draw events in this room ----
				const roomSchedules = block.schedules.filter((s) =>
					(s.roomIds || []).includes(room.id),
				);

				// Merge courses sharing the exact same time window into a single item
				// (e.g. several exams in one hall) so every course code is shown.
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

				// Greedy lane assignment: time-overlapping items are stacked into separate
				// horizontal lanes within the row so none are drawn on top of another.
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

				const evH = ROW_H - 1;
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

					// Event background
					pdf.setFillColor(...col.bg);
					pdf.roundedRect(evX, evY, evW, cellH, 0.8, 0.8, "F");

					// Outline instead of top accent
					pdf.setDrawColor(...col.border);
					pdf.setLineWidth(0.2);
					pdf.roundedRect(evX, evY, evW, cellH, 0.8, 0.8, "D");

					// Course code(s) — list every course sharing this slot
					const codeFontSize = Math.min(12, cellH * 1.6, evW / 5);
					if (codeFontSize >= 3) {
						pdf.setFont("helvetica", "bold");
						pdf.setFontSize(codeFontSize);
						pdf.setTextColor(...col.text);

						let codeStr = it.schedules
							.map((x) => x.courseCode || x.courseId)
							.join(", ");
						while (pdf.getTextWidth(codeStr) > evW - 2 && codeStr.length > 2) {
							codeStr = codeStr.slice(0, -2) + "…";
						}
						pdf.text(codeStr, evX + 1.5, evY + cellH / 2, {
							baseline: "middle",
						});
					}
				});
			});

			// Outer box
			const gridH = pageRooms.length * ROW_H;

			// ---- Draw Blocked Slots Overlays (Text) ----
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
							// Avoid drawing text entirely outside visible bounds
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

			// Advance past this block's grid so the next stacked block starts below it.
			curY += gridH;
		});

		// ---- Footer ----
		pdf.setFont("helvetica", "normal");
		pdf.setFontSize(5.5);
		pdf.setTextColor(...textFaint);
		pdf.text("University of Lagos Timetable Manager", margin, pageH - 3);
		pdf.text(`Generated: ${generatedDate}`, pageW / 2, pageH - 3, {
			align: "center",
		});
		pdf.text(`Page ${pi + 1} of ${pages.length}`, pageW - margin, pageH - 3, {
			align: "right",
		});
	});

	const fileName = `${title.replace(/\s+/g, "_").toLowerCase()}_${new Date().toISOString().slice(0, 10)}.pdf`;
	pdf.save(fileName);
}
