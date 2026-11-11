// Shared by the download page (server) and its form (browser).

export const KIND_TITLE = { lecture: 'Lecture Timetable', exam: 'Examination Timetable', cbt: 'CBT Examination Timetable' };

/** Each published timetable, plus a CBT entry for each published exam timetable. */
export function downloadableEntries(published) {
	return published.flatMap((t) => {
		const base = { ...t, kind: t.timetable_type };
		return t.timetable_type === 'exam' ? [base, { ...t, kind: 'cbt' }] : [base];
	});
}
