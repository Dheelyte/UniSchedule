"use client";

import styles from "./page.module.css";
import Link from "next/link";
import { useEffect, useState, useMemo } from "react";
import { useApp, ACTION_TYPES } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { apiClient } from "@/lib/apiClient";
import { DashboardSkeleton } from "@/components/Skeleton/Skeleton";

const BAR_COLORS = [
	"#6366f1",
	"#0891b2",
	"#059669",
	"#d97706",
	"#db2777",
	"#2563eb",
	"#16a34a",
	"#ea580c",
];
// Circumference of the progress ring (2 * PI * r, r = 58)
const RING_CIRCUMFERENCE = 364.4;
const RING_LECTURE_COLOR = "#6366f1";
const RING_EXAM_COLOR = "#d97706";
const RING_ACTIVE_COLOR = "#059669";
const RING_INACTIVE_COLOR = "#d97706";

function getGreeting() {
	const h = new Date().getHours();
	if (h < 12) return "Good morning";
	if (h < 17) return "Good afternoon";
	return "Good evening";
}

export default function DashboardPage() {
	const { state, dispatch, isInitialized, getSchedulesWithDetails } = useApp();
	const { user } = useAuth();
	const [currentTerm, setCurrentTerm] = useState(null);
	const [currentSession, setCurrentSession] = useState(null);
	const [facultyOverviewType, setFacultyOverviewType] = useState('exams');
	const [roomCapacityFacultyId, setRoomCapacityFacultyId] = useState("all");
	const [loaded, setLoaded] = useState(false);

	useEffect(() => {
		let mounted = true;
		async function loadDashboard() {
			try {
				// {new changes...}
				if (isInitialized) {
					const [
						scheduleItems,
						semester,
						sessions,
					] = await Promise.all([
						apiClient.get("/timetable/schedule-items").catch(() => []),
						apiClient.get("/calendar/semesters/current").catch(() => null),
						apiClient.get("/calendar/sessions").catch(() => []),
					]);
					if (mounted) {
						dispatch({
							type: ACTION_TYPES.INIT_STATE,
							payload: {
								scheduleItems: (scheduleItems || []).map((s) => ({
									...s,
									courseId: s.course_id,
									roomIds: s.room_ids,
									facultyId: s.faculty_id,
									day: s.day_of_week,
									startTime: s.start_time,
									endTime: s.end_time,
								})),
							},
						});
						setCurrentTerm(semester);
						const active = (sessions || []).find((s) => s.is_current);
						setCurrentSession(active || null);
						setLoaded(true);
					}
				} else {
					const [
						faculties,
						departments,
						rooms,
						courses,
						scheduleItems,
						semester,
						sessions,
					] = await Promise.all([
						apiClient.get("/timetable/faculties").catch(() => []),
						apiClient.get("/timetable/departments").catch(() => []),
						apiClient.get("/timetable/rooms").catch(() => []),
						apiClient.get("/timetable/courses").catch(() => []),
						apiClient.get("/timetable/schedule-items").catch(() => []),
						apiClient.get("/calendar/semesters/current").catch(() => null),
						apiClient.get("/calendar/sessions").catch(() => []),
					]);
					if (mounted) {
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
									startTime: s.start_time,
									endTime: s.end_time,
								})),
							},
						});
						setCurrentTerm(semester);
						const active = (sessions || []).find((s) => s.is_current);
						setCurrentSession(active || null);
						setLoaded(true);
					}
				}
			} catch (e) {
				console.error("Dashboard sync error", e);
			}
		}
		loadDashboard();
		return () => {
			mounted = false;
		};
	}, [dispatch]);

	// Faculty distribution by schedule type
	const facultyOverviewDistribution = useMemo(() => {
		const map = {};
		state.faculties.forEach((f) => {
			map[f.id] = { id: f.id, name: f.name, lectures: 0, exams: 0 };
		});
		getSchedulesWithDetails.forEach((s) => {
			const facultyId = s.facultyId;
			if (!facultyId || !map[facultyId]) return;
			if (s.type === 'lecture') map[facultyId].lectures++;
			if (s.type === 'exam') map[facultyId].exams++;
		});
		return Object.values(map).sort(
			(a, b) => b[facultyOverviewType] - a[facultyOverviewType],
		);
	}, [state.faculties, getSchedulesWithDetails, facultyOverviewType]);

	const maxFacultySchedules = Math.max(
		1,
		...facultyOverviewDistribution.map((f) => f[facultyOverviewType]),
	);

	// Room count per faculty (for the horizontal bar chart)
	const roomsByFaculty = useMemo(() => {
		const map = {};
		state.faculties.forEach((f) => {
			map[f.id] = { id: f.id, name: f.name, rooms: 0 };
		});
		let unassigned = 0;
		state.rooms.forEach((r) => {
			if (r.facultyId && map[r.facultyId]) map[r.facultyId].rooms++;
			else unassigned++;
		});
		const rows = Object.values(map).sort((a, b) => b.rooms - a.rooms);
		if (unassigned > 0) {
			rows.push({ id: "__unassigned__", name: "Unassigned", rooms: unassigned });
		}
		return rows;
	}, [state.faculties, state.rooms]);

	const maxFacultyRooms = Math.max(
		1,
		...roomsByFaculty.map((f) => f.rooms),
	);

	// Room capacity by seats: for a specific faculty, the totals of active/inactive
	// seats; for "all", the average active/inactive seats per faculty.
	const roomCapacity = useMemo(() => {
		const isAll = roomCapacityFacultyId === "all";
		const rooms = isAll
			? state.rooms.filter((r) => r.facultyId)
			: state.rooms.filter((r) => r.facultyId === roomCapacityFacultyId);
		let totalActive = 0;
		let totalInactive = 0;
		const facultySet = new Set();
		rooms.forEach((r) => {
			totalActive += r.active_seats ?? r.activeSeats ?? 0;
			totalInactive += r.inactive_seats ?? r.inactiveSeats ?? 0;
			if (r.facultyId) facultySet.add(r.facultyId);
		});
		const facCount = Math.max(1, facultySet.size);
		const active = isAll ? Math.round(totalActive / facCount) : totalActive;
		const inactive = isAll ? Math.round(totalInactive / facCount) : totalInactive;
		const total = active + inactive;
		return {
			active,
			inactive,
			total,
			isAverage: isAll,
			pct: total > 0 ? Math.round((active / total) * 100) : 0,
		};
	}, [state.rooms, roomCapacityFacultyId]);

	// Distinct-course scheduling breakdown (by lecture vs exam)
	const courseBreakdown = useMemo(() => {
		const lectureIds = new Set();
		const examIds = new Set();
		state.scheduleItems.forEach((s) => {
			if (s.type === "lecture") lectureIds.add(s.courseId);
			else if (s.type === "exam") examIds.add(s.courseId);
		});
		const scheduledIds = new Set([...lectureIds, ...examIds]);
		const total = state.courses.length;
		const scheduled = scheduledIds.size;
		// Courses with an exam but no lecture — keeps the segmented ring
		// arcs additive (a course counted in both is shown once, as a lecture)
		let examOnly = 0;
		examIds.forEach((id) => {
			if (!lectureIds.has(id)) examOnly++;
		});
		return {
			total,
			scheduled,
			unscheduled: Math.max(0, total - scheduled),
			pct: total > 0 ? Math.round((scheduled / total) * 100) : 0,
			lectureCount: lectureIds.size,
			examCount: examIds.size,
			examOnly,
			// Per-timetable breakdown. A course counts as unscheduled for a given
			// timetable when it has no entry of that type — measured against all
			// courses, so scheduled + unscheduled === total on each row.
			lectureUnscheduled: Math.max(0, total - lectureIds.size),
			examUnscheduled: Math.max(0, total - examIds.size),
		};
	}, [state.scheduleItems, state.courses]);

	const firstName = user?.email?.split("@")[0]?.split(".")[0] || "there";
	const displayName = firstName.charAt(0).toUpperCase() + firstName.slice(1);

	if (!loaded) return <DashboardSkeleton />;

	return (
		<div className={styles.dashboard}>
			{/* Welcome + Term Badge */}
			<div className={styles.welcomeHeader}>
				<div className={styles.welcomeLeft}>
					<h1>
						{getGreeting()}, {displayName} 👋
					</h1>
				</div>
				{currentSession && currentTerm && (
					<div className={styles.termBadge}>
						{currentSession.name} - {currentTerm.name}
					</div>
				)}
			</div>

			{/* Scheduling Progress + Room Utilization */}
			<div className={styles.contentGrid}>
				{/* Scheduling Progress */}
				<div className={styles.panel}>
					<div className={styles.panelHeader}>
						<span className={styles.panelTitle}>
							<svg
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round">
								<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
								<polyline points="22 4 12 14.01 9 11.01" />
							</svg>
							Scheduling Progress
						</span>
					</div>
					<div className={styles.panelBody}>
						<div style={{ textAlign: "center", padding: "8px 0 20px" }}>
							<div
								style={{
									position: "relative",
									width: "140px",
									height: "140px",
									margin: "0 auto 16px",
								}}>
								<svg viewBox="0 0 140 140" width="140" height="140">
									<circle
										cx="70"
										cy="70"
										r="58"
										fill="none"
										stroke="var(--color-border)"
										strokeWidth="10"
									/>
									{/* Lecture-scheduled courses */}
									<circle
										cx="70"
										cy="70"
										r="58"
										fill="none"
										stroke={RING_LECTURE_COLOR}
										strokeWidth="10"
										strokeDasharray={`${
											(courseBreakdown.lectureCount /
												Math.max(1, courseBreakdown.total)) *
											RING_CIRCUMFERENCE
										} ${RING_CIRCUMFERENCE}`}
										transform="rotate(-90 70 70)"
										style={{ transition: "stroke-dasharray 1s ease" }}
									/>
									{/* Exam-only courses (no lecture) */}
									<circle
										cx="70"
										cy="70"
										r="58"
										fill="none"
										stroke={RING_EXAM_COLOR}
										strokeWidth="10"
										strokeDasharray={`${
											(courseBreakdown.examOnly /
												Math.max(1, courseBreakdown.total)) *
											RING_CIRCUMFERENCE
										} ${RING_CIRCUMFERENCE}`}
										strokeDashoffset={`${
											-(
												courseBreakdown.lectureCount /
												Math.max(1, courseBreakdown.total)
											) * RING_CIRCUMFERENCE
										}`}
										transform="rotate(-90 70 70)"
										style={{ transition: "stroke-dasharray 1s ease" }}
									/>
								</svg>
								<div
									style={{
										position: "absolute",
										inset: 0,
										display: "flex",
										flexDirection: "column",
										alignItems: "center",
										justifyContent: "center",
									}}>
									<span
										style={{
											fontSize: "1.8rem",
											fontWeight: 800,
											color: "var(--color-text)",
											lineHeight: 1,
										}}>
										{courseBreakdown.pct}%
									</span>
									<span
										style={{
											fontSize: "0.72rem",
											color: "var(--color-text-muted)",
											fontWeight: 500,
										}}>
										Scheduled
									</span>
								</div>
							</div>

							<div
								style={{
									display: "flex",
									justifyContent: "center",
									gap: "20px",
									marginBottom: "14px",
									fontSize: "0.75rem",
									color: "var(--color-text-muted)",
								}}>
								<span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
									<span
										style={{
											width: "9px",
											height: "9px",
											borderRadius: "50%",
											background: RING_LECTURE_COLOR,
										}}
									/>
									Lectures {courseBreakdown.lectureCount}
								</span>
								<span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
									<span
										style={{
											width: "9px",
											height: "9px",
											borderRadius: "50%",
											background: RING_EXAM_COLOR,
										}}
									/>
									Exams {courseBreakdown.examCount}
								</span>
							</div>

							{/* <div
								style={{
									display: "flex",
									justifyContent: "center",
									gap: "32px",
								}}>
								<div>
									<div style={{ fontSize: "1.3rem", fontWeight: 700, color: "#059669" }}>
										{courseBreakdown.scheduled}
									</div>
									<div
										style={{
											fontSize: "0.72rem",
											color: "var(--color-text-muted)",
											fontWeight: 500,
										}}>
										Scheduled
									</div>
								</div>
								<div>
									<div style={{ fontSize: "1.3rem", fontWeight: 700, color: "#d97706" }}>
										{courseBreakdown.unscheduled}
									</div>
									<div
										style={{
											fontSize: "0.72rem",
											color: "var(--color-text-muted)",
											fontWeight: 500,
										}}>
										Unscheduled
									</div>
								</div>
								<div>
									<div
										style={{
											fontSize: "1.3rem",
											fontWeight: 700,
											color: "var(--color-text)",
										}}>
										{courseBreakdown.total}
									</div>
									<div
										style={{
											fontSize: "0.72rem",
											color: "var(--color-text-muted)",
											fontWeight: 500,
										}}>
										Total
									</div>
								</div>
							</div> */}
						</div>
						{/* Per-timetable breakdown: scheduled / unscheduled / total */}
						<div className={styles.breakdown}>
							{[
								{
									key: "exams",
									label: "Exam timetable",
									color: RING_EXAM_COLOR,
									scheduled: courseBreakdown.examCount,
									unscheduled: courseBreakdown.examUnscheduled,
								},
								{
									key: "lectures",
									label: "Lecture timetable",
									color: RING_LECTURE_COLOR,
									scheduled: courseBreakdown.lectureCount,
									unscheduled: courseBreakdown.lectureUnscheduled,
								}
							].map((row) => (
								<div key={row.key} className={styles.breakdownRow}>
									<span className={styles.breakdownLabel}>
										<span
											className={styles.breakdownDot}
											style={{ background: row.color }}
										/>
										{row.label}
									</span>
									<span className={styles.breakdownStat}>
										<span className={`${styles.breakdownValue} ${styles.breakdownScheduled}`}>
											{row.scheduled}
										</span>
										<span className={styles.breakdownCaption}>Scheduled</span>
									</span>
									<span className={styles.breakdownStat}>
										<span className={`${styles.breakdownValue} ${styles.breakdownUnscheduled}`}>
											{row.unscheduled}
										</span>
										<span className={styles.breakdownCaption}>Unscheduled</span>
									</span>
									<span className={styles.breakdownStat}>
										<span className={`${styles.breakdownValue} ${styles.breakdownTotal}`}>
											{courseBreakdown.total}
										</span>
										<span className={styles.breakdownCaption}>Total</span>
									</span>
								</div>
							))}
						</div>
					</div>
				</div>

				{/* Room Capacity */}
				<div className={styles.panel}>
					<div className={styles.panelHeader}>
						<span className={styles.panelTitle}>
							<svg
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round">
								<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
								<polyline points="9 22 9 12 15 12 15 22" />
							</svg>
							Room Capacity
						</span>
						<div className={styles.panelHeaderActions}>
							<select
								className={styles.panelHeaderSelect}
								value={roomCapacityFacultyId}
								onChange={(e) => setRoomCapacityFacultyId(e.target.value)}>
								<option value="all">All Faculties</option>
								{state.faculties.map((f) => (
									<option key={f.id} value={f.id}>
										{f.name}
									</option>
								))}
							</select>
						</div>
						<Link href="/rooms" className={styles.panelLink}>
							All Rooms →
						</Link>
					</div>
					<div className={styles.panelBody}>
						{roomCapacity.total === 0 ? (
							<div className={styles.emptyState}>
								<div className={styles.emptyIcon}>🏠</div>
								No rooms registered yet.
							</div>
						) : (
							<>
								<div style={{ textAlign: "center", padding: "8px 0 20px" }}>
									<div
										style={{
											position: "relative",
											width: "140px",
											height: "140px",
											margin: "0 auto 16px",
										}}>
										<svg viewBox="0 0 140 140" width="140" height="140">
											<circle
												cx="70"
												cy="70"
												r="58"
												fill="none"
												stroke="var(--color-border)"
												strokeWidth="10"
											/>
											<circle
												cx="70"
												cy="70"
												r="58"
												fill="none"
												stroke={RING_ACTIVE_COLOR}
												strokeWidth="10"
												strokeDasharray={`${
													(roomCapacity.active / Math.max(1, roomCapacity.total)) *
													RING_CIRCUMFERENCE
												} ${RING_CIRCUMFERENCE}`}
												transform="rotate(-90 70 70)"
												style={{ transition: "stroke-dasharray 1s ease" }}
											/>
										</svg>
										<div
											style={{
												position: "absolute",
												inset: 0,
												display: "flex",
												flexDirection: "column",
												alignItems: "center",
												justifyContent: "center",
											}}>
											<span
												style={{
													fontSize: "1.8rem",
													fontWeight: 800,
													color: "var(--color-text)",
													lineHeight: 1,
												}}>
												{roomCapacity.pct}%
											</span>
											<span
												style={{
													fontSize: "0.72rem",
													color: "var(--color-text-muted)",
													fontWeight: 500,
												}}>
												Active
											</span>
										</div>
									</div>

									<div
										style={{
											display: "flex",
											justifyContent: "center",
											gap: "20px",
											fontSize: "0.75rem",
											color: "var(--color-text-muted)",
										}}>
										<span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
											<span
												style={{
													width: "9px",
													height: "9px",
													borderRadius: "50%",
													background: RING_ACTIVE_COLOR,
												}}
											/>
											Active {roomCapacity.active}
										</span>
										<span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
											<span
												style={{
													width: "9px",
													height: "9px",
													borderRadius: "50%",
													background: RING_INACTIVE_COLOR,
												}}
											/>
											Inactive {roomCapacity.inactive}
										</span>
									</div>
								</div>
								<div className={styles.breakdown}>
									<div className={styles.breakdownRow}>
										<span className={styles.breakdownLabel}>
											<span
												className={styles.breakdownDot}
												style={{ background: RING_ACTIVE_COLOR }}
											/>
											{roomCapacity.isAverage ? "Average / faculty" : "Faculty total"}
										</span>
										<span className={styles.breakdownStat}>
											<span className={`${styles.breakdownValue} ${styles.breakdownScheduled}`}>
												{roomCapacity.active}
											</span>
											<span className={styles.breakdownCaption}>Active</span>
										</span>
										<span className={styles.breakdownStat}>
											<span className={`${styles.breakdownValue} ${styles.breakdownUnscheduled}`}>
												{roomCapacity.inactive}
											</span>
											<span className={styles.breakdownCaption}>Inactive</span>
										</span>
										<span className={styles.breakdownStat}>
											<span className={`${styles.breakdownValue} ${styles.breakdownTotal}`}>
												{roomCapacity.total}
											</span>
											<span className={styles.breakdownCaption}>Total</span>
										</span>
									</div>
								</div>
							</>
						)}
					</div>
				</div>
			</div>

			{/* Bottom: Faculty Overview + Rooms by faculty */}
			<div className={styles.contentGrid}>
				{/* Faculty Distribution */}
				<div className={styles.panel}>
					<div className={styles.panelHeader}>
							<span className={styles.panelTitle}>
								<svg
								width="24"
								height="24"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round">
								<path d="M3 11L12 4l9 7" />
								<path d="M4 12v7a2 2 0 0 0 2 2h4v-6h4v6h4a2 2 0 0 0 2-2v-7" />
							</svg>
								Overview
							</span>
						<div className={styles.panelHeaderActions}>
							<button
								type="button"
								className={`${styles.panelHeaderButton} ${
									facultyOverviewType === 'exams' ? styles.activePanelButton : ''
								}`}
								onClick={() => setFacultyOverviewType('exams')}>
								Exams
							</button>
							<button
								type="button"
								className={`${styles.panelHeaderButton} ${
									facultyOverviewType === 'lectures' ? styles.activePanelButton : ''
								}`}
								onClick={() => setFacultyOverviewType('lectures')}>
								Lectures
							</button>
						</div>
						<Link href="/faculties" className={styles.panelLink}>
							Manage →
						</Link>
					</div>
					<div className={styles.panelBody}>
						{state.faculties.length === 0 ? (
							<div className={styles.emptyState}>
								<div className={styles.emptyIcon}>🏛️</div>
								No faculties registered yet.
							</div>
						) : (
							<div className={styles.facultyList}>
								{facultyOverviewDistribution.map((f, i) => (
									<div key={f.id} className={styles.facultyRow}>
										<span className={styles.facultyName} title={f.name}>
											{f.name}
										</span>
										<div className={styles.facultyBarTrack}>
											<div
												className={styles.facultyBarFill}
												style={{
													width: `${(f[facultyOverviewType] / maxFacultySchedules) * 100}%`,
													background: BAR_COLORS[i % BAR_COLORS.length],
												}}
											/>
										</div>
										<span className={styles.facultyCount}>{f[facultyOverviewType]}</span>
									</div>
								))}
							</div>
						)}
					</div>
				</div>
				{/* Rooms by faculty */}
				<div className={styles.panel}>
					<div className={styles.panelHeader}>
						<span className={styles.panelTitle}>
							<svg
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round">
								<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
								<polyline points="9 22 9 12 15 12 15 22" />
							</svg>
							Rooms by Faculty
						</span>
						<Link href="/rooms" className={styles.panelLink}>
							All Rooms →
						</Link>
					</div>
					<div className={styles.panelBody}>
						{roomsByFaculty.length === 0 ? (
							<div className={styles.emptyState}>
								<div className={styles.emptyIcon}>🏠</div>
								No rooms registered yet.
							</div>
						) : (
							<div className={styles.facultyList}>
								{roomsByFaculty.map((f, i) => (
									<div key={f.id} className={styles.facultyRow}>
										<span className={styles.facultyName} title={f.name}>
											{f.name}
										</span>
										<div className={styles.facultyBarTrack}>
											<div
												className={styles.facultyBarFill}
												style={{
													width: `${(f.rooms / maxFacultyRooms) * 100}%`,
													background: BAR_COLORS[i % BAR_COLORS.length],
												}}
											/>
										</div>
										<span className={styles.facultyCount}>{f.rooms}</span>
									</div>
								))}
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
