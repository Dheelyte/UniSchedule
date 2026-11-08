// Staff exports: GET /api/export/staff?semester=3&type=lecture&...
// with the header X-Export-Ticket: <ticket from POST /export/ticket>.
//
// The timetable pages call this instead of building files in the browser. The
// ticket stands for the signed-in user (the login cookie belongs to the API's
// domain, so it never reaches this server); the backend checks it and returns
// what that user's own export would hold: drafts too, and FINAL copies with the
// signature and stamp. Nothing here is cached.
import { buildExport, EXPORT_KINDS, ExportError, signoffQrDataUrl } from "@/lib/exportJob";
import { readExportRequest } from "@/lib/exportRequest";
import { fileResponse, getStaffBundle, problem } from "@/lib/exportServer";

export const runtime = "nodejs";
export const maxDuration = 60;

const FAILED = "The timetable couldn't be loaded. Try again shortly.";

export async function GET(request) {
	const ticket = request.headers.get("x-export-ticket");
	if (!ticket) return problem("Sign in to export.", 401);
	let req;
	try {
		req = readExportRequest(request.nextUrl.searchParams);
	} catch (error) {
		return problem(error.message, 400);
	}

	let result;
	try {
		result = await getStaffBundle(req.semesterId, EXPORT_KINDS[req.options.kind].timetableType, ticket);
	} catch {
		return problem(FAILED, 502);
	}
	if (result.status !== 200) {
		// The backend's reasons (expired ticket, disabled account, no such
		// semester) are meant for the user; anything else is our failure.
		const known = [401, 403, 404, 429].includes(result.status);
		return problem(known && result.detail ? result.detail : FAILED, known ? result.status : 502);
	}

	let out;
	try {
		const qrDataUrl = await signoffQrDataUrl(result.bundle.signoff).catch(() => null);
		out = buildExport(result.bundle, { ...req.options, qrDataUrl });
	} catch (error) {
		if (error instanceof ExportError) return problem(error.message, error.status);
		console.error("[api/export/staff] render failed", error);
		return problem("The timetable couldn't be built. Try different filters, or try again.", 500);
	}

	return fileResponse(out, {
		"Cache-Control": "private, no-store",
		// The page shows these; header values must be ASCII, so they're encoded.
		"X-Export-File-Name": encodeURIComponent(out.fileName),
		"X-Export-Message": encodeURIComponent(out.message),
	});
}
