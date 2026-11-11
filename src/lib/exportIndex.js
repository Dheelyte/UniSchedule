// The index of faculties: one PDF for a session, semester and timetable type
// listing every faculty and unit of every programme (Undergraduate, then ICE,
// ...) whose timetable is FINAL. Each faculty with a timetable links to the
// public download of just that faculty; the others are marked not published.
// Exam indexes also link the CBT timetable.
//
// Staff only (src/app/api/export/staff/index/route.js): the public download
// page offers single timetables, not the index.
import { getPublic, getPublished } from "./exportServer.js";
import { buildIndexPDF, orderFaculties } from "./pdfIndex.js";

export const INDEX_TYPE_TITLE = { lecture: "Lecture Timetable", exam: "Examination Timetable" };

/**
 * @param origin  this site's address, for the links inside the PDF
 * @returns the jsPDF document (with `fileName`), or null when nothing is FINAL
 * @throws when the published timetables can't be read
 */
export async function buildFacultyIndex({ session, semester, type, origin }) {
	const published = (await getPublished()) || [];
	const entries = published.filter(
		(t) => t.session_name === session && t.semester_name === semester && t.timetable_type === type,
	);

	const sections = [];
	for (const entry of entries) {
		const base = `/public/timetables/${encodeURIComponent(entry.realm_key)}/${entry.semester_id}`;
		const options = await getPublic(`${base}/${type}/options`);
		if (!options) continue;
		const linkFor = (kind, facultyId) => {
			const q = new URLSearchParams({ realm: entry.realm_key, semester: String(entry.semester_id), type: kind });
			if (facultyId) q.set("faculty", facultyId);
			if (entry.code) q.set("code", entry.code);
			return `${origin}/api/export?${q}`;
		};
		const withTimetable = new Set(options.faculties.map((f) => f.id));
		const rows = orderFaculties(options.all_faculties).map((f) => ({
			label: f.label,
			url: withTimetable.has(f.id) ? linkFor(type, f.id) : null,
		}));
		if (type === "exam") {
			const cbt = await getPublic(`${base}/cbt/options`).catch(() => null);
			rows.push({ label: "CBT examinations (all faculties)", url: cbt?.faculties?.length ? linkFor("cbt") : null });
		}
		sections.push({
			heading: `${entry.realm_name} Programme`,
			allUrl: linkFor(type),
			code: entry.code,
			verifyUrl: entry.code ? `${origin}/verify/${entry.code}` : null,
			rows,
		});
	}
	if (!sections.length) return null;

	return buildIndexPDF({ title: `${session} ${semester} ${INDEX_TYPE_TITLE[type]}`, sections, siteUrl: origin });
}
