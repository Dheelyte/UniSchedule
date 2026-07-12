"use client";

import { useState, useEffect, useCallback } from "react";
import { useApp, ACTION_TYPES } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { apiClient } from "@/lib/apiClient";
import { detectAllConflicts, dismissalSignatureSet } from "@/lib/conflicts";
import { exportTimetablePDF } from "@/lib/pdfExport";
import { exportTimetableCSV } from "@/lib/csvExport";
import { isGeneralStudiesCourse, GENERAL_STUDIES_FACULTY } from "@/lib/utils";
import { isRoomActive } from "@/lib/utils";
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

export default function ExamTimetablePage() {
	const { getSchedulesWithDetails, state, dispatch, isInitialized } = useApp();
	const { user } = useAuth();
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
		async function loadTerms() {
			try {
				const sessList = await apiClient
					.get("/calendar/sessions")
					.catch(() => []);
				setSessions(sessList);
				let allSems = [];
				for (const s of sessList) {
					const sems = await apiClient
						.get(`/calendar/sessions/${s.id}/semesters`)
						.catch(() => []);
					allSems.push(...sems.map((sem) => ({ ...sem, sessionName: s.name })));
				}
				setSemesters(allSems);
				const current = await apiClient
					.get("/calendar/semesters/current")
					.catch(() => null);
				if (current) {
					setSelectedSemesterId(current.id);
				} else if (allSems.length > 0) {
					setSelectedSemesterId(allSems[0].id);
				}
			} catch (e) {
				console.error(e);
			}
		}
		loadTerms();
	}, []);

	const loadSchedules = useCallback(
		async (semId) => {
			if (semId === null) return;
			try {
				if (isInitialized) {
					const [
						scheduleItems,
						blockedSlotsData,
						locks
					] = await Promise.all([
						apiClient.get(`/timetable/schedule-items?semester_id=${semId}`).catch(() => []),
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
							.get(`/timetable/schedule-items?semester_id=${semId}`)
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
			const conflictsMap = detectAllConflicts(schedules, null, null, dismissalSignatureSet(dismissals));
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
		facultyId,
		departmentId,
		format = "pdf",
		monochrome = false,
		paperSize = "a4",
		cbtOnly = false,
		gstOnly = false,
	}) => {
		setIsExportModalOpen(false);
		const deptIdNum =
			departmentId && departmentId !== "ALL" ? Number(departmentId) : null;
		const allExams = getSchedulesWithDetails.filter((s) => s.type === "exam");
		const selectedFaculty =
			facultyId === "ALL"
				? null
				: state.faculties.find((f) => f.id === facultyId);
		const isGeneralStudies =
			selectedFaculty?.name?.trim().toLowerCase() === "general studies";
		// A faculty's timetable includes courses it owns AND interfaculty/other
		// courses whose students (a department in this faculty) are enrolled —
		// mirroring how the platform scopes a faculty's timetable.
		const deptFacultyId = new Map(state.departments.map((d) => [d.id, d.facultyId]));
		const enrolledInFaculty = (courseId, fId) =>
			(enrollmentsByCourse.get(courseId) || []).some((e) => deptFacultyId.get(e.department_id) === fId);
		const filtered = allExams.filter((s) => {
			if (gstOnly) {
				if (!isGeneralStudiesCourse(s.courseCode)) return false;
			} else if (isGeneralStudies) {
				// General Studies courses are university-wide; match by course code prefix.
				if (!isGeneralStudiesCourse(s.courseCode)) return false;
			} else if (facultyId !== "ALL" && s.facultyId !== facultyId && !enrolledInFaculty(s.courseId, facultyId)) {
				return false;
			}
			if (deptIdNum !== null && s.departmentId !== deptIdNum) return false;
			if (cbtOnly) {
				const course = state.courses.find((c) => c.id === s.courseId);
				const isCbt = course?.isCbtExam || course?.is_cbt_exam || false;
				if (!isCbt) return false;
			}
			return true;
		});
		// Attribute GST/ENT courses to the General Studies faculty in the export.
		const filteredSchedules = filtered.map((s) =>
			isGeneralStudiesCourse(s.courseCode)
				? { ...s, facultyName: GENERAL_STUDIES_FACULTY }
				: s,
		);
		const activeRoomIds = new Set(state.rooms.filter(isRoomActive).map((room) => room.id));
		const exportableSchedules = filteredSchedules.filter((s) => (s.roomIds || []).some((rid) => activeRoomIds.has(rid)));
		if (exportableSchedules.length === 0) {
			addToast({
				type: "error",
				title: "Export Failed",
				message: "No schedules found for the selected filters.",
			});
			return;
		}
		// When exporting every faculty, group output by faculty with General Studies first.
		const groupByFaculty = facultyId === "ALL";

		const facultyInfo =
			facultyId === "ALL"
				? "All Faculties"
				: state.faculties.find((f) => f.id === facultyId)?.name ||
					"Unknown Faculty";
		const departmentInfo =
			deptIdNum === null
				? null
				: state.departments.find((d) => d.id === deptIdNum)?.name ||
					"Unknown Department";

		if (format === "csv") {
			exportTimetableCSV({
				schedules: filteredSchedules,
				title: "Examination Timetable",
				session,
				semester,
				faculty: facultyInfo,
				department: departmentInfo,
				mode: "exam",
				groupByFaculty,
			});
			addToast({
				type: "success",
				title: "CSV Exported",
				message: "Exam timetable downloaded as CSV.",
			});
			return;
		}
		// A3 structured PDF export (use structured layout on A3)
		if (format === "pdf" && paperSize === "a3") {
			const blockedSlots = await apiClient
				.get(`/timetable/blocked-slots?semester_id=${selectedSemesterId}`)
				.catch(() => []);

			exportTimetablePDF({
				schedules: exportableSchedules,
				blockedSlots,
				rooms: cbtOnly ? state.rooms.filter(r => r.name?.toUpperCase().includes("CBT")) : state.rooms,
				faculties: state.faculties,
				departments: state.departments,
				enrollments: state.enrollments,
				title: gstOnly ? "General Studies Examination Timetable" : (cbtOnly ? "CBT Examination Timetable" : "Examination Timetable"),
				session,
				semester,
				faculty: facultyInfo,
				department: departmentInfo,
				schoolName: "University of Lagos",
				mode: "exam",
				monochrome,
				groupByFaculty,
				paperSize: "a3",
				structured: true,
				gstOnly,
				isLocked,
			});

			addToast({
				type: "success",
				title: "PDF Exported",
				message: "Exam timetable downloaded (A3 structured).",
			});
			return;
		}

		// Default A4 PDF export (existing behavior)
		const blockedSlots = await apiClient
			.get(`/timetable/blocked-slots?semester_id=${selectedSemesterId}`)
			.catch(() => []);

		exportTimetablePDF({
			schedules: exportableSchedules,
			blockedSlots,
			rooms: cbtOnly ? state.rooms.filter(r => r.name?.toUpperCase().includes("CBT")) : state.rooms,
			faculties: state.faculties,
			departments: state.departments,
			enrollments: state.enrollments,
			title: gstOnly ? "General Studies Examination Timetable" : (cbtOnly ? "CBT Examination Timetable" : "Examination Timetable"),
			session,
			semester,
			faculty: facultyInfo,
			department: departmentInfo,
			schoolName: "University of Lagos",
			mode: "exam",
			monochrome,
			groupByFaculty,
			gstOnly,
			isLocked,
		});
		addToast({
			type: "success",
			title: "PDF Exported",
			message: "Exam timetable downloaded as PDF.",
		});
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
			/>
			<ExportModal
				isOpen={isExportModalOpen}
				onClose={() => setIsExportModalOpen(false)}
				onExport={handleExportConfirm}
				mode="exam"
				sessions={sessions}
				semesters={semesters}
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
