import { useState, useEffect } from "react";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { dailyLayoutsFor } from "@/lib/timetableLayout";
import styles from "./ExportModal.module.css";

export default function ExportModal({
	isOpen,
	onClose,
	onExport,
	mode,
	sessions = [],
	semesters = [],
	// Semester shown on the page; the export defaults to it.
	defaultSemesterId = null,
	// CBT page: every export is already CBT-only, so hide the exam toggles.
	showExamToggles = mode === "exam",
}) {
	const { state } = useApp();
	const { realm, realmConfig } = useAuth();
	const fallbackSemester = realmConfig.semester_names[0];

	// Default values
	const [session, setSession] = useState("");
	const [semester, setSemester] = useState(fallbackSemester);
	// Semester rows can share a name across sessions, so pick by id.
	const [semesterId, setSemesterId] = useState(null);
	const [facultyId, setFacultyId] = useState("ALL");
	const [departmentId, setDepartmentId] = useState("ALL");
	const [level, setLevel] = useState("ALL");
	const [paperSize, setPaperSize] = useState("a3");
	const [monochrome, setMonochrome] = useState(true);
	const [cbtOnly, setCbtOnly] = useState(false);
	const [gstOnly, setGstOnly] = useState(false);
	const [layout, setLayout] = useState("standard");

	useEffect(() => {
		if (isOpen) {
			// Default to the semester on screen, else the current one, else the first.
			const initialSem =
				semesters.find((s) => s.id === defaultSemesterId) ||
				semesters.find((s) => s.is_current) ||
				semesters[0];
			const currentSession = sessions.find((s) => s.is_current) || sessions[0];
			setSession(initialSem?.sessionName || currentSession?.name || "");
			setSemesterId(initialSem ? initialSem.id : null);
			setSemester(initialSem ? initialSem.name : fallbackSemester);
			
			setFacultyId("ALL");
			setDepartmentId("ALL");
			setLevel("ALL");
			setPaperSize("a3");
			setMonochrome(true);
			setCbtOnly(false);
			setGstOnly(false);
			setLayout("standard");
		}
	}, [isOpen, sessions, semesters, fallbackSemester, defaultSemesterId]);

	if (!isOpen) return null;

	const availableDepartments =
		facultyId === "ALL"
			? state.departments
			: state.departments.filter((d) => d.facultyId === facultyId);

	const sessionSemesters = semesters.filter((s) => !session || s.sessionName === session);

	const changeSession = (name) => {
		setSession(name);
		const sems = semesters.filter((s) => s.sessionName === name);
		const next = sems.find((s) => s.is_current) || sems[0];
		setSemesterId(next ? next.id : null);
		setSemester(next ? next.name : fallbackSemester);
	};

	const changeSemester = (value) => {
		if (semesters.length === 0) {
			setSemester(value);
			return;
		}
		const sem = semesters.find((s) => String(s.id) === value);
		setSemesterId(sem ? sem.id : null);
		setSemester(sem ? sem.name : "");
	};

	const submit = (format) => {
		onExport({
			session,
			semester,
			semesterId,
			facultyId,
			departmentId,
			level,
			format,
			monochrome,
			paperSize,
			cbtOnly,
			gstOnly,
			layout: mode === "lecture" ? layout : "standard",
		});
	};

	const handleSubmit = (e) => {
		e.preventDefault();
		submit("pdf");
	};

	return (
		<>
			<div className={styles.overlay} onClick={onClose} />
			<div className={styles.modal}>
				<div className={styles.header}>
					<h3 className={styles.title}>
						Export {mode === "lecture" ? "Lecture" : "Exam"} Timetable
					</h3>
					<button
						className={styles.closeBtn}
						onClick={onClose}
						aria-label="Close">
						✕
					</button>
				</div>

				<form className={styles.body} onSubmit={handleSubmit}>
					<div className={styles.formGroup}>
						<label className={styles.label}>Academic Session</label>
						{sessions.length > 0 ? (
							<select
								className={styles.input}
								value={session}
								onChange={(e) => changeSession(e.target.value)}
								required>
								{sessions.map((s) => (
									<option key={s.id} value={s.name}>
										{s.name}
										{s.is_current ? " (Current)" : ""}
									</option>
								))}
							</select>
						) : (
							<input
								type="text"
								className={styles.input}
								value={session}
								onChange={(e) => setSession(e.target.value)}
								placeholder="e.g. 2025/2026"
								required
							/>
						)}
					</div>

					<div className={styles.formGroup}>
						<label className={styles.label}>Semester</label>
						<select
							className={styles.input}
							value={semesters.length > 0 ? String(semesterId ?? "") : semester}
							onChange={(e) => changeSemester(e.target.value)}
							required>
							{semesters.length > 0 ? (
								sessionSemesters.length === 0 ? (
									<option value="">No semesters in this session</option>
								) : (
									sessionSemesters.map((s) => (
										<option key={s.id} value={String(s.id)}>
											{s.name}
											{s.is_current ? " (Current)" : ""}
										</option>
									))
								)
							) : (
								realmConfig.semester_names.map((name) => (
									<option key={name} value={name}>
										{name}
									</option>
								))
							)}
						</select>
					</div>

					<div className={styles.formGroup}>
						<label className={styles.label}>Faculty Filter</label>
						<select
							className={styles.input}
							value={facultyId}
							onChange={(e) => {
								setFacultyId(e.target.value);
								setDepartmentId("ALL");
							}}>
							<option value="ALL">All Faculties</option>
							{state.faculties.map((f) => (
								<option key={f.id} value={f.id}>
									{f.name}
								</option>
							))}
						</select>
					</div>

					<div className={styles.formGroup}>
						<label className={styles.label}>Department Filter</label>
						<select
							className={styles.input}
							value={departmentId}
							onChange={(e) => setDepartmentId(e.target.value)}>
							<option value="ALL">All Departments</option>
							{availableDepartments.map((d) => (
								<option key={d.id} value={d.id}>
									{d.name}
								</option>
							))}
						</select>
					</div>

					<div className={styles.formGroup}>
						<label className={styles.label}>Level Filter</label>
						<select
							className={styles.input}
							value={level}
							onChange={(e) => setLevel(e.target.value)}>
							<option value="ALL">All Levels</option>
							{realmConfig.levels.map((lvl) => (
								<option key={lvl} value={lvl}>
									Level {lvl}
								</option>
							))}
						</select>
					</div>

					{mode === "lecture" && (
						<div className={styles.formGroup}>
							<label className={styles.label}>Layout (PDF)</label>
							<select
								className={styles.input}
								value={layout}
								onChange={(e) => setLayout(e.target.value)}>
								<option value="standard">Standard week grid (default)</option>
								{dailyLayoutsFor(realm).map((f) => (
									<option key={f.key} value={f.key}>
										{f.label}
									</option>
								))}
							</select>
						</div>
					)}

					<div className={styles.formGroup}>
						<label className={styles.label}>Format</label>
						<select
							className={styles.input}
							value={paperSize}
							onChange={(e) => setPaperSize(e.target.value)}>
							<option value="a3">a3 - landscape (default)</option>
							<option value="a4">a4 - landscape</option>
						</select>
					</div>

					<div className={styles.formGroup}>
						<label className={styles.checkboxLabel}>
							<input
								type="checkbox"
								checked={!monochrome}
								onChange={(e) => setMonochrome(!e.target.checked)}
							/>
							Include colors - PDF only (default is black &amp; white)
						</label>
					</div>

					{showExamToggles && (
						<>
							<div className={styles.formGroup}>
								<label className={styles.checkboxLabel}>
									<input
										type="checkbox"
										checked={cbtOnly}
										onChange={(e) => setCbtOnly(e.target.checked)}
									/>
									CBT exams only
								</label>
							</div>
							<div className={styles.formGroup}>
								<label className={styles.checkboxLabel}>
									<input
										type="checkbox"
										checked={gstOnly}
										onChange={(e) => setGstOnly(e.target.checked)}
									/>
									General Studies (GST) exams only
								</label>
							</div>
						</>
					)}

					<div className={styles.footer}>
						<button
							type="button"
							className={`btn btn-secondary ${styles.btn}`}
							onClick={() => submit("csv")}>
							Download CSV
						</button>
						<button type="submit" className={`btn btn-primary ${styles.btn}`}>
							Download PDF
						</button>
					</div>
				</form>
			</div>
		</>
	);
}
