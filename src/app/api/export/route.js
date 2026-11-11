// Public timetable downloads: GET /api/export?realm=UG&semester=3&type=lecture&...
//
// Renders a FINAL (locked, signed) timetable with the same code staff exports
// use (src/lib/exportJob.js) and returns the PDF or CSV. Drafts are not
// available here; the backend's public bundle refuses them.
//
// Always a PDF on A3, the whole week, in black and white: the public page
// offers no file options. The query is read by src/lib/exportRequest.js. `code` is the verification
// code the page saw; if a newer FINAL version has been issued since, the
// request is redirected to it.
import { buildExport, EXPORT_KINDS, ExportError, signoffQrDataUrl } from "@/lib/exportJob";
import { canonicalQuery, readExportRequest } from "@/lib/exportRequest";
import { fileResponse, getOptions, getPublic, problem } from "@/lib/exportServer";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request) {
	let req;
	try {
		req = readExportRequest(request.nextUrl.searchParams, { realm: true, publicCopy: true });
	} catch (error) {
		return problem(error.message, 400);
	}
	const canonical = canonicalQuery(req);
	if (request.nextUrl.search.replace(/^\?/, "") !== canonical) {
		const next = new URL(request.nextUrl);
		next.search = canonical;
		return new Response(null, { status: 308, headers: { Location: next.toString(), "Cache-Control": "public, s-maxage=86400" } });
	}

	// Check the filters against the published timetable's choices first: the
	// options are small and cached, so a made-up faculty, department or level is
	// refused without the timetable itself being read.
	const o = req.options;
	let options;
	try {
		options = await getOptions(req.realm, req.semesterId, o.kind);
	} catch {
		return problem("The timetable couldn't be loaded. Try again shortly.", 502);
	}
	if (!options) return problem("This timetable hasn't been published yet.", 404);
	if (o.facultyId !== "ALL" && !options.faculties.some((f) => f.id === o.facultyId)) {
		return problem("That faculty has nothing in this timetable.", 404);
	}
	if (o.departmentId !== "ALL" && !options.departments.some((d) => String(d.id) === o.departmentId)) {
		return problem("That department has nothing in this timetable.", 404);
	}
	if (o.level !== "ALL" && !options.levels.some((l) => String(l) === o.level)) {
		return problem("That level has nothing in this timetable.", 404);
	}

	const timetableType = EXPORT_KINDS[o.kind].timetableType;
	let bundle;
	try {
		bundle = await getPublic(`/public/export/bundle?realm=${encodeURIComponent(req.realm)}`
			+ `&semester_id=${req.semesterId}&timetable_type=${timetableType}`);
	} catch {
		return problem("The timetable couldn't be loaded. Try again shortly.", 502);
	}
	if (!bundle) return problem("This timetable hasn't been published yet.", 404);

	// An older link: send it to the version now in force.
	const current = bundle.signoff?.verification?.code;
	if (req.code && current && req.code !== current) {
		const next = new URL(request.nextUrl);
		next.searchParams.set("code", current);
		return new Response(null, { status: 302, headers: { Location: next.toString(), "Cache-Control": "no-store" } });
	}

	let out;
	try {
		const qrDataUrl = await signoffQrDataUrl(bundle.signoff).catch(() => null);
		out = buildExport(bundle, { ...req.options, qrDataUrl });
	} catch (error) {
		if (error instanceof ExportError) return problem(error.message, error.status);
		console.error("[api/export] render failed", error);
		return problem("The timetable couldn't be built. Try different filters, or try again.", 500);
	}

	return fileResponse(out, current ? { "X-Timetable-Code": current } : {});
}
