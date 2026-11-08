"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { useApp, ACTION_TYPES } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { apiClient } from "@/lib/apiClient";
import { loadTerms } from "@/lib/loadTerms";
import { downloadTimetable } from "@/lib/exportClient";
import { detectAllConflicts, dismissalSignatureSet, toExternalBooking } from "@/lib/conflicts";
import TimetableGrid from "@/components/TimetableGrid/TimetableGrid";
import { useToast } from "@/components/Toast/Toast";
import ExportModal from "@/components/ExportModal/ExportModal";
import TimetableStatusBadge from "@/components/TimetableStatusBadge/TimetableStatusBadge";
import RequestEditModal from "@/components/RequestEditModal/RequestEditModal";
import RequestChangeModal from "@/components/RequestChangeModal/RequestChangeModal";
import { isViewerRole, canRequestChange } from "@/lib/roles";
import { useConfirm } from "@/components/ConfirmModal/ConfirmContext";
import { TimetableSkeleton } from "@/components/Skeleton/Skeleton";
import styles from "./exams.module.css";

// Toggle to bypass the conflict warning modal before PDF export.
// Set to false to skip showing conflict warning popups.
const SHOW_CONFLICTS_BEFORE_EXPORT = false;

const NO_EXTERNAL_BOOKINGS = [];

export default function ExamTimetablePage() {
	const { getSchedulesWithDetails, state, dispatch, isInitialized } = useApp();
	const { user, realmConfig } = useAuth();
	const { addToast } = useToast();
	const confirm = useConfirm();

	const [sessions, setSessions] = useState([]);
	const [semesters, setSemesters] = useState([]);
	const [selectedSemesterId, setSelectedSemesterId] = useState(null);
	const [blockedSlots, setBlockedSlots] = useState([]);
	const [isExportModalOpen, setIsExportModalOpen] = useState(false);
	const [isLocked, setIsLocked] = useState(false);
	const [lockBusy, setLockBusy] = useState(false);
	const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
	const [requestBusy, setRequestBusy] = useState(false);
	const [isChangeModalOpen, setIsChangeModalOpen] = useState(false);
	const [changeBusy, setChangeBusy] = useState(false);
	const [enrollmentsByCourse, setEnrollmentsByCourse] = useState(new Map());
	// Sessions other realms hold in the shared rooms (their current semesters).
	const [externalBookings, setExternalBookings] = useState(NO_EXTERNAL_BOOKINGS);

	const handleChangeRequestSubmit = async (payload) => {
		if (selectedSemesterId === null || changeBusy) return;
		setChangeBusy(true);
		try {
			await apiClient.post("/timetable/change-requests", {
				...payload,
				semester_id: selectedSemesterId,
			});
			setIsChangeModalOpen(false);
			addToast({
				type: "success",
				title: "Request Sent",
				message: "Super admins have been notified of your change request.",
			});
		} catch (e) {
			addToast({
				type: "error",
				title: "Request Failed",
				message: e?.message || "Unable to submit change request.",
			});
		} finally {
			setChangeBusy(false);
		}
	};

	const handleRequestEditSubmit = async (reason) => {
		if (selectedSemesterId === null || requestBusy) return;
		setRequestBusy(true);
		try {
			await apiClient.post(
				`/timetable/locks/exam/edit-requests?semester_id=${selectedSemesterId}`,
				{ reason },
			);
			setIsRequestModalOpen(false);
			addToast({
				type: "success",
				title: "Request Sent",
				message: "Super admins have been notified of your request.",
			});
		} catch (e) {
			addToast({
				type: "error",
				title: "Request Failed",
				message: e?.message || "Unable to submit edit request.",
			});
		} finally {
			setRequestBusy(false);
		}
	};

	useEffect(() => {
		async function loadTermList() {
			try {
				const { sessions: sessList, semesters: allSems, current } = await loadTerms();
				setSessions(sessList);
				setSemesters(allSems);
				if (current) {
					setSelectedSemesterId(current.id);
				} else if (allSems.length > 0) {
					setSelectedSemesterId(allSems[0].id);
				}
			} catch (e) {
				console.error(e);
			}
		}
		loadTermList();
	}, []);

	const loadSchedules = useCallback(
		async (semId) => {
			if (semId === null) return;
			try {
				apiClient
					.get("/timetable/external-bookings")
					.then((rows) => setExternalBookings((rows || []).map(toExternalBooking)))
					.catch(() => setExternalBookings(NO_EXTERNAL_BOOKINGS));
				if (isInitialized) {
					const [
						scheduleItems,
						blockedSlotsData,
						locks
					] = await Promise.all([
						apiClient.get(`/timetable/schedule-items?semester_id=${semId}&type=exam`).catch(() => []),
						apiClient.get(`/timetable/blocked-slots?semester_id=${semId}`).catch(() => []),
						apiClient.get(`/timetable/locks?semester_id=${semId}`).catch(() => []),
					]);
					const examLock = (locks || []).find((l) => l.timetable_type === "exam");
					setIsLocked(!!examLock?.is_locked);
					dispatch({
						type: ACTION_TYPES.INIT_STATE,
						payload: {
							scheduleItems: (scheduleItems || []).map((s) => ({
								...s,
								courseId: s.course_id,
								roomIds: s.room_ids,
								facultyId: s.faculty_id,
								day: s.day_of_week,
								examDate: s.exam_date,
								startTime: s.start_time,
								endTime: s.end_time,
							})),
						},
					});
					setBlockedSlots(blockedSlotsData || []);
				} else {
					const [
						faculties,
						departments,
						rooms,
						courses,
						scheduleItems,
						blockedSlotsData,
						locks,
						enrollments,
					] = await Promise.all([
						apiClient.get("/timetable/faculties?all=true").catch(() => []),
						apiClient.get("/timetable/departments?all=true").catch(() => []),
						apiClient.get("/timetable/rooms?all=true").catch(() => []),
						apiClient.get("/timetable/courses").catch(() => []),
						apiClient
							.get(`/timetable/schedule-items?semester_id=${semId}&type=exam`)
							.catch(() => []),
						apiClient
							.get(`/timetable/blocked-slots?semester_id=${semId}`)
							.catch(() => []),
						apiClient
							.get(`/timetable/locks?semester_id=${semId}`)
							.catch(() => []),
						apiClient.get("/timetable/enrollments").catch(() => []),
					]);
					const examLock = (locks || []).find((l) => l.timetable_type === "exam");
					setIsLocked(!!examLock?.is_locked);
					dispatch({
						type: ACTION_TYPES.INIT_STATE,
						payload: {
							faculties: faculties || [],
							departments: (departments || []).map((d) => ({
								...d,
								facultyId: d.faculty_id,
							})),
							rooms: (rooms || []).map((r) => ({
								...r,
								facultyId: r.faculty_id ?? r.facultyId ?? null,
								isLab: r.is_lab ?? r.isLab ?? false,
								isActive: r.is_active !== false,
								activeSeats: r.active_seats ?? r.activeSeats ?? 0,
								inactiveSeats: r.inactive_seats ?? r.inactiveSeats ?? 0,
							})),
							courses: (courses || []).map((c) => ({
								...c,
								creditLoad: c.credit_load,
								departmentId: c.department_id,
								isCbtExam: c.is_cbt_exam || false,
							})),
							scheduleItems: (scheduleItems || []).map((s) => ({
								...s,
								courseId: s.course_id,
								roomIds: s.room_ids,
								facultyId: s.faculty_id,
								day: s.day_of_week,
								examDate: s.exam_date,
								startTime: s.start_time,
								endTime: s.end_time,
							})),
							enrollments: enrollments || [],
						},
					});
					setBlockedSlots(blockedSlotsData || []);
				}
			} catch (e) {
				console.error(e);
			}
		},
		[dispatch, isInitialized],
	);

	useEffect(() => {
		if (isInitialized && state.enrollments) {
			const map = new Map();
			state.enrollments.forEach((e) => {
				if (!map.has(e.course_id)) map.set(e.course_id, []);
				map.get(e.course_id).push(e);
			});
			setEnrollmentsByCourse(map);
		}
	}, [isInitialized, state.enrollments]);

	useEffect(() => {
		if (selectedSemesterId !== null) loadSchedules(selectedSemesterId);
	}, [selectedSemesterId, loadSchedules]);

	const handleToggleLock = async () => {
		if (selectedSemesterId === null || lockBusy) return;
		const next = !isLocked;
		const ok = await confirm(
			next
				? {
						title: "Lock exam timetable?",
						message: "Marking this timetable as FINAL means:",
						details: [
							"No one - including superadmins - can add, edit, or delete exam sittings until you unlock.",
							"Faculty editors lose all edit affordances on this timetable.",
							"You can unlock at any time to resume editing.",
						],
						confirmLabel: "Lock Timetable",
						tone: "success",
					}
				: {
						title: "Unlock exam timetable?",
						message: "Reverting to DRAFT means:",
						details: [
							"Superadmins and faculty editors can resume creating, editing, and deleting exam sittings.",
							"The published timetable is no longer marked as final and may change without notice.",
							"You can lock again once the changes are complete.",
						],
						confirmLabel: "Unlock Timetable",
						tone: "primary",
					},
		);
		if (!ok) return;
		setLockBusy(true);
		try {
			const res = await apiClient.put(
				`/timetable/locks/exam?semester_id=${selectedSemesterId}`,
				{ is_locked: next },
			);
			setIsLocked(!!res?.is_locked);
			addToast({
				type: "success",
				title: next ? "Timetable Locked" : "Timetable Unlocked",
				message: next
					? "The exam timetable is now read-only for all roles."
					: "The exam timetable can now be edited.",
			});
		} catch (e) {
			addToast({
				type: "error",
				title: "Lock Update Failed",
				message: e?.message || "Unable to update lock state.",
			});
		} finally {
			setLockBusy(false);
		}
	};

	const handleExportInit = async (format) => {
		if (SHOW_CONFLICTS_BEFORE_EXPORT) {
			const schedules = getSchedulesWithDetails.filter((s) => s.type === "exam");
			const dismissals = await apiClient.get("/timetable/conflict-dismissals").catch(() => []);
			const conflictsMap = detectAllConflicts(schedules, null, null, dismissalSignatureSet(dismissals), { config: realmConfig, externalBookings });
			const errorMessages = [
				...new Set(
					Array.from(conflictsMap.values())
						.flat()
						.filter((c) => c.severity === "error")
						.map((c) => c.message),
				),
			];
			if (errorMessages.length > 0) {
				const proceed = await confirm({
					title: "Conflicts Detected",
					message: `This timetable has ${errorMessages.length} unresolved conflict${errorMessages.length === 1 ? "" : "s"}. You can ignore them and export anyway.`,
					details: errorMessages,
					confirmLabel: "Ignore & Export",
					cancelLabel: "Cancel",
					tone: "danger",
				});
				if (!proceed) return;
			}
		}
		setIsExportModalOpen(true);
	};

	const handleExportConfirm = async ({
		session,
		semester,
		semesterId,
		facultyId,
		departmentId,
		level,
		format = "pdf",
		monochrome = false,
		paperSize = "a3",
		cbtOnly = false,
		gstOnly = false,
	}) => {
		setIsExportModalOpen(false);
		if (semesterId === null || semesterId === undefined) {
			addToast({ type: "error", title: "Export Failed", message: "Choose a semester to export." });
			return;
		}
		// The file is built on the server (src/lib/exportClient.js), so a big
		// export doesn't slow the page down.
		addToast({ type: "info", title: "Preparing export", message: `Building the ${session} ${semester} timetable…` });
		try {
			const message = await downloadTimetable({
				semesterId,
				kind: "exam",
				facultyId,
				departmentId,
				level,
				format,
				monochrome,
				paperSize,
				gstOnly,
				cbtOnly,
			});
			addToast({ type: "success", title: format === "csv" ? "CSV Exported" : "PDF Exported", message });
		} catch (error) {
			addToast({ type: "error", title: "Export Failed", message: error.message || `Could not export the ${session} ${semester} timetable.` });
		}
	};

	if (selectedSemesterId === null) return <TimetableSkeleton />;

	const isCurrentSemester =
		semesters.find((s) => s.id === selectedSemesterId)?.is_current === true;
	const isViewer = isViewerRole(user?.role);
	const readOnlyReasons = [];
	if (isViewer) readOnlyReasons.push("Your role is view-only.");
	if (!isCurrentSemester)
		readOnlyReasons.push(
			"This semester is not the current one — only the current semester can be edited.",
		);
	if (isLocked)
		readOnlyReasons.push(
			"The exam timetable has been locked (FINAL) by a super admin.",
		);
	const readOnly = readOnlyReasons.length > 0;
	const showRequestChange =
		!isLocked && isCurrentSemester && canRequestChange(user?.role);
	const examSchedules = getSchedulesWithDetails.filter(
		(s) => s.type === "exam",
	);

	return (
		<div className={styles.page}>
			<div className={styles.pageHeader}>
				<TimetableStatusBadge
					isLocked={isLocked}
					canToggle={user?.role === "SUPER_ADMIN" && isCurrentSemester}
					onToggle={handleToggleLock}
					disabled={lockBusy}
					canRequestEdit={
						isLocked && isCurrentSemester && user?.role === "FACULTY_EDITOR"
					}
					onRequestEdit={() => setIsRequestModalOpen(true)}
					requestBusy={requestBusy}
				/>
				<div className={styles.headerActions}>
					{semesters.length > 0 && (
						<select
							className="form-input"
							style={{ minWidth: "240px" }}
							value={selectedSemesterId ?? ""}
							onChange={(e) => setSelectedSemesterId(parseInt(e.target.value))}>
							{semesters.map((s) => (
								<option key={s.id} value={s.id}>
									{s.sessionName} - {s.name}
									{s.is_current ? " (Current)" : ""}
								</option>
							))}
						</select>
					)}
					{user?.role === "SUPER_ADMIN" && isCurrentSemester && !isLocked && (
						<>
							<Link className="btn btn-secondary" href="/timetable/import?type=exam">
								Import <span className="badge badge-primary" style={{ marginLeft: 6, fontSize: "0.65rem" }}>Beta</span>
							</Link>
							<Link className="btn btn-secondary" href="/timetable/import?type=exam&source=semester">
								Copy semester <span className="badge badge-primary" style={{ marginLeft: 6, fontSize: "0.65rem" }}>Beta</span>
							</Link>
						</>
					)}
					{showRequestChange && (
						<button
							className="btn btn-secondary"
							onClick={() => setIsChangeModalOpen(true)}>
							Request a Change
						</button>
					)}
					<button
						className="btn btn-secondary"
						onClick={() => handleExportInit("csv")}>
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round">
							<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
							<polyline points="7 10 12 15 17 10" />
							<line x1="12" y1="15" x2="12" y2="3" />
						</svg>
						Export Timetable
					</button>
				</div>
			</div>
			<TimetableGrid
				mode="exam"
				semesterId={selectedSemesterId}
				semesterName={
					semesters.find((s) => s.id === selectedSemesterId)?.name || null
				}
				blockedSlots={blockedSlots}
				readOnly={readOnly}
				readOnlyReasons={readOnlyReasons}
				enrollmentsByCourse={enrollmentsByCourse}
				externalBookings={isCurrentSemester ? externalBookings : NO_EXTERNAL_BOOKINGS}
			/>
			<ExportModal
				isOpen={isExportModalOpen}
				onClose={() => setIsExportModalOpen(false)}
				onExport={handleExportConfirm}
				mode="exam"
				sessions={sessions}
				semesters={semesters}
				defaultSemesterId={selectedSemesterId}
			/>
			{isRequestModalOpen && (
				<RequestEditModal
					onClose={() => !requestBusy && setIsRequestModalOpen(false)}
					onSubmit={handleRequestEditSubmit}
					mode="exam"
					busy={requestBusy}
				/>
			)}
			{isChangeModalOpen && (
				<RequestChangeModal
					onClose={() => !changeBusy && setIsChangeModalOpen(false)}
					onSubmit={handleChangeRequestSubmit}
					busy={changeBusy}
					mode="exam"
					courses={state.courses}
					departments={state.departments}
					faculties={state.faculties}
					rooms={state.rooms}
					scheduleItems={examSchedules}
				/>
			)}
		</div>
	);
}
