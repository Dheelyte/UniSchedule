// One timetable export (PDF or CSV) built from an export bundle
// (GET /export/bundle, or /public/export/bundle for FINAL timetables).
//
// The same code runs in three places:
// - in a Web Worker for signed-in staff (src/lib/exportClient.js), so a big
//   PDF never freezes the page;
// - on the frontend server for public downloads (src/app/api/export/route.js);
// - in `node --test`.
// So it uses relative imports only and never touches the DOM.
import QRCode from "qrcode";
import { toScheduleItem, buildSchedulesWithDetails, filterSchedulesForExport } from "./exportFilters.js";
import { exportTimetablePDF } from "./pdfExport.js";
import { exportDailyTimetablePDF } from "./pdfExportDaily.js";
import { buildTimetableCSV } from "./csvExport.js";
import { isSigned, verifyUrl } from "./pdfSignoff.js";
import { isRoomActive } from "./utils.js";

/** What can be exported: CBT timetables are exam timetables, limited to CBT courses. */
export const EXPORT_KINDS = {
	lecture: { timetableType: "lecture", defaultPaper: "a3" },
	exam: { timetableType: "exam", defaultPaper: "a3" },
	cbt: { timetableType: "exam", defaultPaper: "a3" },
};

/** A problem with the request itself (shown to the user as is), not a crash. */
export class ExportError extends Error {
	constructor(message, status = 400) {
		super(message);
		this.name = "ExportError";
		this.status = status;
	}
}

/** The bundle in the shapes the app state uses (see AppContext's refreshMetadata). */
export function bundleToState(bundle) {
	return {
		courses: (bundle.courses || []).map((c) => ({
			...c,
			creditLoad: c.credit_load,
			departmentId: c.department_id,
			scope: c.scope || "DEPARTMENTAL",
			isCbtExam: c.is_cbt_exam || false,
		})),
		faculties: bundle.faculties || [],
		departments: (bundle.departments || []).map((d) => ({ ...d, facultyId: d.faculty_id })),
		rooms: (bundle.rooms || []).map((r) => ({
			...r,
			facultyId: r.faculty_id ?? null,
			isLab: r.is_lab ?? false,
			isActive: r.is_active !== false,
			activeSeats: r.active_seats ?? 0,
			inactiveSeats: r.inactive_seats ?? 0,
		})),
		enrollments: bundle.enrollments || [],
	};
}

/**
 * The QR code printed on a FINAL (signed) export, as a PNG data URL. Null for a
 * draft. Made outside the worker: the browser build of `qrcode` needs a canvas.
 */
export async function signoffQrDataUrl(signoff) {
	if (!isSigned(signoff)) return null;
	return QRCode.toDataURL(verifyUrl(signoff.verification.code), {
		margin: 0,
		errorCorrectionLevel: "M",
		width: 256,
		color: { dark: "#0f172a", light: "#ffffff" },
	});
}

const isAll = (v) => v === undefined || v === null || v === "" || v === "ALL";

/**
 * Build one export.
 *
 * @param bundle   an export bundle
 * @param options  kind ("lecture" | "exam" | "cbt"), facultyId, departmentId,
 *                 level, format ("pdf" | "csv"), layout (lecture only:
 *                 "standard" or a daily layout), paperSize ("a3" | "a4"),
 *                 monochrome, gstOnly and cbtOnly (exam only), qrDataUrl
 *                 (from signoffQrDataUrl).
 * @returns {{ fileName: string, contentType: string, data: ArrayBuffer | string, message: string }}
 * @throws ExportError when nothing matches the filters
 */
export function buildExport(bundle, options = {}) {
	const kind = options.kind || "lecture";
	const spec = EXPORT_KINDS[kind];
	if (!spec) throw new ExportError(`Unknown timetable: ${kind}`);
	const {
		facultyId = "ALL",
		departmentId = "ALL",
		level = "ALL",
		format = "pdf",
		layout = "standard",
		paperSize = spec.defaultPaper,
		monochrome = false,
		qrDataUrl = null,
	} = options;
	const gstOnly = kind === "exam" && !!options.gstOnly;
	const cbtOnly = kind === "cbt" || (kind === "exam" && !!options.cbtOnly);

	const state = bundleToState(bundle);
	const schedules = buildSchedulesWithDetails((bundle.schedule_items || []).map(toScheduleItem), state)
		.filter((s) => s.type === spec.timetableType);

	const enrollmentsByCourse = new Map();
	state.enrollments.forEach((e) => {
		if (!enrollmentsByCourse.has(e.course_id)) enrollmentsByCourse.set(e.course_id, []);
		enrollmentsByCourse.get(e.course_id).push(e);
	});

	const filtered = filterSchedulesForExport(schedules, {
		facultyId,
		departmentId,
		level,
		gstOnly,
		cbtOnly,
		faculties: state.faculties,
		departments: state.departments,
		courses: state.courses,
		enrollmentsByCourse,
	});
	// CBT exports have always kept rooms that are switched off.
	const activeRoomIds = new Set(state.rooms.filter(isRoomActive).map((room) => room.id));
	const exportable = kind === "cbt"
		? filtered
		: filtered.filter((s) => s.is_online || s.isOnline || (s.roomIds || []).some((rid) => activeRoomIds.has(rid)));
	if (exportable.length === 0) throw new ExportError("No schedules found for the selected filters.", 404);

	const deptIdNum = isAll(departmentId) ? null : Number(departmentId);
	const levelNum = isAll(level) ? null : Number(level);
	const facultyInfo = isAll(facultyId)
		? "All Faculties"
		: state.faculties.find((f) => f.id === facultyId)?.name || "Unknown Faculty";
	const departmentInfo = deptIdNum === null
		? null
		: state.departments.find((d) => d.id === deptIdNum)?.name || "Unknown Department";
	const levelInfo = levelNum === null ? null : `Level ${levelNum}`;
	// Every faculty: grouped by faculty, General Studies first.
	const groupByFaculty = isAll(facultyId);

	const title = kind === "lecture"
		? "Lecture Timetable"
		: kind === "cbt" || cbtOnly
			? "CBT Examination Timetable"
			: gstOnly ? "General Studies Examination Timetable" : "Examination Timetable";
	const mode = kind === "lecture" ? "lecture" : "exam";
	const realm = bundle.realm || {};
	const common = {
		session: bundle.session_name,
		semester: bundle.semester_name,
		faculty: facultyInfo,
		department: departmentInfo,
		config: realm.config,
		realmKey: realm.key,
		realmName: realm.name,
	};
	const label = kind === "lecture" ? "Lecture" : kind === "cbt" ? "CBT" : "Exam";

	if (format === "csv") {
		// The CSV lists every matching item, rooms switched off included.
		const csv = buildTimetableCSV({ ...common, schedules: filtered, title: kind === "exam" ? "Examination Timetable" : title, mode, groupByFaculty });
		return { fileName: csv.fileName, contentType: "text/csv; charset=utf-8", data: csv.content, message: `${label} timetable downloaded as CSV.` };
	}

	const signoff = isSigned(bundle.signoff) && qrDataUrl ? { ...bundle.signoff, qr_data_url: qrDataUrl } : null;
	const rooms = cbtOnly ? state.rooms.filter((r) => r.name?.toUpperCase().includes("CBT")) : state.rooms;
	const pdfOptions = {
		...common,
		schedules: exportable,
		blockedSlots: bundle.blocked_slots || [],
		rooms,
		faculties: state.faculties,
		departments: state.departments,
		enrollments: state.enrollments,
		title,
		level: levelInfo,
		schoolName: "University of Lagos",
		monochrome,
		groupByFaculty,
		isLocked: !!bundle.is_locked,
		signoff,
		save: false,
	};

	let pdf;
	let message;
	if (kind === "lecture" && layout && layout !== "standard") {
		pdf = exportDailyTimetablePDF({ ...pdfOptions, paperSize, layout });
		message = `Daily lecture timetable downloaded as PDF (${paperSize.toUpperCase()}, 1 day per page).`;
	} else if (paperSize === "a3") {
		pdf = exportTimetablePDF({ ...pdfOptions, mode, gstOnly, paperSize: "a3", structured: true });
		message = kind === "lecture"
			? "Lecture timetable downloaded as PDF (A3)."
			: `${label} timetable downloaded (A3 structured).`;
	} else {
		pdf = exportTimetablePDF({ ...pdfOptions, mode, gstOnly, paperSize: "a4", structured: false });
		message = `${label} timetable downloaded as PDF${kind === "lecture" ? " (A4)" : ""}.`;
	}
	if (!pdf) throw new ExportError("No schedules found for the selected filters.", 404);
	return { fileName: pdf.fileName, contentType: "application/pdf", data: pdf.output("arraybuffer"), message };
}
