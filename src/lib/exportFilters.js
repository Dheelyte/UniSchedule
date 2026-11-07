// Shared data shaping and filtering for timetable exports (lecture, exam, CBT).
import { isGeneralStudiesCourse, GENERAL_STUDIES_FACULTY } from './utils.js';

/** Map a raw /timetable/schedule-items row to the client's schedule item shape. */
export function toScheduleItem(s) {
	return {
		...s,
		courseId: s.course_id,
		roomIds: s.room_ids,
		facultyId: s.faculty_id,
		day: s.day_of_week,
		examDate: s.exam_date,
		startTime: s.start_time,
		endTime: s.end_time,
	};
}

/** Attach course, room, department and faculty details to schedule items. */
export function buildSchedulesWithDetails(scheduleItems, { courses = [], rooms = [], departments = [], faculties = [] }) {
	const courseMap = new Map(courses.map((c) => [c.id, c]));
	const roomMap = new Map(rooms.map((r) => [r.id, r]));
	const deptMap = new Map(departments.map((d) => [d.id, d]));
	const facMap = new Map(faculties.map((f) => [f.id, f]));

	return scheduleItems.map((item) => {
		const course = courseMap.get(item.courseId);
		const ids = item.roomIds || (item.roomId ? [item.roomId] : []);
		const resolvedRooms = ids.map((rid) => roomMap.get(rid)).filter(Boolean);
		const dept = course?.departmentId ? deptMap.get(course.departmentId) : null;
		const faculty = dept ? facMap.get(dept.facultyId) : null;
		const effFacId = item.facultyId || faculty?.id || null;
		const effFaculty = effFacId ? facMap.get(effFacId) : null;
		return {
			...item,
			roomIds: ids,
			courseCode: course?.code || 'N/A',
			courseTitle: course?.title || 'NIL',
			courseLecturers: course?.lecturers || [],
			courseLocations: course?.locations || [],
			courseLevel: course?.level ?? null,
			courseScope: course?.scope ?? null,
			courseDepartmentId: course?.departmentId ?? null,
			roomNames: item.is_online ? '🌐 Online' : (resolvedRooms.map((r) => r.name).join(', ') || 'NIL'),
			roomCapacity: item.is_online ? null : resolvedRooms.reduce((sum, r) => sum + (r.capacity || 0), 0),
			departmentId: dept?.id || null,
			departmentName: dept?.name || 'NIL',
			facultyId: effFacId,
			facultyName: effFaculty?.name || 'NIL',
			// Special faculties are exempt from conflict detection.
			isSpecialFaculty: !!(effFaculty?.is_special ?? effFaculty?.isSpecial),
		};
	});
}

const isAll = (v) => v === undefined || v === null || v === '' || v === 'ALL';

/**
 * Filter detailed schedules by the export modal's choices.
 *
 * A faculty/department/level timetable holds the courses that audience owns
 * (department + course level) and the courses its students are enrolled in
 * (course_enrollments department + level), so interfaculty courses show up
 * on the timetable of every department that takes them.
 *
 * Choosing the General Studies faculty (or gstOnly) selects GST/ENT courses,
 * which are university-wide; the department and level filters still apply.
 * GST/ENT courses are attributed to the General Studies faculty.
 */
export function filterSchedulesForExport(schedules, {
	facultyId = 'ALL',
	departmentId = 'ALL',
	level = 'ALL',
	gstOnly = false,
	cbtOnly = false,
	faculties = [],
	departments = [],
	courses = [],
	enrollmentsByCourse = new Map(),
} = {}) {
	const facId = isAll(facultyId) ? null : facultyId;
	const deptId = isAll(departmentId) ? null : Number(departmentId);
	const lvl = isAll(level) ? null : Number(level);

	const selectedFaculty = facId === null ? null : faculties.find((f) => f.id === facId);
	const gstFaculty = selectedFaculty?.name?.trim().toLowerCase() === GENERAL_STUDIES_FACULTY.toLowerCase();
	const gst = gstOnly || gstFaculty;

	const deptFaculty = new Map(departments.map((d) => [d.id, d.facultyId]));
	const courseById = new Map(courses.map((c) => [c.id, c]));

	// Does this audience (faculty/department/level) own or take the course?
	const matchesAudience = (s) => {
		const ownerDept = s.departmentId;
		const ownerMatches =
			(gst || facId === null || s.facultyId === facId) &&
			(deptId === null || ownerDept === deptId) &&
			(lvl === null || Number(s.courseLevel) === lvl);
		if (ownerMatches) return true;
		return (enrollmentsByCourse.get(s.courseId) || []).some((e) =>
			(gst || facId === null || deptFaculty.get(e.department_id) === facId) &&
			(deptId === null || e.department_id === deptId) &&
			(lvl === null || Number(e.level) === lvl),
		);
	};

	return schedules
		.filter((s) => {
			if (gst && !isGeneralStudiesCourse(s.courseCode)) return false;
			if (cbtOnly) {
				const course = courseById.get(s.courseId);
				if (!(course?.isCbtExam || course?.is_cbt_exam)) return false;
			}
			return matchesAudience(s);
		})
		.map((s) => (isGeneralStudiesCourse(s.courseCode) ? { ...s, facultyName: GENERAL_STUDIES_FACULTY } : s));
}
