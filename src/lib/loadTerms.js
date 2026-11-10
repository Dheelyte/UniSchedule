// The sessions and semesters the term pickers offer, loaded in parallel.
import { apiClient } from "./apiClient.js";

/**
 * @returns {Promise<{ sessions: object[], semesters: object[], current: object | null }>}
 *   `semesters` carry `sessionName`, oldest session first.
 */
export async function loadTerms() {
	const [sessions, all, current] = await Promise.all([
		apiClient.get("/calendar/sessions").catch(() => []),
		apiClient.get("/calendar/semesters").catch(() => null),
		apiClient.get("/calendar/semesters/current").catch(() => null),
	]);
	const list = sessions || [];
	let semesters;
	if (Array.isArray(all)) {
		semesters = all.map((sem) => ({ ...sem, sessionName: sem.session_name }));
	} else {
		// A backend without GET /calendar/semesters yet: one call per session, together.
		const perSession = await Promise.all(
			list.map((s) => apiClient.get(`/calendar/sessions/${s.id}/semesters`).catch(() => [])),
		);
		semesters = list.flatMap((s, i) => (perSession[i] || []).map((sem) => ({ ...sem, sessionName: s.name })));
	}
	return { sessions: list, semesters, current };
}
