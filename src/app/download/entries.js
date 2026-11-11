// Shared by the download page (server) and its form (browser).

export const KINDS = ['lecture', 'exam', 'cbt'];

const unique = (values) => [...new Set(values)];

/** Each published timetable, plus a CBT entry for each published exam timetable. */
export function downloadableEntries(published) {
	return published.flatMap((t) => {
		const base = { ...t, kind: t.timetable_type };
		return t.timetable_type === 'exam' ? [base, { ...t, kind: 'cbt' }] : [base];
	});
}

/**
 * What the page shows first: the newest session and semester, lectures if
 * published, and the first programme. The server renders this choice (so the
 * index of faculties is in the HTML) and the form starts from the same one.
 */
export function defaultSelection(entries) {
	const session = unique(entries.map((e) => e.session_name))[0] || '';
	const semester = unique(entries.filter((e) => e.session_name === session).map((e) => e.semester_name))[0] || '';
	const inSemester = entries.filter((e) => e.session_name === session && e.semester_name === semester);
	const kind = KINDS.find((k) => inSemester.some((e) => e.kind === k)) || '';
	const forKind = inSemester.filter((e) => e.kind === kind);
	return { session, semester, kind, realm: forKind[0]?.realm_key || '', forKind };
}

/** The key the index of faculties uses for a set of programmes' timetables. */
export const indexId = (entries) => entries.map((e) => `${e.realm_key}:${e.semester_id}:${e.kind}`).join('|');
