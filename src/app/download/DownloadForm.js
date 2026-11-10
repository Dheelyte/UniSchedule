'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { unilagLogoBase64 } from '@/lib/logo';
import { dailyLayoutsFor } from '@/lib/timetableLayout';
import styles from './download.module.css';

// The site's own routes: they read the backend with its key and are cached.
async function getJson(url) {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url}: ${response.status}`);
	return response.json();
}

const KINDS = ['lecture', 'exam', 'cbt'];
const KIND_LABEL = { lecture: 'Lectures', exam: 'Exams', cbt: 'CBT exams' };
const unique = (values) => [...new Set(values)];

/** Each published timetable, plus a CBT entry for each published exam timetable. */
function downloadableEntries(published) {
	return published.flatMap((t) => {
		const base = { ...t, kind: t.timetable_type };
		return t.timetable_type === 'exam' ? [base, { ...t, kind: 'cbt' }] : [base];
	});
}

const entryKey = (e) => `${e.realm_key}:${e.semester_id}:${e.kind}`;

export default function DownloadForm() {
	const [published, setPublished] = useState(null); // null while loading
	const [loadError, setLoadError] = useState(false);
	const [session, setSession] = useState('');
	const [semester, setSemester] = useState('');
	const [kind, setKind] = useState('');
	const [realm, setRealm] = useState('');
	const [options, setOptions] = useState(null);
	const [optionsError, setOptionsError] = useState(false);
	const [faculty, setFaculty] = useState('ALL');
	const [department, setDepartment] = useState('ALL');
	const [level, setLevel] = useState('ALL');
	const [format, setFormat] = useState('pdf');
	const [paper, setPaper] = useState('a3');
	const [layout, setLayout] = useState('standard');

	useEffect(() => {
		getJson('/api/export/catalogue')
			.then((rows) => setPublished(downloadableEntries(rows || [])))
			.catch(() => { setPublished([]); setLoadError(true); });
	}, []);

	// Each choice narrows the next: session, semester, timetable, programme.
	const all = published || [];
	const sessions = unique(all.map((e) => e.session_name));
	const semesters = unique(all.filter((e) => e.session_name === session).map((e) => e.semester_name));
	const inSemester = all.filter((e) => e.session_name === session && e.semester_name === semester);
	const kinds = KINDS.filter((k) => inSemester.some((e) => e.kind === k));
	const forKind = inSemester.filter((e) => e.kind === kind);
	const realms = forKind.map((e) => ({ key: e.realm_key, name: e.realm_name }));
	const entry = forKind.find((e) => e.realm_key === realm) || null;

	// Keep every choice valid as the ones before it change, starting with the newest.
	useEffect(() => { if (sessions.length && !sessions.includes(session)) setSession(sessions[0]); }, [sessions, session]);
	useEffect(() => { if (semesters.length && !semesters.includes(semester)) setSemester(semesters[0]); }, [semesters, semester]);
	useEffect(() => { if (kinds.length && !kinds.includes(kind)) setKind(kinds[0]); }, [kinds, kind]);
	useEffect(() => {
		if (realms.length && !realms.some((r) => r.key === realm)) setRealm(realms[0].key);
	}, [realms, realm]);
	const entryId = entry ? entryKey(entry) : '';

	// The faculties, departments and levels this timetable has something for.
	useEffect(() => {
		if (!entry) return;
		let cancelled = false;
		setOptions(null);
		setOptionsError(false);
		setFaculty('ALL');
		setDepartment('ALL');
		setLevel('ALL');
		setLayout('standard');
		setPaper('a3');
		const q = new URLSearchParams({ realm: entry.realm_key, semester: String(entry.semester_id), type: entry.kind });
		getJson(`/api/export/options?${q}`)
			.then((o) => !cancelled && setOptions(o))
			.catch(() => !cancelled && setOptionsError(true));
		return () => { cancelled = true; };
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [entryId]);

	const departments = (options?.departments || []).filter((d) => faculty === 'ALL' || d.faculty_id === faculty);
	useEffect(() => {
		if (department !== 'ALL' && !departments.some((d) => String(d.id) === department)) setDepartment('ALL');
	}, [departments, department]);

	const href = useMemo(() => {
		if (!entry) return null;
		// In the order /api/export expects, defaults left out (it redirects anything else).
		const q = new URLSearchParams({ realm: entry.realm_key, semester: String(entry.semester_id), type: entry.kind });
		if (faculty !== 'ALL') q.set('faculty', faculty);
		if (department !== 'ALL') q.set('department', department);
		if (level !== 'ALL') q.set('level', level);
		if (format !== 'pdf') q.set('format', format);
		if (format === 'pdf') {
			if (paper !== 'a3') q.set('paper', paper);
			if (entry.kind === 'lecture' && layout !== 'standard') q.set('layout', layout);
		}
		if (entry.code) q.set('code', entry.code);
		return `/api/export?${q}`;
	}, [entry, faculty, department, level, format, paper, layout]);

	// The index of faculties covers every programme; CBT is listed in the exam index.
	const indexType = kind === 'lecture' ? 'lecture' : 'exam';
	const indexHref = session && semester && kind
		? `/api/export/faculties?${new URLSearchParams({ session, semester, type: indexType })}`
		: null;
	const indexRealms = unique(inSemester.filter((e) => e.kind === indexType).map((e) => e.realm_name));

	return (
		<main className={styles.shell}>
			<Link href="/" className={styles.brand}>
				{/* eslint-disable-next-line @next/next/no-img-element */}
				<img src={unilagLogoBase64} alt="" width="36" height="36" />
				<span>
					<strong>UniSchedule</strong>
					<small>University of Lagos · Timetables</small>
				</span>
			</Link>

			<section className={styles.card}>
				<h1 className={styles.heading}>Download a timetable</h1>
				<p className={styles.body}>
					Official FINAL timetables, signed and stamped. Pick what you need and download it as a PDF or a
					spreadsheet. No account needed.
				</p>

				{published === null && <p className={styles.muted}>Loading published timetables…</p>}
				{published !== null && published.length === 0 && (
					<p className={styles.notice}>
						{loadError
							? "The timetables couldn't be loaded. Check your connection and try again."
							: 'No timetables have been published yet. Check back once the timetable office releases them.'}
					</p>
				)}

				{all.length > 0 && (
					<div className={styles.form}>
						<div className={styles.row}>
							<label className={styles.field}>
								<span>Session</span>
								<select value={session} onChange={(e) => setSession(e.target.value)}>
									{sessions.map((v) => <option key={v} value={v}>{v}</option>)}
								</select>
							</label>
							<label className={styles.field}>
								<span>Semester</span>
								<select value={semester} onChange={(e) => setSemester(e.target.value)}>
									{semesters.map((v) => <option key={v} value={v}>{v}</option>)}
								</select>
							</label>
						</div>

						<div className={styles.segment} role="radiogroup" aria-label="Timetable">
							{kinds.map((k) => (
								<button
									key={k}
									type="button"
									role="radio"
									aria-checked={kind === k}
									className={kind === k ? styles.segmentOn : undefined}
									onClick={() => setKind(k)}
								>
									{KIND_LABEL[k]}
								</button>
							))}
						</div>

						{indexHref && (
							<div className={styles.index}>
								<div>
									<strong>All faculties</strong>
									<p>
										One PDF listing every faculty and unit
										{indexRealms.length > 1 ? ` in ${indexRealms.join(' and ')}` : ''}, each linking to its own timetable.
										{indexType === 'exam' ? ' Includes the CBT timetable.' : ''}
									</p>
								</div>
								<a className={styles.buttonSecondary} href={indexHref} download>Download index</a>
							</div>
						)}

						<h2 className={styles.subheading}>Or download one timetable</h2>

						{realms.length > 1 && (
							<label className={styles.field}>
								<span>Programme</span>
								<select value={realm} onChange={(e) => setRealm(e.target.value)}>
									{realms.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
								</select>
							</label>
						)}

						{optionsError && (
							<p className={styles.notice}>The filters couldn&apos;t be loaded. You can still download the whole timetable.</p>
						)}

						<div className={styles.row}>
							<label className={styles.field}>
								<span>Faculty</span>
								<select value={faculty} onChange={(e) => setFaculty(e.target.value)} disabled={!options}>
									<option value="ALL">All faculties</option>
									{(options?.faculties || []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
								</select>
							</label>
							<label className={styles.field}>
								<span>Department</span>
								<select value={department} onChange={(e) => setDepartment(e.target.value)} disabled={!options}>
									<option value="ALL">All departments</option>
									{departments.map((d) => <option key={d.id} value={String(d.id)}>{d.name}</option>)}
								</select>
							</label>
							<label className={styles.field}>
								<span>Level</span>
								<select value={level} onChange={(e) => setLevel(e.target.value)} disabled={!options}>
									<option value="ALL">All levels</option>
									{(options?.levels || []).map((l) => <option key={l} value={String(l)}>{l} Level</option>)}
								</select>
							</label>
						</div>

						<div className={styles.row}>
							<label className={styles.field}>
								<span>Format</span>
								<select value={format} onChange={(e) => setFormat(e.target.value)}>
									<option value="pdf">PDF</option>
									<option value="csv">Spreadsheet (CSV)</option>
								</select>
							</label>
							{format === 'pdf' && (
								<label className={styles.field}>
									<span>Paper</span>
									<select value={paper} onChange={(e) => setPaper(e.target.value)}>
										<option value="a3">A3</option>
										<option value="a4">A4</option>
									</select>
								</label>
							)}
							{format === 'pdf' && entry?.kind === 'lecture' && (
								<label className={styles.field}>
									<span>Layout</span>
									<select value={layout} onChange={(e) => setLayout(e.target.value)}>
										<option value="standard">Whole week</option>
										{dailyLayoutsFor(realm).map((f) => <option key={f.key} value={f.key}>One day per page</option>)}
									</select>
								</label>
							)}
						</div>

						{href && (
							<a className={styles.button} href={href} download>
								Download {format === 'csv' ? 'spreadsheet' : 'PDF'}
							</a>
						)}

						{entry?.code && (
							<p className={styles.small}>
								FINAL version <code className={styles.code}>{entry.code}</code> ·{' '}
								<Link href={`/verify/${entry.code}`}>check a printed copy</Link>
							</p>
						)}
					</div>
				)}
			</section>
		</main>
	);
}
