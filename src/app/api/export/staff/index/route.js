// The index of faculties for staff:
// GET /api/export/staff/index?semester=3&type=lecture&session=2026/2027&name=First Semester
// with the header X-Export-Ticket: <ticket from POST /export/ticket>.
//
// Built from FINAL timetables only (src/lib/exportIndex.js), but offered on the
// platform rather than the public download page. `semester` is the id the
// ticket was issued for; `session` and `name` pick which index to build.
import { buildFacultyIndex, INDEX_TYPE_TITLE } from "@/lib/exportIndex";
import { checkStaffTicket, fileResponse, problem } from "@/lib/exportServer";

export const runtime = "nodejs";
export const maxDuration = 30;

const FAILED = "The timetables couldn't be loaded. Try again shortly.";

export async function GET(request) {
	const ticket = request.headers.get("x-export-ticket");
	if (!ticket) return problem("Sign in to export.", 401);
	const params = request.nextUrl.searchParams;
	const semesterId = Number(params.get("semester"));
	const type = params.get("type");
	const session = params.get("session");
	const semester = params.get("name");
	if (!Number.isInteger(semesterId) || semesterId <= 0 || !session || !semester) {
		return problem("Choose a session and semester.", 400);
	}
	if (!INDEX_TYPE_TITLE[type]) return problem("Choose lecture or exam.", 400);

	let check;
	try {
		check = await checkStaffTicket(semesterId, type, ticket);
	} catch {
		return problem(FAILED, 502);
	}
	if (check.status !== 204) {
		const known = [401, 403, 429].includes(check.status);
		return problem(known && check.detail ? check.detail : FAILED, known ? check.status : 502);
	}

	let pdf;
	try {
		pdf = await buildFacultyIndex({ session, semester, type, origin: request.nextUrl.origin });
	} catch (error) {
		console.error("[api/export/staff/index] failed", error);
		return problem(FAILED, 502);
	}
	if (!pdf) {
		return problem(`No ${type} timetable has been marked FINAL for ${session} ${semester} yet, so there is nothing to index.`, 404);
	}

	return fileResponse(
		{ data: pdf.output("arraybuffer"), contentType: "application/pdf", fileName: pdf.fileName },
		{
			"Cache-Control": "private, no-store",
			"X-Export-File-Name": encodeURIComponent(pdf.fileName),
		},
	);
}
