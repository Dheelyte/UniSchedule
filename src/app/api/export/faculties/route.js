// The index of faculties: GET /api/export/faculties?session=2026/2027&semester=First Semester&type=lecture
//
// One PDF listing every faculty and unit of every programme (Undergraduate,
// then ICE, ...) whose timetable for that session, semester and type is FINAL.
// Each faculty with a timetable links to /api/export for just that faculty;
// the others are marked not published. Exam indexes also link the CBT timetable.
import { getPublic, fileResponse, problem } from "@/lib/exportServer";
import { buildIndexPDF, orderFaculties } from "@/lib/pdfIndex";

export const runtime = "nodejs";
export const maxDuration = 30;

const TYPE_TITLE = { lecture: "Lecture Timetable", exam: "Examination Timetable" };

export async function GET(request) {
	const params = request.nextUrl.searchParams;
	const session = params.get("session");
	const semester = params.get("semester");
	const type = params.get("type");
	if (!session || !semester) return problem("Choose a session and semester.", 400);
	if (!TYPE_TITLE[type]) return problem("Choose lecture or exam.", 400);

	const origin = request.nextUrl.origin;
	let published;
	try {
		published = (await getPublic("/public/timetables")) || [];
	} catch {
		return problem("The timetables couldn't be loaded. Try again shortly.", 502);
	}
	const entries = published.filter(
		(t) => t.session_name === session && t.semester_name === semester && t.timetable_type === type,
	);
	if (!entries.length) return problem("No timetable has been published for that session yet.", 404);

	const sections = [];
	try {
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
	} catch {
		return problem("The timetables couldn't be loaded. Try again shortly.", 502);
	}
	if (!sections.length) return problem("No timetable has been published for that session yet.", 404);

	const title = `${session} ${semester} ${TYPE_TITLE[type]}`;
	const pdf = buildIndexPDF({ title, sections, siteUrl: origin });
	return fileResponse({ data: pdf.output("arraybuffer"), contentType: "application/pdf", fileName: pdf.fileName });
}
