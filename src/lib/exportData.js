import QRCode from 'qrcode';
import { apiClient } from '@/lib/apiClient';
import { toScheduleItem, buildSchedulesWithDetails } from '@/lib/exportFilters';
import { isSigned, verifyUrl } from '@/lib/pdfSignoff';

/**
 * The sign-off a FINAL export prints (signatory, signature, stamp and
 * verification code), with the code's QR image ready to draw. Null for a draft,
 * or if it can't be loaded: the export still goes ahead, unsigned.
 */
async function loadSignoff(semesterId, timetableType) {
	try {
		const signoff = await apiClient.get(
			`/signoffs/export?semester_id=${semesterId}&timetable_type=${timetableType}`,
		);
		if (!isSigned(signoff)) return null;
		const qr_data_url = await QRCode.toDataURL(verifyUrl(signoff.verification.code), {
			margin: 0,
			errorCorrectionLevel: 'M',
			width: 256,
			color: { dark: '#0f172a', light: '#ffffff' },
		});
		return { ...signoff, qr_data_url };
	} catch {
		return null;
	}
}

/**
 * Load the schedules, blocked slots and lock state of the semester chosen in
 * the export modal. The semester on screen reuses what the page already has
 * loaded; any other semester is fetched.
 *
 * `signoff` is set for a FINAL timetable (see loadSignoff).
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
			signoff: pageIsLocked ? await loadSignoff(semesterId, timetableType) : null,
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
	const isLocked = !!lock?.is_locked;
	return {
		schedules,
		blockedSlots: blockedSlots || [],
		isLocked,
		signoff: isLocked ? await loadSignoff(semesterId, timetableType) : null,
	};
}
