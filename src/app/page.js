"use client";

import styles from "./page.module.css";
import Link from "next/link";
import { useEffect, useState, useMemo } from "react";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { apiClient } from "@/lib/apiClient";
import { DashboardSkeleton } from "@/components/Skeleton/Skeleton";
import Landing from "@/components/Landing/Landing";
import { buildSchedulesWithDetails } from "@/lib/exportFilters";

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

// The dashboard's last figures, kept for the life of the tab. Coming back to
// the dashboard shows them at once and refreshes them in the background,
// instead of a skeleton every time. Keyed by account and realm (a realm switch
// or sign-in as someone else never shows another's figures).
let dashboardCache = null;

const toItem = (s) => ({
	...s,
	courseId: s.course_id,
	roomIds: s.room_ids,
	facultyId: s.faculty_id,
	day: s.day_of_week,
	startTime: s.start_time,
	endTime: s.end_time,
});

function getGreeting() {
	const h = new Date().getHours();
	if (h < 12) return "Good morning";
	if (h < 17) return "Good afternoon";
	return "Good evening";
}

function DashboardPage() {
	const { state, isInitialized, metadataLoading } = useApp();
	const { user } = useAuth();
	const cacheKey = `${user?.id ?? user?.email ?? ""}:${user?.realm ?? ""}`;
	const cached = dashboardCache?.key === cacheKey ? dashboardCache : null;
	const [currentTerm, setCurrentTerm] = useState(cached?.term ?? null);
	const [currentSession, setCurrentSession] = useState(cached?.session ?? null);
	// The dashboard's own copy: other pages replace the shared schedule items
	// with only lectures or only exams.
	const [scheduleItems, setScheduleItems] = useState(cached?.items ?? []);
	const [facultyOverviewType, setFacultyOverviewType] = useState('exams');
	const [roomCapacityFacultyId, setRoomCapacityFacultyId] = useState("all");
	const [loaded, setLoaded] = useState(!!cached);
	const getSchedulesWithDetails = useMemo(
		() => buildSchedulesWithDetails(scheduleItems, state),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[scheduleItems, state.courses, state.rooms, state.departments, state.faculties],
	);

	useEffect(() => {
		let mounted = true;
		async function loadDashboard() {
			try {
				// Only count the current semester's schedules: a new session
				// starts from zero instead of showing earlier sessions' items.
				const [semester, sessions] = await Promise.all([
					apiClient.get("/calendar/semesters/current").catch(() => null),
					apiClient.get("/calendar/sessions").catch(() => []),
				]);
				const items = semester
					? await apiClient
							.get(`/timetable/schedule-items?semester_id=${semester.id}`)
							.catch(() => null)
					: [];
				if (!mounted) return;
				const active = (sessions || []).find((s) => s.is_current) || null;
				// A failed refresh keeps what is on screen rather than zeroing it.
				const nextItems = items ? items.map(toItem) : dashboardCache?.key === cacheKey ? dashboardCache.items : [];
				dashboardCache = { key: cacheKey, term: semester, session: active, items: nextItems };
				setScheduleItems(nextItems);
				setCurrentTerm(semester);
				setCurrentSession(active);
				setLoaded(true);
			} catch (e) {
				console.error("Dashboard sync error", e);
			}
		}
		loadDashboard();
		return () => {
			mounted = false;
		};
	}, [cacheKey]);

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

	// Room capacity by seats: total active/inactive seats, either across all
	// faculties or scoped to one selected faculty.
	const roomCapacity = useMemo(() => {
		const isAll = roomCapacityFacultyId === "all";
		const rooms = isAll
			? state.rooms.filter((r) => r.facultyId)
			: state.rooms.filter((r) => r.facultyId === roomCapacityFacultyId);
		let active = 0;
		let inactive = 0;
		rooms.forEach((r) => {
			active += r.active_seats ?? r.activeSeats ?? 0;
			inactive += r.inactive_seats ?? r.inactiveSeats ?? 0;
		});
		const total = active + inactive;
		return {
			active,
			inactive,
			total,
			isAll,
			pct: total > 0 ? ((active / total) * 100).toFixed(1) : "0.0",
		};
	}, [state.rooms, roomCapacityFacultyId]);

	// Distinct-course scheduling breakdown (by lecture vs exam), for the
	// current semester only. The schedule items are already the current
	// semester's; the courses are narrowed to the ones tagged for this
	// semester. Courses with no semester belong to neither semester, so they
	// are left out of the totals and reported separately; counting them in
	// both would make the two semesters add up to more than every course.
	const courseBreakdown = useMemo(() => {
		const semesterName = currentTerm?.name || null;
		// Old data stored "1" / "2" instead of the semester name.
		const legacy = { "1": "First Semester", "2": "Second Semester" };
		const semesterOf = (c) => {
			const s = (c.semester || "").trim();
			return legacy[s] || s;
		};
		const untagged = state.courses.filter((c) => !semesterOf(c)).length;
		const semesterCourseIds = new Set(
			state.courses
				.filter((c) => !semesterName || semesterOf(c) === semesterName)
				.map((c) => c.id),
		);
		const lectureIds = new Set();
		const examIds = new Set();
		scheduleItems.forEach((s) => {
			// Only this semester's courses, so scheduled + unscheduled === total.
			if (!semesterCourseIds.has(s.courseId)) return;
			if (s.type === "lecture") lectureIds.add(s.courseId);
			else if (s.type === "exam") examIds.add(s.courseId);
		});
		const scheduledIds = new Set([...lectureIds, ...examIds]);
		const total = semesterCourseIds.size;
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
			untagged: semesterName ? untagged : 0,
		};
	}, [scheduleItems, state.courses, currentTerm]);

	const firstName = user?.email?.split("@")[0]?.split(".")[0] || "there";
	const displayName = firstName.charAt(0).toUpperCase() + firstName.slice(1);

	// Courses, rooms and faculties come from the app's shared data, loaded once
	// per tab; wait for them so the first visit doesn't flash zeros.
	if (!loaded || (!isInitialized && metadataLoading)) return <DashboardSkeleton />;

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
							{courseBreakdown.untagged > 0 && (
								<p className={styles.breakdownCaption}>
									{courseBreakdown.untagged.toLocaleString()}{" "}
									{courseBreakdown.untagged === 1 ? "course has" : "courses have"} no
									semester set and {courseBreakdown.untagged === 1 ? "isn't" : "aren't"}{" "}
									counted. Set a semester on them in Courses.
								</p>
							)}
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
											{roomCapacity.isAll ? "All faculties" : "Faculty total"}
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

export default function HomePage() {
	const { user } = useAuth();
	if (!user) return <Landing />;
	return <DashboardPage />;
}
