// Shared by the download page (server) and its form (browser).

/** Each published timetable, plus a CBT entry for each published exam timetable. */
export function downloadableEntries(published) {
	return published.flatMap((t) => {
		const base = { ...t, kind: t.timetable_type };
		return t.timetable_type === 'exam' ? [base, { ...t, kind: 'cbt' }] : [base];
	});
}
