// Refresh the public download lists after a timetable is locked or unlocked:
// POST /api/export/refresh?semester=3&type=lecture
// with the header X-Export-Ticket: <ticket from POST /export/ticket>.
//
// The download page and its routes cache the backend's public reads for a few
// minutes (src/lib/exportServer.js); without this, a newly locked timetable
// would not be offered until that ran out. Staff only, so nobody else can
// keep clearing the cache and send every visitor to the database.
import { revalidateTag } from "next/cache";
import { checkStaffTicket, problem, PUBLISHED_TAG } from "@/lib/exportServer";

export const runtime = "nodejs";

export async function POST(request) {
	const ticket = request.headers.get("x-export-ticket");
	if (!ticket) return problem("Sign in first.", 401);
	const params = request.nextUrl.searchParams;
	const semesterId = Number(params.get("semester"));
	const type = params.get("type");
	if (!Number.isInteger(semesterId) || semesterId <= 0 || !["lecture", "exam"].includes(type)) {
		return problem("Choose a semester and timetable.", 400);
	}

	let check;
	try {
		check = await checkStaffTicket(semesterId, type, ticket);
	} catch {
		return problem("The server couldn't be reached. Try again shortly.", 502);
	}
	if (check.status !== 204) return problem(check.detail || "Sign in first.", check.status === 403 ? 403 : 401);

	// Gone at once: the next visitor gets the new list, not a stale copy.
	revalidateTag(PUBLISHED_TAG, { expire: 0 });
	return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
