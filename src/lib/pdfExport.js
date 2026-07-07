import jsPDF from "jspdf";
import { unilagLogoBase64 } from "@/lib/logo";
import { GENERAL_STUDIES_FACULTY } from "@/lib/utils";

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

	// =========================================================================
	// STRUCTURED A3 LAYOUT
	// =========================================================================
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

		// Helper: draw centered course code list text inside grid cells (A3)
		function drawCenteredText(pdf, lines, x, y, w, h) {
			let fs = 9.0;
			let lineHeight = fs * 0.3528 * 1.3;
			let totalH = lines.length * lineHeight;
			
			const exceedsWidth = () => {
				pdf.setFontSize(fs);
				pdf.setFont("helvetica", "bold");
				for (let line of lines) {
					if (pdf.getTextWidth(line) > w - 1.5) {
						return true;
					}
				}
				return false;
			};

			while ((totalH > h - 1.5 || exceedsWidth()) && fs > 4.5) {
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

		// getMondayOfDate moved to shared top-level helper

		// 1. Gather all unique dates (or legacy days) from schedules
		const uniqueDates = [];
		const STANDARD_SLOTS = [
			{ id: 0, label: "9am - 12pm", start: "09:00", end: "12:00" },
			{ id: 1, label: "12pm - 3pm", start: "12:00", end: "15:00" },
			{ id: 2, label: "3pm - 6pm", start: "15:00", end: "18:00" }
		];

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
			const fac = faculties.find(f => String(f.id) === String(r.faculty_id));
			if (fac) {
				roomFacFaculties: roomFaculties[r.id] = fac.name;
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

		const venueColW = 22;
		const facultyColW = 28;

		// Dynamic row height calculator for A3
		const getA3RoomRowHeight = (room, allSchedules) => {
			const roomSchedules = allSchedules.filter(si => {
				const rids = si.roomIds || (si.roomId ? [si.roomId] : []);
				return rids.includes(room.id);
			});

			const slotGroups = {};
			roomSchedules.forEach(si => {
				const dayOrDate = si.examDate || si.day || "legacy";
				const startMin = timeToMinutes(si.startTime);
				const endMin = timeToMinutes(si.endTime);
				for (let slotIdx = 0; slotIdx < 3; slotIdx++) {
					const slotStartMin = (9 + slotIdx * 3) * 60;
					const slotEndMin = slotStartMin + 3 * 60;
					if (startMin < slotEndMin && slotStartMin < endMin) {
						const key = `${dayOrDate}-${slotIdx}`;
						if (!slotGroups[key]) slotGroups[key] = [];
						slotGroups[key].push(si);
					}
				}
			});

			let maxLinesInAnySlot = 1;
			Object.keys(slotGroups).forEach(key => {
				const sittings = slotGroups[key];
				const sorted = [...sittings].sort((a, b) => {
					const startA = timeToMinutes(a.startTime);
					const startB = timeToMinutes(b.startTime);
					if (startA !== startB) return startA - startB;
					return timeToMinutes(a.endTime) - timeToMinutes(b.endTime);
				});
				const lanes = [];
				sorted.forEach(si => {
					const startMin = timeToMinutes(si.startTime);
					const endMin = timeToMinutes(si.endTime);
					let placed = false;
					for (let i = 0; i < lanes.length; i++) {
						const hasOverlap = lanes[i].some(item => {
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
					if (!placed) {
						lanes.push([si]);
					}
				});
				// Since course codes are displayed on a single line,
				// each lane takes exactly 1 line height.
				maxLinesInAnySlot = Math.max(maxLinesInAnySlot, lanes.length);
			});

			const label = getRoomLabel(room);
			pdfA3.setFont("helvetica", "bold");
			pdfA3.setFontSize(7.5);
			const roomLines = pdfA3.splitTextToSize(label, venueColW - 2);
			const labelLinesCount = Math.max(1, roomLines.length);
			const labelH = 8 + (labelLinesCount - 1) * 3.6;

			const eventsH = maxLinesInAnySlot * 6.0 + 3.0;
			return Math.max(12, labelH, eventsH);
		};

		// 3. Dynamic row slicing per faculty (separating faculties on new pages)
		const rowChunks = [];
		sortedFacultyNames.forEach(facName => {
			const facRooms = facultyGroups[facName];
			const facRows = facRooms.map((room) => ({
				room,
				facultyName: facName
			}));

			let i = 0;
			while (i < facRows.length) {
				let currentChunkHeight = 0;
				let chunk = [];
				let j = i;
				while (j < facRows.length) {
					const rowH = getA3RoomRowHeight(facRows[j].room, schedules);
					// Maximum vertical space for rows on A3 paper is approx 230mm
					if (chunk.length > 0 && currentChunkHeight + rowH > 230) {
						break;
					}
					chunk.push(facRows[j]);
					currentChunkHeight += rowH;
					j++;
				}
				if (chunk.length === 0 && j < facRows.length) {
					chunk.push(facRows[j]);
					j++;
				}
				rowChunks.push(chunk);
				i = j;
			}
		});

		const daysPerPage = 6;
		const dayChunks = [];
		for (let i = 0; i < uniqueDates.length; i += daysPerPage) {
			dayChunks.push(uniqueDates.slice(i, i + daysPerPage));
		}

		let pageIdx = 0;
		dayChunks.forEach((dayChunk, dayChunkIdx) => {
			rowChunks.forEach((rowChunk, rowChunkIdx) => {
				const roomsInChunk = rowChunk.map(r => r.room.id);
				const hasSchedulesInChunk = schedules.some(si => {
					const rids = si.roomIds || (si.roomId ? [si.roomId] : []);
					const matchesRoom = rids.some(id => roomsInChunk.includes(id));
					if (!matchesRoom) return false;

					return dayChunk.some(dayVal => {
						if (mode === "exam" && !dayVal.startsWith("legacy:")) {
							return si.examDate === dayVal;
						} else {
							const targetDay = dayVal.replace("legacy:", "");
							return si.day === targetDay;
						}
					});
				});

				if (!hasSchedulesInChunk) return;
				// Skip printing the page if there are no schedules for the rooms and days on this page
				const pageRoomIds = rowChunk.map(r => r.room.id);
				const hasAnySchedules = schedules.some(si => {
					const rids = si.roomIds || (si.roomId ? [si.roomId] : []);
					const matchesRoom = rids.some(rid => pageRoomIds.includes(rid));
					if (!matchesRoom) return false;

					if (mode === "exam") {
						return dayChunk.includes(si.examDate);
					} else {
						return dayChunk.includes(si.day);
					}
				});

				if (!hasAnySchedules) {
					return;
				}

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
				const maxSubW = a3W / 2 - (m + logoSize + 8); // ~174mm max width
				const subLines = pdfA3.splitTextToSize(sub, maxSubW);
				subLines.forEach((line, idx) => {
					pdfA3.text(line, m + logoSize + 4, y + 12 + idx * 4.5);
				});

				// WEEK label at the center
				const weekLabel = `WEEK ${dayChunkIdx + 1}`;
				pdfA3.setFont("helvetica", "bold");
				pdfA3.setFontSize(14);
				pdfA3.setTextColor(15, 23, 42);
				pdfA3.text(weekLabel, a3W / 2, y + 8, { align: "center" });

				const timetableTitle = getTimetableTypeLabel(title, faculty, department);
				pdfA3.setFont("helvetica", "bold");
				pdfA3.setFontSize(14);
				pdfA3.setTextColor(15, 23, 42);
				const maxTitleW = a3W / 2 - m - 20; // ~178mm max width
				const titleLines = pdfA3.splitTextToSize(timetableTitle.toUpperCase(), maxTitleW);
				titleLines.forEach((line, idx) => {
					pdfA3.text(line, a3W - m, y + 5 + idx * 5.5, { align: "right" });
				});

				const docStatus = isLocked ? "FINAL TIMETABLE" : "DRAFT TIMETABLE";
				pdfA3.setFontSize(10);
				pdfA3.setFont("helvetica", "bold");
				pdfA3.setTextColor(...(isLocked ? [16, 185, 129] : [245, 158, 11]));
				pdfA3.text(docStatus, a3W - m, y + 12 + (titleLines.length - 1) * 5.5, { align: "right" });

				// Render Grid Table
				const tableStartY = 34;
				const tableW = a3W - 2 * m; // 396
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
				const pageBlockedCols = new Map(); // tracks column block overlays to draw at the end

				pageRows.forEach((r, rIdx) => {
					const rowH = getA3RoomRowHeight(r.room, schedules);

					pdfA3.setDrawColor(71, 85, 105);
					pdfA3.setLineWidth(0.2);

					// Draw Room Cell
					pdfA3.setFillColor(255, 255, 255);
					pdfA3.rect(m, rowY, venueColW, rowH, "F");
					pdfA3.rect(m, rowY, venueColW, rowH, "D");

					pdfA3.setFont("helvetica", "bold");
					pdfA3.setFontSize(7.5);
					pdfA3.setTextColor(15, 23, 42);

					const roomLabel = getRoomLabel(r.room);
					const roomLines = pdfA3.splitTextToSize(roomLabel, venueColW - 2);
					const rLineSpacing = 3.6;
					const rStartY = rowY + (rowH - (roomLines.length - 1) * rLineSpacing) / 2 + 1;
					roomLines.forEach((line, index) => {
						pdfA3.text(line, m + venueColW / 2, rStartY + index * rLineSpacing, { align: "center" });
					});

					// Draw Faculty Cell (merged vertically)
					if (r.isFirstInPageBlock) {
						let spanH = 0;
						for (let k = rIdx; k < rIdx + r.pageBlockLength; k++) {
							spanH += getA3RoomRowHeight(pageRows[k].room, schedules);
						}
						pdfA3.setDrawColor(71, 85, 105);
						pdfA3.setLineWidth(0.2);
						pdfA3.setFillColor(255, 255, 255);
						pdfA3.rect(m + venueColW, rowY, facultyColW, spanH, "F");
						pdfA3.rect(m + venueColW, rowY, facultyColW, spanH, "D");

						const fSize = 8;
						pdfA3.setFont("helvetica", "bold");
						pdfA3.setFontSize(fSize);
						pdfA3.setTextColor(71, 85, 105);

						const facNameUpper = r.facultyName.toUpperCase();
						const maxWidth = Math.max(10, spanH - 6);
						const lines = wrapTextWithHyphens(pdfA3, facNameUpper, maxWidth);
						const lineSpacing = 3.6;
						const charHeight = fSize * 0.3528 * 0.7;
						const xCenter = m + venueColW + facultyColW / 2;
						const yCenter = rowY + spanH / 2;

						lines.forEach((line, index) => {
							const textWidth = pdfA3.getTextWidth(line);
							const lineX = xCenter - ((lines.length - 1) * lineSpacing) / 2 + index * lineSpacing;
							const lineY = yCenter + textWidth / 2;
							pdfA3.text(line, lineX + charHeight / 2, lineY, {
								align: "left",
								angle: 90
							});
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
								const endMin = timeToMinutes(si.endTime);
								const slotStartMin = (9 + sIdx * 3) * 60;
								const slotEndMin = slotStartMin + 3 * 60;
								return startMin < slotEndMin && slotStartMin < endMin;
							});

							pdfA3.setDrawColor(71, 85, 105);
							pdfA3.setLineWidth(0.2);
							pdfA3.setFillColor(255, 255, 255);
							pdfA3.rect(cellX, rowY, slotWidth, rowH, "F");
							pdfA3.rect(cellX, rowY, slotWidth, rowH, "D");

							// Draw two very faint vertical guidelines to divide the 3-hour timeslot into 1-hour intervals
							pdfA3.setDrawColor(226, 232, 240); // slate-200 (very faint)
							pdfA3.setLineWidth(0.08);
							pdfA3.line(cellX + slotWidth / 3, rowY, cellX + slotWidth / 3, rowY + rowH);
							pdfA3.line(cellX + 2 * slotWidth / 3, rowY, cellX + 2 * slotWidth / 3, rowY + rowH);
							pdfA3.setDrawColor(71, 85, 105); // restore default grid line color
							pdfA3.setLineWidth(0.2); // restore default line width

							if (cellSchedules.length > 0) {
								const sortedSchedules = [...cellSchedules].sort((a, b) => {
									const startA = timeToMinutes(a.startTime);
									const startB = timeToMinutes(b.startTime);
									if (startA !== startB) return startA - startB;
									return timeToMinutes(a.endTime) - timeToMinutes(b.endTime);
								});

								const lanes = [];
								sortedSchedules.forEach(si => {
									const startMin = timeToMinutes(si.startTime);
									const endMin = timeToMinutes(si.endTime);
									let placed = false;
									for (let i = 0; i < lanes.length; i++) {
										const hasOverlap = lanes[i].some(item => {
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
									if (!placed) {
										lanes.push([si]);
									}
								});

								const numLanes = lanes.length;
								const laneH = rowH / numLanes;
								const slotStartHour = 9 + sIdx * 3;

								lanes.forEach((laneSchedules, laneIdx) => {
									const laneY = rowY + laneIdx * laneH;
									laneSchedules.forEach(si => {
										const startHour = timeToMinutes(si.startTime) / 60.0;
										const endHour = timeToMinutes(si.endTime) / 60.0;

										let relStart = (startHour - slotStartHour) / 3.0;
										let relEnd = (endHour - slotStartHour) / 3.0;
										relStart = Math.max(0.0, Math.min(1.0, relStart));
										relEnd = Math.max(0.0, Math.min(1.0, relEnd));

										const itemX = cellX + relStart * slotWidth;
										const itemW = (relEnd - relStart) * slotWidth;
										const code = si.courseCode || si.courseId || "N/A";
										const cleanCode = code.split(/[,/]+/).map(p => p.trim()).filter(Boolean).join(" / ");
										const parts = [cleanCode];

										// Custom inline drawing with card color mapping
										let fs = 7.8;
										let lineHeight = fs * 0.3528 * 1.3;
										let totalH = parts.length * lineHeight;

										// Compute card height and vertical center alignment in the lane
										const standardCardH = 5.2;
										let cardH = Math.min(laneH - 0.8, standardCardH);
										
										// If there are multiple lines that require more space, expand if laneH permits
										const requiredH = totalH + 1.2;
										if (requiredH > cardH && requiredH <= laneH - 0.6) {
											cardH = requiredH;
										}

										// Center the card vertically inside the lane bounds
										const cardY = laneY + (laneH - cardH) / 2;

										// Draw rounded rectangle card with light background and outline
										const isMono = monochrome || false;
										const bgCol = isMono ? [249, 250, 251] : [239, 246, 255];
										const borderCol = isMono ? [209, 213, 219] : [191, 219, 254];
										const textCol = isMono ? [75, 85, 99] : [29, 78, 216];

										pdfA3.setFillColor(...bgCol);
										pdfA3.roundedRect(itemX + 0.6, cardY, itemW - 1.2, cardH, 0.6, 0.6, "F");

										pdfA3.setDrawColor(...borderCol);
										pdfA3.setLineWidth(0.12);
										pdfA3.roundedRect(itemX + 0.6, cardY, itemW - 1.2, cardH, 0.6, 0.6, "D");

										const exceedsWidth = () => {
											pdfA3.setFontSize(fs);
											pdfA3.setFont("helvetica", "bold");
											for (let line of parts) {
												if (pdfA3.getTextWidth(line) > itemW - 1.5) {
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

										pdfA3.setFontSize(fs);
										pdfA3.setFont("helvetica", "bold");
										pdfA3.setTextColor(...textCol);
										
										const startY = cardY + cardH / 2 - totalH / 2 + (fs * 0.3528 * 0.85);
										parts.forEach((line, idx) => {
											pdfA3.text(line, itemX + itemW / 2, startY + idx * lineHeight, { align: "center" });
										});
									});
								});
							}
						});
					});

					rowY += rowH;
				});

				// Render Blocked Column Overlays (General Events)
				const totalGridHeight = pageRows.reduce((sum, r) => sum + getA3RoomRowHeight(r.room, schedules), 0);
				pageBlockedCols.forEach((colInfo) => {
					const { x, width, name } = colInfo;
					const gridStartY = tableStartY + 14;

					pdfA3.setDrawColor(71, 85, 105);
					pdfA3.setLineWidth(0.2);
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

		const fname = getExportFileName(title, session, semester, faculty, department, "a3");
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
		const sub = [`${session} Session`, semester, faculty, department].filter(Boolean).join("   ·   ");
		const maxSubW = pageW / 2 - (margin + logoSize + 6); // ~108mm max width
		const subLines = pdf.splitTextToSize(sub, maxSubW);
		subLines.forEach((line, idx) => {
			pdf.text(line, margin + logoSize + 3, y + 10 + idx * 3.5);
		});

		// Week label in the center
		pdf.setFont("helvetica", "bold");
		pdf.setFontSize(12);
		pdf.setTextColor(...textDark);
		
		let pageWeekNum = 1;
		if (mode === "exam" && page.blocks.length > 0 && page.blocks[0].day && page.blocks[0].day.includes("-")) {
			const examDates = schedules.map(s => s.examDate).filter(d => d && d !== "TBD" && !d.startsWith("legacy:") && d.includes("-"));
			if (examDates.length > 0) {
				const sortedDates = [...new Set(examDates)].sort();
				pageWeekNum = getWeekNumberForDate(page.blocks[0].day, sortedDates[0]);
			}
		}
		const weekLabel = `WEEK ${pageWeekNum}`;
		pdf.text(weekLabel, pageW / 2, y + 6, { align: "center" });

		// Timetable title on the right
		const timetableTitle = getTimetableTypeLabel(title, faculty, department);
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
		pdf.text(`Generated: ${generatedDate}`, pageW / 2, pageH - 3, {
			align: "center",
		});
		pdf.text(`Page ${pi + 1} of ${pages.length}`, pageW - margin, pageH - 3, {
			align: "right",
		});
	});

	const fileName = getExportFileName(title, session, semester, faculty, department, "a4");
	pdf.save(fileName);
}
