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

// The newest session, when `session` is older than it; otherwise null.
export function newerSessionThan(session, sessions) {
	const year = sessionStartYear(session?.name);
	if (year === null) return null;
	const newest = sortSessions(sessions)[0];
	return newest && (sessionStartYear(newest.name) ?? 0) > year ? newest : null;
}
