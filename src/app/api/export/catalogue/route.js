// The FINAL timetables the download page offers: GET /api/export/catalogue
import { getPublished, jsonResponse, problem } from "@/lib/exportServer";

export const runtime = "nodejs";

export async function GET() {
	try {
		return jsonResponse((await getPublished()) || []);
	} catch {
		return problem("The timetables couldn't be loaded. Try again shortly.", 502);
	}
}
