"use client";

import styles from "./page.module.css";
import Link from "next/link";
import { useEffect, useState, useMemo } from "react";
import { useApp, ACTION_TYPES } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { apiClient } from "@/lib/apiClient";
import { DashboardSkeleton } from "@/components/Skeleton/Skeleton";
import { isRoomActive } from "@/lib/utils";

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

function getGreeting() {
	const h = new Date().getHours();
	if (h < 12) return "Good morning";
	if (h < 17) return "Good afternoon";
	return "Good evening";
}

export default function DashboardPage() {
	const { state, stats, dispatch, isInitialized } = useApp();
	const { user } = useAuth();
	const [currentTerm, setCurrentTerm] = useState(null);
	const [currentSession, setCurrentSession] = useState(null);
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

	// Faculty distribution
	const facultyDistribution = useMemo(() => {
		const map = {};
		state.faculties.forEach((f) => {
			map[f.id] = { name: f.name, courses: 0, schedules: 0 };
		});
		const deptFacultyMap = {};
		state.departments.forEach((d) => {
			deptFacultyMap[d.id] = d.facultyId;
		});
		state.courses.forEach((c) => {
			const fId = deptFacultyMap[c.departmentId];
			if (fId && map[fId]) map[fId].courses++;
		});
		state.scheduleItems.forEach((s) => {
			if (s.facultyId && map[s.facultyId]) map[s.facultyId].schedules++;
		});
		return Object.entries(map)
			.map(([id, data]) => ({ id, ...data }))
			.sort((a, b) => b.courses - a.courses);
	}, [state]);

	const maxFacultyCourses = Math.max(
		1,
		...facultyDistribution.map((f) => f.courses),
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

	// Room utilization (top 8)
	const roomUtilization = useMemo(() => {
		const roomCountMap = {};
		state.scheduleItems.forEach((s) => {
			(s.roomIds || []).forEach((rid) => {
				roomCountMap[rid] = (roomCountMap[rid] || 0) + 1;
			});
		});
		return state.rooms
			.filter(isRoomActive)
			.map((r) => ({ ...r, sessions: roomCountMap[r.id] || 0 }))
			.sort((a, b) => b.sessions - a.sessions)
			.slice(0, 8);
	}, [state]);

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

			{/* Stats Grid */}
			<div className={styles.statsGrid}>
				{/* Course scheduling ring — spans the first two card slots */}
				<div className={`${styles.statCard} ${styles.ringCard}`}>
					<div className={styles.ringCardTitle}>Course Scheduling</div>
					<div>
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

							<div
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
							</div>
						</div>
					</div>
				</div>

				{/* Faculty overview — spans the remaining two card slots */}
				<div className={`${styles.statCard} ${styles.roomBarCard}`}>
					<div className={styles.ringCardTitle}>Faculty Overview</div>
					{facultyDistribution.length === 0 ? (
						<div className={styles.emptyState}>
							<div className={styles.emptyIcon}>🏛️</div>
							No faculties registered yet.
						</div>
					) : (
						<div className={styles.facultyList}>
							{facultyDistribution.map((f, i) => (
								<div key={f.id} className={styles.facultyRow}>
									<span className={styles.facultyName} title={f.name}>
										{f.name}
									</span>
									<div className={styles.facultyBarTrack}>
										<div
											className={styles.facultyBarFill}
											style={{
												width: `${(f.courses / maxFacultyCourses) * 100}%`,
												background: BAR_COLORS[i % BAR_COLORS.length],
											}}
										/>
									</div>
									<span className={styles.facultyCount}>{f.courses}</span>
								</div>
							))}
						</div>
					)}
				</div>
			</div>

			{/* Two-Column Content */}
			<div className={styles.contentGrid}>
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
				{/* Room Utilization */}
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
							Room Utilization
						</span>
						<Link href="/rooms" className={styles.panelLink}>
							All Rooms →
						</Link>
					</div>
					<div className={styles.panelBody}>
						{roomUtilization.length === 0 ? (
							<div className={styles.emptyState}>
								<div className={styles.emptyIcon}>🏠</div>
								No rooms registered yet.
							</div>
						) : (
							<div className={styles.roomGrid}>
								{roomUtilization.map((r) => (
									<div key={r.id} className={styles.roomTile}>
										<span className={styles.roomName} title={r.name}>
											{r.name}
										</span>
										<span
											className={`${styles.roomSessions} ${r.sessions === 0 ? styles.roomIdle : ""}`}>
											{r.sessions > 0 ? `${r.sessions} slots` : "Idle"}
										</span>
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
