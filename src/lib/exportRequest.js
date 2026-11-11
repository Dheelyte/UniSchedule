// The query of a timetable export (public /api/export and staff
// /api/export/staff): which timetable, which filters, which file.
//
//   realm (public only), semester (id), type (lecture | exam | cbt)  required
//   faculty, department, level                                       optional filters
//   format (pdf | csv), paper (a3 | a4), layout (lecture: standard |
//   daily-hourly | daily-ice-30), mono (1), gst and cbt (exam: 1)    optional
//   code   public only: the verification code the page saw
//
// Public downloads (`publicCopy`) take no file options: they are always a PDF
// on A3, the whole week, in black and white. Those parameters are ignored, and
// the canonical URL leaves them out, so an old link redirects to the one file.
import { EXPORT_KINDS, ExportError } from "./exportJob.js";
import { DAILY_EXPORT_FORMATS } from "./timetableLayout.js";

const ALL = (v) => v === null || v === "" || v === "ALL";

/**
 * Read and check an export request's query. Anything unknown or malformed is an
 * ExportError (a 400), before any data is read.
 *
 * @param realm       true when the query must name the realm (public downloads);
 *                    staff exports work in the realm their ticket names.
 * @param publicCopy  the public download: fixed file options (see above).
 */
export function readExportRequest(params, { realm: needRealm = false, publicCopy = false } = {}) {
	const realm = needRealm ? (params.get("realm") || "").toUpperCase() : null;
	const semesterId = Number(params.get("semester"));
	const kind = params.get("type");
	if (needRealm && !/^[A-Z][A-Z0-9_]{0,31}$/.test(realm)) throw new ExportError("Choose a programme.");
	if (!Number.isInteger(semesterId) || semesterId <= 0) throw new ExportError("Choose a semester.");
	if (!EXPORT_KINDS[kind]) throw new ExportError("Choose lecture, exam or CBT.");

	if (publicCopy) {
		// Only which timetable and which filters; the rest is fixed.
		params = new URLSearchParams(
			[...params].filter(([k]) => !["format", "paper", "layout", "mono", "gst", "cbt"].includes(k)),
		);
	}
	const format = params.get("format") || "pdf";
	if (!["pdf", "csv"].includes(format)) throw new ExportError("Format must be PDF or CSV.");
	const paperSize = params.get("paper") || EXPORT_KINDS[kind].defaultPaper;
	if (!["a3", "a4"].includes(paperSize)) throw new ExportError("Paper must be A3 or A4.");
	const layout = params.get("layout") || "standard";
	if (layout !== "standard" && !(kind === "lecture" && DAILY_EXPORT_FORMATS[layout])) {
		throw new ExportError("That layout isn't available.");
	}

	const faculty = params.get("faculty");
	const department = params.get("department");
	const level = params.get("level");
	if (!ALL(faculty) && !/^[\w-]{1,64}$/.test(faculty)) throw new ExportError("Unknown faculty.");
	if (!ALL(department) && !/^\d+$/.test(department)) throw new ExportError("Unknown department.");
	if (!ALL(level) && !/^\d+$/.test(level)) throw new ExportError("Unknown level.");

	return {
		publicCopy,
		realm,
		semesterId,
		code: params.get("code") || null,
		options: {
			kind,
			facultyId: ALL(faculty) ? "ALL" : faculty,
			departmentId: ALL(department) ? "ALL" : department,
			level: ALL(level) ? "ALL" : level,
			format,
			paperSize,
			layout,
			monochrome: publicCopy || params.get("mono") === "1",
			gstOnly: kind === "exam" && params.get("gst") === "1",
			cbtOnly: kind === "exam" && params.get("cbt") === "1",
		},
	};
}

/**
 * The one URL for a set of choices: known parameters only, in a fixed order,
 * defaults left out. Downloads are cached by URL, so without this every
 * spelling of the same request (or junk added to it) would be rendered again.
 */
export function canonicalQuery(req) {
	const o = req.options;
	const q = new URLSearchParams();
	if (req.realm) q.set("realm", req.realm);
	q.set("semester", String(req.semesterId));
	q.set("type", o.kind);
	if (o.facultyId !== "ALL") q.set("faculty", o.facultyId);
	if (o.departmentId !== "ALL") q.set("department", o.departmentId);
	if (o.level !== "ALL") q.set("level", o.level);
	if (o.format !== "pdf") q.set("format", o.format);
	if (o.format === "pdf") {
		if (o.paperSize !== EXPORT_KINDS[o.kind].defaultPaper) q.set("paper", o.paperSize);
		if (o.layout !== "standard") q.set("layout", o.layout);
		if (o.monochrome && !req.publicCopy) q.set("mono", "1");
	}
	if (o.gstOnly) q.set("gst", "1");
	if (o.cbtOnly) q.set("cbt", "1");
	if (req.code) q.set("code", req.code);
	return q.toString();
}
