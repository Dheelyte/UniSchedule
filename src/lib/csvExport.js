export function exportTimetableCSV({
  schedules,
  title,
  session,
  semester,
  faculty,
  mode,
}) {
  if (!schedules || schedules.length === 0) return;

  const headers =
    mode === "exam"
      ? ["Date", "Day", "Start Time", "End Time", "Room(s)", "Course Code", "Course Title", "Department", "Faculty", "Invigilators"]
      : ["Day", "Start Time", "End Time", "Room(s)", "Course Code", "Course Title", "Department", "Faculty", "Lecturers"];

  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  // Parse YYYY-MM-DD without timezone shift (same approach as pdfExport)
  const parseLocalDate = (ds) => {
    if (!ds) return null;
    const [y, m, d] = ds.split("-").map(Number);
    return new Date(y, m - 1, d);
  };

  const sorted = [...schedules].sort((a, b) => {
    if (mode === "exam") {
      if (a.examDate < b.examDate) return -1;
      if (a.examDate > b.examDate) return 1;
    } else {
      const dayDiff = DAYS.indexOf(a.day) - DAYS.indexOf(b.day);
      if (dayDiff !== 0) return dayDiff;
    }
    return (a.startTime || "").localeCompare(b.startTime || "");
  });

  const rows = sorted.map((s) => {
    const lecturers = (s.courseLecturers || []).join("; ");
    if (mode === "exam") {
      const dateObj = parseLocalDate(s.examDate);
      const dateStr = dateObj
        ? dateObj.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
        : "";
      const dayStr = dateObj
        ? dateObj.toLocaleDateString("en-GB", { weekday: "long" })
        : "";
      return [dateStr, dayStr, s.startTime, s.endTime, s.roomNames, s.courseCode, s.courseTitle, s.departmentName, s.facultyName, lecturers];
    }
    return [s.day, s.startTime, s.endTime, s.roomNames, s.courseCode, s.courseTitle, s.departmentName, s.facultyName, lecturers];
  });

  const escape = (val) => {
    const str = val == null ? "" : String(val);
    return str.includes(",") || str.includes('"') || str.includes("\n")
      ? `"${str.replace(/"/g, '""')}"`
      : str;
  };

  const metaLines = [
    "University of Lagos",
    [session, semester, faculty].filter(Boolean).join(" · "),
    title,
    `Generated: ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`,
    "",
  ].map((line) => escape(line));

  const csvContent = [
    ...metaLines,
    headers.map(escape).join(","),
    ...rows.map((row) => row.map(escape).join(",")),
  ].join("\n");

  // ﻿ BOM ensures Excel reads UTF-8 correctly
  const blob = new Blob(["﻿" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.replace(/\s+/g, "_").toLowerCase()}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}
