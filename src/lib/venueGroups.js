// Faculties that sit their sessions in the same venues. Working on one of them
// offers the rooms of all of them, so a venue never has to be found by search.
// UG faculty ids never change (see CLAUDE.md), so the ids are fixed here.
export const SHARED_VENUE_GROUPS = [
	["FLS-290", "FPAES-7903", "FCAI-243"], // Life Sciences, Physical and Earth Sciences, Computing and Informatics
];

/** The faculties whose rooms are offered when working on this faculty (itself first). */
export function venueFacultyIds(facultyId) {
	if (!facultyId) return [];
	const group = SHARED_VENUE_GROUPS.find((g) => g.includes(facultyId));
	return group ? [facultyId, ...group.filter((id) => id !== facultyId)] : [facultyId];
}

/**
 * Rooms to pick from for a faculty: its own, plus its group's, as
 * [{ facultyId, rooms }] sections, each sorted by name. Empty sections are left out.
 */
export function roomChoices(rooms, facultyId) {
	const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
	return venueFacultyIds(facultyId)
		.map((id) => ({
			facultyId: id,
			rooms: rooms
				.filter((r) => r.faculty_id === id && r.is_active !== false)
				.sort((a, b) => collator.compare(a.name, b.name)),
		}))
		.filter((section) => section.rooms.length > 0);
}
