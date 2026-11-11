// Timetable exports for signed-in staff, built on the frontend server
// (src/app/api/export/staff/route.js) so the page never does the work.
//
// 1. Ask the API for an export ticket (the login cookie goes to the API only).
// 2. Ask this site's server for the file, with the ticket.
// 3. Save what comes back.
import { apiClient } from "./apiClient.js";

function saveFile(blob, fileName) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = fileName;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const isAll = (v) => v === undefined || v === null || v === "" || v === "ALL";

/** The query /api/export/staff reads (src/lib/exportRequest.js). */
function exportQuery(semesterId, kind, o) {
	const q = new URLSearchParams({ semester: String(semesterId), type: kind });
	if (!isAll(o.facultyId)) q.set("faculty", String(o.facultyId));
	if (!isAll(o.departmentId)) q.set("department", String(o.departmentId));
	if (!isAll(o.level)) q.set("level", String(o.level));
	if (o.format) q.set("format", o.format);
	if (o.paperSize) q.set("paper", o.paperSize);
	if (o.layout) q.set("layout", o.layout);
	if (o.monochrome) q.set("mono", "1");
	if (o.gstOnly) q.set("gst", "1");
	if (o.cbtOnly) q.set("cbt", "1");
	return q;
}

/**
 * Download a timetable. `kind` is "lecture", "exam" or "cbt"; the options are
 * facultyId, departmentId, level, format, paperSize, layout, monochrome, and
 * for exams gstOnly and cbtOnly.
 *
 * @returns the success message to show
 * @throws Error with a message fit to show the user
 */
export async function downloadTimetable({ semesterId, kind, ...options }) {
	const { ticket } = await apiClient.post("/export/ticket", {
		semester_id: Number(semesterId),
		// CBT timetables are exam timetables (EXPORT_KINDS in exportJob.js, kept
		// out of this file so the PDF code never ships to the browser).
		timetable_type: kind === "lecture" ? "lecture" : "exam",
	});
	let response;
	try {
		response = await fetch(`/api/export/staff?${exportQuery(semesterId, kind, options)}`, {
			headers: { "X-Export-Ticket": ticket },
			cache: "no-store",
		});
	} catch {
		throw new Error("The export couldn't reach the server. Check your connection and try again.");
	}
	if (!response.ok) {
		const detail = await response.json().then((b) => b?.detail).catch(() => null);
		throw new Error(detail || "The timetable couldn't be exported. Try again.");
	}
	const fileName = decodeURIComponent(response.headers.get("X-Export-File-Name") || "timetable");
	saveFile(await response.blob(), fileName);
	return decodeURIComponent(response.headers.get("X-Export-Message") || "Timetable downloaded.");
}

/**
 * Download the index of faculties for a session and semester: one PDF linking
 * every faculty's FINAL timetable, across programmes. `type` is "lecture" or
 * "exam" (CBT is listed in the exam index). Staff only.
 *
 * @returns the success message to show
 * @throws Error with a message fit to show the user
 */
export async function downloadFacultyIndex({ semesterId, type, session, semester }) {
	const { ticket } = await apiClient.post("/export/ticket", {
		semester_id: Number(semesterId),
		timetable_type: type,
	});
	const q = new URLSearchParams({ semester: String(semesterId), type, session, name: semester });
	let response;
	try {
		response = await fetch(`/api/export/staff/index?${q}`, {
			headers: { "X-Export-Ticket": ticket },
			cache: "no-store",
		});
	} catch {
		throw new Error("The index couldn't reach the server. Check your connection and try again.");
	}
	if (!response.ok) {
		const detail = await response.json().then((b) => b?.detail).catch(() => null);
		throw new Error(detail || "The index couldn't be built. Try again.");
	}
	const fileName = decodeURIComponent(response.headers.get("X-Export-File-Name") || "timetable_index.pdf");
	saveFile(await response.blob(), fileName);
	return `The ${session} ${semester} index of faculties was downloaded.`;
}
