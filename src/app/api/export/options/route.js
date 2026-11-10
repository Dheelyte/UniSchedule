// A published timetable's filter choices: GET /api/export/options?realm=UG&semester=3&type=lecture
import { getOptions, jsonResponse, problem } from "@/lib/exportServer";

export const runtime = "nodejs";

export async function GET(request) {
	const params = request.nextUrl.searchParams;
	const realm = (params.get("realm") || "").toUpperCase();
	const semester = Number(params.get("semester"));
	const type = params.get("type");
	if (!/^[A-Z][A-Z0-9_]{0,31}$/.test(realm) || !Number.isInteger(semester) || semester <= 0) {
		return problem("Choose a programme and semester.", 400);
	}
	if (!["lecture", "exam", "cbt"].includes(type)) return problem("Choose lecture, exam or CBT.", 400);
	try {
		const options = await getOptions(realm, semester, type);
		return options ? jsonResponse(options) : problem("This timetable hasn't been published.", 404);
	} catch {
		return problem("The filters couldn't be loaded. Try again shortly.", 502);
	}
}
