// Academic sessions are named "YYYY/YYYY". The current session is chosen by a
// super admin, so it can be an older one reopened for archiving or corrections.

// Fired on window when the current session or semester changes.
export const TERMS_CHANGED_EVENT = "terms:changed";

export function sessionStartYear(name) {
	const match = /(\d{4})/.exec(name || "");
	return match ? Number(match[1]) : null;
}

// Newest first.
export function sortSessions(sessions) {
	return [...sessions].sort(
		(a, b) => (sessionStartYear(b.name) ?? 0) - (sessionStartYear(a.name) ?? 0),
	);
}

// The newest session after `session` that already has semesters, or null.
// Sessions created ahead of time, with no semesters yet, don't make the
// current one a past session.
export async function newerSessionInUse(session, sessions, fetchSemesters) {
	const year = sessionStartYear(session?.name);
	if (year === null) return null;
	const newer = sortSessions(sessions).filter(
		(s) => (sessionStartYear(s.name) ?? 0) > year,
	);
	for (const s of newer) {
		const semesters = await fetchSemesters(s.id);
		if (semesters?.length) return s;
	}
	return null;
}
