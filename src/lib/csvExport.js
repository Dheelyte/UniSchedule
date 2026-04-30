/**
 * CSV timetable export.
 *
 * Lecture columns: Day, Start, End, Course Code, Course Title, Lecturers, Rooms, Faculty, Department, Week
 * Exam columns:    Date, Day, Start, End, Course Code, Course Title, Lecturers, Rooms, Faculty, Department
 *
 * A small metadata block (title, session, semester, faculty, department filter) is written above the
 * table so the file is self-describing when opened in a spreadsheet.
 */
export function exportTimetableCSV({ schedules, title, session, semester, faculty, department, mode }) {
    if (!schedules || schedules.length === 0) return;

    const escape = (val) => {
        if (val === null || val === undefined) return '';
        const s = String(val);
        if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
    };
    const row = (cells) => cells.map(escape).join(',');

    const isExam = mode === 'exam';
    const ACTIVE_DAYS = isExam
        ? ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
        : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

    const sorted = [...schedules].sort((a, b) => {
        if (isExam) {
            const da = a.examDate || '';
            const db = b.examDate || '';
            if (da !== db) return da.localeCompare(db);
        } else {
            const ai = ACTIVE_DAYS.indexOf(a.day);
            const bi = ACTIVE_DAYS.indexOf(b.day);
            if (ai !== bi) return ai - bi;
        }
        return (a.startTime || '').localeCompare(b.startTime || '');
    });

    const header = isExam
        ? ['Date', 'Day', 'Start', 'End', 'Course Code', 'Course Title', 'Lecturers', 'Rooms', 'Faculty', 'Department']
        : ['Day', 'Start', 'End', 'Course Code', 'Course Title', 'Lecturers', 'Rooms', 'Faculty', 'Department', 'Week'];

    const dataRows = sorted.map((s) => {
        const lecturers = Array.isArray(s.courseLecturers) ? s.courseLecturers.join('; ') : '';
        if (isExam) {
            const dateObj = s.examDate ? new Date(s.examDate) : null;
            const dayName = dateObj ? dateObj.toLocaleDateString('en-GB', { weekday: 'long' }) : '';
            return row([
                s.examDate || '',
                dayName,
                s.startTime || '',
                s.endTime || '',
                s.courseCode || '',
                s.courseTitle || '',
                lecturers,
                s.roomNames || '',
                s.facultyName || '',
                s.departmentName || '',
            ]);
        }
        return row([
            s.day || '',
            s.startTime || '',
            s.endTime || '',
            s.courseCode || '',
            s.courseTitle || '',
            lecturers,
            s.roomNames || '',
            s.facultyName || '',
            s.departmentName || '',
            s.week || '',
        ]);
    });

    const meta = [
        row([title || (isExam ? 'Examination Timetable' : 'Lecture Timetable')]),
        session ? row([`Session: ${session}`]) : null,
        semester ? row([`Semester: ${semester}`]) : null,
        faculty ? row([`Faculty: ${faculty}`]) : null,
        department ? row([`Department: ${department}`]) : null,
        '',
    ].filter((line) => line !== null);

    const csv = [...meta, row(header), ...dataRows].join('\r\n');

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const fileName = `${(title || 'timetable').replace(/\s+/g, '_').toLowerCase()}_${new Date().toISOString().slice(0, 10)}.csv`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
