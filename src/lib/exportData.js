import { apiClient } from '@/lib/apiClient';
import { toScheduleItem, buildSchedulesWithDetails } from '@/lib/exportFilters';

/**
 * Load the schedules, blocked slots and lock state of the semester chosen in
 * the export modal. The semester on screen reuses what the page already has
 * loaded; any other semester is fetched.
 *
 * Returns null when the chosen semester's schedules can't be loaded.
 */
export async function loadExportSemester({
	semesterId,
	pageSemesterId,
	pageSchedules,
	pageIsLocked,
	timetableType,
	state,
}) {
	const blockedSlotsReq = apiClient
		.get(`/timetable/blocked-slots?semester_id=${semesterId}`)
		.catch(() => []);

	if (semesterId === pageSemesterId) {
		return {
			schedules: pageSchedules,
			blockedSlots: (await blockedSlotsReq) || [],
			isLocked: pageIsLocked,
		};
	}

	const [items, blockedSlots, locks] = await Promise.all([
		apiClient.get(`/timetable/schedule-items?semester_id=${semesterId}`).catch(() => null),
		blockedSlotsReq,
		apiClient.get(`/timetable/locks?semester_id=${semesterId}`).catch(() => []),
	]);
	if (items === null) return null;
	const schedules = buildSchedulesWithDetails(items.map(toScheduleItem), state)
		.filter((s) => s.type === timetableType);
	const lock = (locks || []).find((l) => l.timetable_type === timetableType);
	return { schedules, blockedSlots: blockedSlots || [], isLocked: !!lock?.is_locked };
}
