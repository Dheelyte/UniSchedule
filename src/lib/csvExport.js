import { GENERAL_STUDIES_FACULTY } from "./utils";

export function exportTimetableCSV({
  schedules,
  title,
  session,
  semester,
  faculty,
  mode,
  groupByFaculty = false,
}) {
  if (!schedules || schedules.length === 0) return;

  // Order faculties for grouping: General Studies first, then alphabetical.
  const orderedFaculties = [...new Set(schedules.map((s) => s.facultyName || "Unassigned"))].sort((a, b) => {
    if (a === GENERAL_STUDIES_FACULTY) return -1;
    if (b === GENERAL_STUDIES_FACULTY) return 1;
    return a.localeCompare(b);
  });
  const facultyRank = (name) => orderedFaculties.indexOf(name || "Unassigned");

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
    if (groupByFaculty) {
      const facDiff = facultyRank(a.facultyName) - facultyRank(b.facultyName);
      if (facDiff !== 0) return facDiff;
    }
    if (mode === "exam") {
      if (a.examDate < b.examDate) return -1;
      if (a.examDate > b.examDate) return 1;
    } else {
      const dayDiff = DAYS.indexOf(a.day) - DAYS.indexOf(b.day);
      if (dayDiff !== 0) return dayDiff;
    }
    return (a.startTime || "").localeCompare(b.startTime || "");
  });

  const toRow = (s) => {
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
  };

  const escape = (val) => {
    const str = val == null ? "" : String(val);
    return str.includes(",") || str.includes('"') || str.includes("\n")
      ? `"${str.replace(/"/g, '""')}"`
      : str;
  };
  const toLine = (row) => row.map(escape).join(",");

  // Body: optionally split into per-faculty sections, each with its own header row.
  const bodyLines = [];
  if (groupByFaculty) {
    let currentFaculty = null;
    sorted.forEach((s) => {
      const fac = s.facultyName || "Unassigned";
      if (fac !== currentFaculty) {
        if (currentFaculty !== null) bodyLines.push("");
        bodyLines.push(escape(`=== ${fac} ===`));
        bodyLines.push(toLine(headers));
        currentFaculty = fac;
      }
      bodyLines.push(toLine(toRow(s)));
    });
  } else {
    bodyLines.push(toLine(headers));
    sorted.forEach((s) => bodyLines.push(toLine(toRow(s))));
  }

  const metaLines = [
    "University of Lagos",
    [session, semester, faculty].filter(Boolean).join(" · "),
    title,
    `Generated: ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`,
    "",
  ].map((line) => escape(line));

  const csvContent = [
    ...metaLines,
    ...bodyLines,
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
