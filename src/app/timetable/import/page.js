'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { apiClient } from '@/lib/apiClient';
import { slimWorkbook } from '@/lib/slimWorkbook';
import { useToast } from '@/components/Toast/Toast';
import { useConfirm } from '@/components/ConfirmModal/ConfirmContext';
import { TablePageSkeleton } from '@/components/Skeleton/Skeleton';
import styles from './import.module.css';

// The largest file the page accepts, before its empty cells are dropped.
const MAX_FILE_MB = 10;
// The faculty choice that copies every faculty's timetable at once.
const ALL_FACULTIES = '*';
const EMPTY_ANSWERS = { courses: {}, venues: {}, faculties: {}, venue_column: null, exam_start_date: null, exam_year: null };
const FILTERS = [
    { value: 'all', label: 'All' },
    { value: 'blocking', label: "Can't schedule" },
    { value: 'warnings', label: 'Warnings' },
];

export default function ImportPage() {
    return (
        <Suspense fallback={<TablePageSkeleton columns={5} rows={8} />}>
            <TimetableImport />
        </Suspense>
    );
}

function TimetableImport() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { addToast } = useToast();
    const confirm = useConfirm();

    const [itemType, setItemType] = useState(searchParams.get('type') === 'exam' ? 'exam' : 'lecture');
    // Where the timetable comes from: a faculty's file, or an earlier semester on the platform.
    const [source, setSource] = useState(searchParams.get('source') === 'semester' ? 'semester' : 'file');
    const [sources, setSources] = useState(null);
    const [sourceSemesterId, setSourceSemesterId] = useState('');
    const [facultyId, setFacultyId] = useState('');
    const [mode, setMode] = useState('replace');
    const [placeAll, setPlaceAll] = useState(true);
    const [file, setFile] = useState(null); // { name, blob }
    const [sheet, setSheet] = useState(null);
    const [answers, setAnswers] = useState(EMPTY_ANSWERS);
    const [preview, setPreview] = useState(null);
    const [busy, setBusy] = useState(false);
    const [skipBlocked, setSkipBlocked] = useState(false);
    const [filter, setFilter] = useState('all');
    const [imported, setImported] = useState(null); // the last apply's result
    const [history, setHistory] = useState(null);
    const [reverting, setReverting] = useState(null);

    const [faculties, setFaculties] = useState([]);
    const [rooms, setRooms] = useState([]);
    const [courses, setCourses] = useState([]);

    const allowed = user?.role === 'SUPER_ADMIN';

    useEffect(() => {
        if (authLoading) return;
        if (!user) { router.push('/login'); return; }
        if (!allowed) {
            router.push('/');
            addToast({ type: 'error', title: 'Unauthorized', message: 'Only super admins can import timetables.' });
        }
    }, [authLoading, user, allowed]);

    useEffect(() => {
        if (!allowed) return;
        Promise.all([
            apiClient.get('/timetable/faculties'),
            apiClient.get('/timetable/rooms'),
            apiClient.get('/timetable/courses'),
        ]).then(([f, r, c]) => {
            setFaculties(f || []);
            setRooms(r || []);
            setCourses(c || []);
        }).catch((e) => addToast({ type: 'error', title: 'Error', message: e?.message || 'Failed to load faculties, rooms and courses.' }));
    }, [allowed]);

    useEffect(() => {
        if (!allowed || source !== 'semester' || sources) return;
        apiClient.get('/timetable-import/copy/sources').then((data) => {
            setSources(data);
            if (data?.suggested_id) setSourceSemesterId(String(data.suggested_id));
        }).catch((e) => addToast({ type: 'error', title: 'Error', message: e?.message || 'Failed to load earlier semesters.' }));
    }, [allowed, source, sources]);

    const copying = source === 'semester';
    // General Studies' lectures go into every faculty's timetable.
    const isGeneralStudies = !copying && /general studies/i.test(faculties.find((f) => f.id === facultyId)?.name || '');
    // General Studies places each lecture in every faculty, and each exam in the faculties its row names.
    const placeInFaculties = isGeneralStudies && placeAll;

    const roomName = useMemo(() => Object.fromEntries(rooms.map((r) => [r.id, r.name])), [rooms]);

    const options = useCallback((extra = {}) => ({
        faculty_id: facultyId === ALL_FACULTIES ? null : facultyId,
        item_type: itemType,
        mode,
        sheet,
        answers,
        place_in_faculties: placeInFaculties,
        source_semester_id: copying ? Number(sourceSemesterId) : null,
        ...extra,
    }), [facultyId, itemType, mode, sheet, answers, placeInFaculties, copying, sourceSemesterId]);

    const send = useCallback(async (action, extra) => {
        if (copying) return apiClient.post(`/timetable-import/copy/${action}`, options(extra));
        const form = new FormData();
        form.append('file', file.blob, file.name);
        form.append('options', JSON.stringify(options(extra)));
        return apiClient.postForm(`/timetable-import/${action}`, form);
    }, [file, options, copying]);

    const ready = copying ? Boolean(sourceSemesterId && facultyId) : Boolean(file && facultyId);
    const runPreview = useCallback(async () => {
        if (!ready) return;
        setBusy(true);
        try {
            setPreview(await send('preview'));
        } catch (e) {
            addToast({ type: 'error', title: copying ? "Couldn't copy" : "Couldn't read the file", message: e?.message || 'Preview failed.' });
        } finally {
            setBusy(false);
        }
    }, [ready, copying, send]);

    // Once the file has been read, every answer re-runs the preview so the checks match the answers.
    const reading = useRef(false);
    reading.current = preview !== null;
    useEffect(() => {
        if (!reading.current) return;
        const t = setTimeout(runPreview, 350);
        return () => clearTimeout(t);
    }, [runPreview]);

    const startOver = () => {
        setPreview(null);
        setAnswers(EMPTY_ANSWERS);
        setSheet(null);
        setSkipBlocked(false);
    };

    const pickFile = async (event) => {
        const chosen = event.target.files?.[0];
        if (!chosen) return;
        startOver();
        if (chosen.size > MAX_FILE_MB * 1024 * 1024) {
            event.target.value = '';
            setFile(null);
            addToast({
                type: 'error',
                title: 'File too large',
                message: `${chosen.name} is ${(chosen.size / 1024 / 1024).toFixed(1)} MB. Files can be up to ${MAX_FILE_MB} MB; delete unused sheets and try again.`,
            });
            return;
        }
        try {
            // Some workbooks carry thousands of formatted empty cells; drop them before uploading.
            const bytes = slimWorkbook(new Uint8Array(await chosen.arrayBuffer()));
            setFile({ name: chosen.name, blob: new Blob([bytes]) });
        } catch {
            setFile(null);
            addToast({ type: 'error', title: "Can't read this file", message: 'Choose an Excel (.xlsx) or Word (.docx) file.' });
        }
    };

    const setCourseAnswer = (code, courseId) =>
        setAnswers((a) => ({ ...a, courses: { ...a.courses, [code]: courseId } }));
    const setFacultyAnswer = (text, id) =>
        setAnswers((a) => ({ ...a, faculties: { ...a.faculties, [text]: id } }));
    const setVenueAnswer = (text, roomIds) =>
        setAnswers((a) => ({ ...a, venues: { ...a.venues, [text]: roomIds } }));
    const clearAnswer = (kind, key) =>
        setAnswers((a) => {
            const next = { ...a[kind] };
            delete next[key];
            return { ...a, [kind]: next };
        });

    const apply = async () => {
        const faculty = faculties.find((f) => f.id === facultyId);
        const what = itemType === 'exam' ? 'exam' : 'lecture';
        const sessions = preview.items.length - (skipBlocked ? preview.blocking_count : 0);
        const where = facultyId === ALL_FACULTIES
            ? `every faculty's timetable`
            : preview.faculty_count <= 1
            ? `${faculty?.name}'s timetable`
            : itemType === 'exam'
                ? `the timetables of the ${preview.faculty_count} faculties the file names`
                : `every faculty's timetable (${preview.faculty_count} faculties)`;
        const message = mode === 'replace'
            ? `This removes the ${preview.diff.current_count} ${what}(s) there now and adds ${sessions} from the file to ${where}.`
            : `This adds ${sessions} ${what}(s) to ${where} and keeps what is there.`;
        const proceed = await confirm({
            title: mode === 'replace' ? `Replace the ${what} timetable?` : `Add to the ${what} timetable?`,
            message,
            confirmLabel: mode === 'replace' ? 'Replace' : 'Add',
            cancelLabel: 'Cancel',
            tone: mode === 'replace' ? 'danger' : undefined,
        });
        if (!proceed) return;
        setBusy(true);
        try {
            const result = await send('apply', { skip_blocked: skipBlocked });
            addToast({
                type: 'success',
                title: 'Timetable imported',
                message: `${result.created} added${result.removed ? `, ${result.removed} removed` : ''}${result.left_out ? `, ${result.left_out} left out` : ''}.`,
            });
            setImported({ ...result, facultyName: faculties.find((f) => f.id === facultyId)?.name });
            startOver();
            setFile(null);
            loadHistory();
        } catch (e) {
            addToast({ type: 'error', title: 'Import failed', message: e?.message || 'Nothing was changed.' });
        } finally {
            setBusy(false);
        }
    };

    const loadHistory = useCallback(async () => {
        try {
            setHistory(await apiClient.get(`/timetable-import/imports?item_type=${itemType}`));
        } catch (e) {
            addToast({ type: 'error', title: 'Error', message: e?.message || 'Failed to load past imports.' });
        }
    }, [itemType]);

    useEffect(() => {
        if (allowed) loadHistory();
    }, [allowed, loadHistory]);

    const revert = async (row) => {
        const what = row.item_type === 'exam' ? 'exam' : 'lecture';
        const proceed = await confirm({
            title: `Revert the import of ${row.file_name || 'this file'}?`,
            message: (
                `This removes the ${row.still_present} ${what}(s) it added that are still in ${row.faculty_name}'s timetable`
                + (row.would_restore
                    ? ` and puts back the ${row.replaced_count} it replaced.`
                    : row.replaced_count
                        ? `. The ${row.replaced_count} it replaced won't be put back, because a later import has replaced the timetable since.`
                        : '.')
                + ' Other imports and sessions added by hand are not touched.'
            ),
            confirmLabel: 'Revert',
            cancelLabel: 'Cancel',
            tone: 'danger',
        });
        if (!proceed) return;
        setReverting(row.id);
        try {
            const result = await apiClient.post(`/timetable-import/imports/${row.id}/revert`);
            addToast({
                type: 'success',
                title: 'Import reverted',
                message: `${result.removed} removed${result.restored ? `, ${result.restored} put back` : ''}.`,
            });
            await loadHistory();
        } catch (e) {
            addToast({ type: 'error', title: "Couldn't revert", message: e?.message || 'Nothing was changed.' });
        } finally {
            setReverting(null);
        }
    };

    if (authLoading) return <TablePageSkeleton columns={5} rows={8} />;
    if (!allowed) return null;

    const shown = (preview?.items || []).filter((i) =>
        filter === 'blocking' ? i.blocking : filter === 'warnings' ? i.warnings.length > 0 : true,
    );
    const q = preview?.questions;
    const placesByRow = (preview?.items || []).some((i) => i.faculties);
    const canApply = preview?.ready && (preview.blocking_count === 0 || skipBlocked) && !busy;

    return (
        <div className={styles.page}>
            <div className={styles.header}>
                <div>
                    <h2 className={styles.title}>
                        {copying ? 'Copy from an earlier semester' : 'Import a timetable'} <span className={styles.beta}>Beta</span>
                    </h2>
                    <p className={styles.sub}>
                        {copying
                            ? `Schedule ${sources?.current ? `${sources.current.session_name} ${sources.current.name}` : 'the current semester'} from an earlier one: the same courses, days, times and rooms, checked against this semester before anything is saved.`
                            : 'Upload a faculty\'s Excel or Word timetable. Codes and venues are matched to this realm\'s courses and rooms; anything that doesn\'t match is asked about below before anything is saved.'}
                    </p>
                    <div className={styles.sourceTabs}>
                        {[['file', 'From a file'], ['semester', 'From an earlier semester']].map(([value, label]) => (
                            <button key={value} type="button" disabled={!!preview}
                                className={`btn ${source === value ? 'btn-primary' : 'btn-secondary'}`}
                                onClick={() => { setSource(value); setFacultyId(''); }}>{label}</button>
                        ))}
                    </div>
                </div>
                <Link className="btn btn-secondary" href={itemType === 'exam' ? '/timetable/exams' : '/timetable/lectures'}>
                    Back to timetable
                </Link>
            </div>

            {imported && (
                <ImportDone imported={imported} itemType={itemType} onDismiss={() => setImported(null)} />
            )}

            {!imported && (
            <section className={styles.card}>
                <div className={styles.setup}>
                    <label className={styles.field}>
                        <span className="form-label">Timetable</span>
                        <select className="form-select" value={itemType} disabled={!!preview}
                            onChange={(e) => setItemType(e.target.value)}>
                            <option value="lecture">Lectures</option>
                            <option value="exam">Exams</option>
                        </select>
                    </label>
                    <label className={styles.field}>
                        <span className="form-label">Faculty</span>
                        <select className="form-select" value={facultyId} disabled={!!preview}
                            onChange={(e) => setFacultyId(e.target.value)}>
                            <option value="">Choose a faculty…</option>
                            {copying && <option value={ALL_FACULTIES}>All faculties</option>}
                            {faculties.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                        </select>
                    </label>
                    {copying ? (
                        <label className={styles.field}>
                            <span className="form-label">Copy from</span>
                            <select className="form-select" value={sourceSemesterId} disabled={!!preview}
                                onChange={(e) => setSourceSemesterId(e.target.value)}>
                                <option value="">Choose a semester…</option>
                                {(sources?.semesters || []).map((s) => (
                                    <option key={s.id} value={s.id}>
                                        {s.session_name} {s.name} ({itemType === 'exam' ? `${s.exams} exams` : `${s.lectures} lectures`})
                                    </option>
                                ))}
                            </select>
                        </label>
                    ) : (
                        <label className={styles.field}>
                            <span className="form-label">Excel (.xlsx) or Word (.docx) file, up to {MAX_FILE_MB} MB</span>
                            <input className="form-input" type="file" accept=".xlsx,.docx" disabled={!!preview} onChange={pickFile} />
                        </label>
                    )}
                    {isGeneralStudies && (
                        <label className={`${styles.field} ${styles.inline}`}>
                            <input type="checkbox" checked={placeAll} disabled={!!preview} onChange={(e) => setPlaceAll(e.target.checked)} />
                            {itemType === 'exam'
                                ? 'Place each paper in the faculties its row names'
                                : `Place each session in every faculty's timetable (${faculties.length} faculties)`}
                        </label>
                    )}
                    <div className={styles.field}>
                        <span className="form-label">If the faculty already has a timetable</span>
                        <div className={styles.modes}>
                            <label><input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} /> Replace it</label>
                            <label><input type="radio" checked={mode === 'add'} onChange={() => setMode('add')} /> Add to it</label>
                        </div>
                    </div>
                </div>
                <div className={styles.actions}>
                    {preview ? (
                        <button className="btn btn-secondary" onClick={startOver} disabled={busy}>Start over</button>
                    ) : (
                        <button className="btn btn-primary" onClick={runPreview} disabled={!ready || busy}>
                            {busy ? (copying ? 'Copying…' : 'Reading…') : (copying ? 'Preview copy' : 'Read file')}
                        </button>
                    )}
                </div>
            </section>
            )}

            {preview && (
                <>
                    <section className={styles.summary}>
                        {preview.sheets.filter((s) => s.courses > 0).length > 1 && (
                            <label className={styles.inline}>
                                Sheet
                                <select className="form-select" value={preview.sheet || ''} onChange={(e) => setSheet(e.target.value)}>
                                    {preview.sheets.filter((s) => s.courses > 0).map((s) => (
                                        <option key={s.name} value={s.name}>{s.name} ({s.courses} codes)</option>
                                    ))}
                                </select>
                            </label>
                        )}
                        <Stat label="Sessions" value={preview.items.length} />
                        <Stat label="Questions" value={preview.open_questions} tone={preview.open_questions ? 'warning' : 'success'} />
                        <Stat label="Can't schedule" value={preview.blocking_count} tone={preview.blocking_count ? 'danger' : undefined} />
                        <Stat label="Warnings" value={preview.warning_count} tone={preview.warning_count ? 'warning' : undefined} />
                        <Stat label={mode === 'replace' ? 'Removed' : 'Kept'} value={preview.diff.current_count} />
                        {busy && <span className={styles.muted}>Checking…</span>}
                    </section>

                    {preview.faculty_count > 1 && (
                        <div className={styles.info}>
                            {itemType === 'exam'
                                ? `Each sitting below goes into General Studies' timetable and those of the faculties listed with it (${preview.items.reduce((n, i) => n + i.faculty_count, 0)} sessions in all, across ${preview.faculty_count} faculties).`
                                : `Each session below is placed in all ${preview.faculty_count} faculties' timetables (${preview.items.reduce((n, i) => n + i.faculty_count, 0)} sessions in all).`}
                            {mode === 'replace' && ' Replacing removes every faculty\'s copy of these courses first, so nothing is doubled.'}
                            {preview.unplaced_faculties.length > 0 && (
                                <div><strong>Not in this file:</strong> {preview.unplaced_faculties.join(', ')}.</div>
                            )}
                            {preview.faculty_notes.length > 0 && (
                                <div><strong>Notes in the faculty column, not imported:</strong> {preview.faculty_notes.join('; ')}.</div>
                            )}
                        </div>
                    )}
                    {preview.shared_courses.length > 0 && (
                        <div className={styles.info}>
                            <strong>Left to General Studies:</strong> {preview.shared_courses.map((c) => c.code).join(', ')}.{' '}
                            General Studies places these in every faculty, so this file&apos;s rows for them are skipped and the
                            faculty&apos;s current copies stay.
                        </div>
                    )}
                    {preview.warnings.length > 0 && (
                        <div className={styles.notice}>{preview.warnings.map((w) => <div key={w}>{w}</div>)}</div>
                    )}
                    {mode === 'replace' && preview.diff.missing_courses.length > 0 && (
                        <div className={styles.notice}>
                            <strong>Not in this file:</strong> {preview.diff.missing_courses.join(', ')}.{' '}
                            These courses are scheduled for this faculty now and will have no {itemType}s after the import.
                        </div>
                    )}

                    {preview.open_questions > 0 && (
                        <section className={styles.card}>
                            <h3 className={styles.sectionTitle}>Before importing</h3>

                            {q.exam_year && (
                                <Question title="Which year are the exams in?" detail="The day headers give a day and month but no year.">
                                    <YearAnswer onAnswer={(year) => setAnswers((a) => ({ ...a, exam_year: year }))} />
                                </Question>
                            )}
                            {q.exam_start_date && (
                                <Question title="When is the first exam day?"
                                    detail={copying
                                        ? 'Each paper keeps its weekday and moves by whole weeks to start in this week.'
                                        : 'No day header has a date; the rest are counted on from the first.'}>
                                    <input className="form-input" type="date" style={{ maxWidth: 200 }}
                                        onChange={(e) => setAnswers((a) => ({ ...a, exam_start_date: e.target.value || null }))} />
                                </Question>
                            )}

                            {q.courses.map((c) => (
                                <Question key={c.code} title={<>Which course is <code>{c.code}</code>?</>}
                                    detail={c.examples.map((x) => `${x.sheet} row ${x.row}: “${x.text}”`).join(' · ')}>
                                    {c.suggestions.map((s) => (
                                        <button key={s.id} className="btn btn-secondary" onClick={() => setCourseAnswer(c.code, s.id)}>
                                            {s.code} <span className={styles.muted}>{s.title}</span>
                                        </button>
                                    ))}
                                    <Picker placeholder="Search all courses…"
                                        items={courses} label={(x) => `${x.code} — ${x.title}`}
                                        onPick={(x) => setCourseAnswer(c.code, x.id)} />
                                    <button className="btn btn-secondary" onClick={() => setCourseAnswer(c.code, null)}>Leave it out</button>
                                </Question>
                            ))}

                            {q.faculties.map((f) => (
                                <Question key={f.text} title={<>Which faculty is <code>{f.text}</code>?</>}
                                    detail={`${f.count} row${f.count === 1 ? '' : 's'}`}>
                                    {f.suggestions.map((s) => (
                                        <button key={s.id} className="btn btn-secondary" onClick={() => setFacultyAnswer(f.text, s.id)}>{s.name}</button>
                                    ))}
                                    <Picker placeholder="Search all faculties…" items={faculties} label={(x) => x.name}
                                        onPick={(x) => setFacultyAnswer(f.text, x.id)} />
                                    <button className="btn btn-secondary" onClick={() => setFacultyAnswer(f.text, null)}>Leave it out</button>
                                </Question>
                            ))}

                            {q.venues.map((v) => (
                                <Question key={v.text} title={<>Which room is <code>{v.text}</code>?</>}
                                    detail={`${v.count} session${v.count === 1 ? '' : 's'}${v.same_name ? ' · several rooms in different buildings have this name' : ''}`}>
                                    {v.suggestions.map((s) => (
                                        <button key={s.id} className="btn btn-secondary" onClick={() => setVenueAnswer(v.text, [s.id])}>
                                            {s.name}{' '}
                                            <span className={styles.muted}>
                                                {s.capacity ? `${s.capacity} seats` : 'no capacity set'}
                                                {v.same_name ? ` · ${s.faculty || 'shared'}` : ''}
                                            </span>
                                        </button>
                                    ))}
                                    <Picker placeholder="Search all rooms…" items={rooms} label={(x) => x.name}
                                        onPick={(x) => setVenueAnswer(v.text, [x.id])} />
                                    <button className="btn btn-secondary" onClick={() => setVenueAnswer(v.text, [])}>No room</button>
                                </Question>
                            ))}
                        </section>
                    )}

                    <Answered answers={answers} courses={courses} faculties={faculties} roomName={roomName} onUndo={clearAnswer} />

                    {preview.venue_matches.length > 0 && (
                        <section className={styles.card}>
                            <h3 className={styles.sectionTitle}>Venues matched automatically</h3>
                            <p className={styles.muted}>Check these; change any that went to the wrong room.</p>
                            {preview.venue_matches.map((v) => (
                                <div key={v.text} className={styles.matchRow}>
                                    <span><code>{v.text}</code> → {v.rooms.map((r) => r.name).join(', ')}</span>
                                    <Picker placeholder="Change to…" items={rooms} label={(x) => x.name}
                                        onPick={(x) => setVenueAnswer(v.text, [x.id])} />
                                </div>
                            ))}
                        </section>
                    )}

                    {preview.venue_columns.length > 1 && (
                        <div className={styles.inlineRow}>
                            <span className={styles.muted}>Venues are read from</span>
                            <select className="form-select" style={{ maxWidth: 420 }} value={preview.venue_column}
                                onChange={(e) => setAnswers((a) => ({ ...a, venue_column: Number(e.target.value) }))}>
                                {preview.venue_columns.map((samples, i) => (
                                    <option key={i} value={i}>Column {i + 1}: {samples.join(', ')}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    <section className={styles.card}>
                        <div className={styles.tableHead}>
                            <h3 className={styles.sectionTitle}>Sessions</h3>
                            <div className={styles.filters}>
                                {FILTERS.map((f) => (
                                    <button key={f.value}
                                        className={`btn ${filter === f.value ? 'btn-primary' : 'btn-secondary'}`}
                                        onClick={() => setFilter(f.value)}>{f.label}</button>
                                ))}
                            </div>
                        </div>
                        <div className="table-container">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Course</th>
                                        <th>{itemType === 'exam' ? 'Date' : 'Day'}</th>
                                        <th>Time</th>
                                        <th>Rooms</th>
                                        {placesByRow && <th>Faculties</th>}
                                        <th>Checks</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {shown.length === 0 && (
                                        <tr><td colSpan={placesByRow ? 6 : 5} className={styles.empty}>Nothing to show.</td></tr>
                                    )}
                                    {shown.map((i) => (
                                        <tr key={`${i.course_id}-${i.day_of_week || i.exam_date}-${i.start_time}-${i.room_ids.join('.')}-${i.venues.join('.')}`}>
                                            <td>
                                                <strong>{i.code}</strong>
                                                <div className={styles.muted}>{i.title}</div>
                                            </td>
                                            <td>
                                                {i.exam_date ? formatDate(i.exam_date) : i.day_of_week}
                                                {i.week ? <div className={styles.muted}>Week {i.week}</div> : null}
                                            </td>
                                            <td>{i.start_time.slice(0, 5)}–{i.end_time.slice(0, 5)}</td>
                                            <td>
                                                {i.room_ids.length
                                                    ? i.room_ids.map((r) => roomName[r] || `#${r}`).join(', ')
                                                    : <span className={styles.muted}>{i.venues.join(', ') || '—'}</span>}
                                            </td>
                                            {placesByRow && <td className={styles.muted}>{(i.faculties || []).join(', ')}</td>}
                                            <td>
                                                {i.problems.map((p) => <div key={p} className={styles.problem}>{p}</div>)}
                                                {i.warnings.map((w) => <div key={w} className={styles.warning}>{w}</div>)}
                                                {!i.problems.length && !i.warnings.length && <span className={styles.ok}>OK</span>}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </section>

                    {preview.skipped_text.length > 0 && (
                        <section className={styles.card}>
                            <h3 className={styles.sectionTitle}>Cells with no course code</h3>
                            <p className={styles.muted}>These aren&apos;t imported. Fix the file if any of them is a course.</p>
                            <div className={styles.chips}>
                                {preview.skipped_text.map((s) => (
                                    <span key={s.text} className="badge badge-secondary">{s.text}{s.count > 1 ? ` ×${s.count}` : ''}</span>
                                ))}
                            </div>
                        </section>
                    )}

                    <section className={`${styles.card} ${styles.footer}`}>
                        {preview.blocking_count > 0 && (
                            <label className={styles.inline}>
                                <input type="checkbox" checked={skipBlocked} onChange={(e) => setSkipBlocked(e.target.checked)} />
                                Leave out the {preview.blocking_count} session(s) that can&apos;t be scheduled
                            </label>
                        )}
                        {!preview.ready && (
                            <span className={styles.muted}>
                                {preview.items.length ? 'Answer the questions above to continue.' : 'No sessions to import yet.'}
                            </span>
                        )}
                        <button className="btn btn-primary" disabled={!canApply} onClick={apply}>
                            {mode === 'replace' ? 'Replace timetable' : 'Add to timetable'}
                        </button>
                    </section>
                </>
            )}

            <ImportHistory rows={history} itemType={itemType} reverting={reverting} onRevert={revert} />
        </div>
    );
}

function ImportDone({ imported, itemType, onDismiss }) {
    const what = itemType === 'exam' ? 'exam' : 'lecture';
    return (
        <section className={`${styles.card} ${styles.done}`}>
            <div>
                <h3 className={styles.sectionTitle}>Timetable imported</h3>
                <p className={styles.muted}>
                    {imported.created} {what}(s) added to {imported.facultyName}
                    {imported.removed ? `, ${imported.removed} replaced` : ''}
                    {imported.left_out ? `, ${imported.left_out} left out` : ''}.
                    {' '}You can revert it at any time from Past imports below.
                </p>
            </div>
            <div className={styles.doneActions}>
                <Link className="btn btn-secondary" href={itemType === 'exam' ? '/timetable/exams' : '/timetable/lectures'}>
                    Go to timetable
                </Link>
                <button className="btn btn-primary" onClick={onDismiss}>Import another file</button>
            </div>
        </section>
    );
}

function ImportHistory({ rows, itemType, reverting, onRevert }) {
    return (
        <section className={styles.card}>
            <h3 className={styles.sectionTitle}>Past {itemType} imports</h3>
            <div className="table-container">
                <table className="data-table">
                    <thead>
                        <tr>
                            <th>When</th>
                            <th>Faculty</th>
                            <th>File</th>
                            <th>Sessions</th>
                            <th>By</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows === null && (
                            <tr><td colSpan={6} className={styles.empty}>Loading…</td></tr>
                        )}
                        {rows?.length === 0 && (
                            <tr><td colSpan={6} className={styles.empty}>No {itemType} timetables have been imported yet.</td></tr>
                        )}
                        {rows?.map((row) => (
                            <tr key={row.id} className={row.reverted_at ? styles.reverted : undefined}>
                                <td className={styles.nowrap}>{formatWhen(row.created_at)}</td>
                                <td>{row.faculty_name}</td>
                                <td>
                                    {row.copied ? `Copied from ${row.file_name}` : (row.file_name || '—')}
                                    <div className={styles.muted}>
                                        {row.mode === 'replace' ? `Replaced ${row.replaced_count}` : 'Added to the timetable'}
                                        {row.place_in_faculties ? ' · in every faculty' : ''}
                                        {row.sheet ? ` · sheet ${row.sheet}` : ''}
                                    </div>
                                </td>
                                <td>
                                    {row.created_count} added
                                    {!row.reverted_at && row.still_present < row.created_count && (
                                        <div className={styles.muted}>{row.still_present} still in the timetable</div>
                                    )}
                                </td>
                                <td className={styles.muted}>{row.created_by_email || '—'}</td>
                                <td className={styles.nowrap}>
                                    {row.reverted_at ? (
                                        <span className={styles.muted}>
                                            Reverted {formatWhen(row.reverted_at)}
                                            {row.reverted_by_email ? ` by ${row.reverted_by_email}` : ''}
                                        </span>
                                    ) : row.can_revert ? (
                                        <button className="btn btn-secondary" disabled={reverting !== null} onClick={() => onRevert(row)}>
                                            {reverting === row.id ? 'Reverting…' : 'Revert'}
                                        </button>
                                    ) : (
                                        <span className={styles.muted}>Earlier semester</span>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function formatWhen(iso) {
    return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function Stat({ label, value, tone }) {
    return (
        <div className={styles.stat}>
            <span className={`${styles.statValue} ${tone ? styles[tone] : ''}`}>{value}</span>
            <span className={styles.muted}>{label}</span>
        </div>
    );
}

function Question({ title, detail, children }) {
    return (
        <div className={styles.question}>
            <div className={styles.questionTitle}>{title}</div>
            {detail && <div className={styles.muted}>{detail}</div>}
            <div className={styles.answers}>{children}</div>
        </div>
    );
}

function YearAnswer({ onAnswer }) {
    const [year, setYear] = useState(String(new Date().getFullYear()));
    return (
        <>
            <input className="form-input" type="number" style={{ maxWidth: 140 }} value={year} onChange={(e) => setYear(e.target.value)} />
            <button className="btn btn-primary" disabled={!Number(year)} onClick={() => onAnswer(Number(year))}>Use this year</button>
        </>
    );
}

// A search box over a long list, showing the first few matches.
function Picker({ items, label, onPick, placeholder }) {
    const [text, setText] = useState('');
    const needle = text.trim().toLowerCase().replace(/\s+/g, '');
    const matches = needle.length < 2
        ? []
        : items.filter((x) => label(x).toLowerCase().replace(/\s+/g, '').includes(needle)).slice(0, 8);
    return (
        <div className={styles.picker}>
            <input className="form-input" placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} />
            {matches.length > 0 && (
                <div className={styles.pickerList}>
                    {matches.map((x) => (
                        <button key={x.id} type="button" onClick={() => { onPick(x); setText(''); }}>{label(x)}</button>
                    ))}
                </div>
            )}
        </div>
    );
}

function Answered({ answers, courses, faculties, roomName, onUndo }) {
    const courseCode = (id) => courses.find((c) => c.id === id)?.code || `#${id}`;
    const rows = [
        ...Object.entries(answers.courses).map(([code, id]) => ({
            kind: 'courses', key: code, text: <><code>{code}</code> → {id === null ? 'left out' : courseCode(id)}</>,
        })),
        ...Object.entries(answers.venues).map(([venue, ids]) => ({
            kind: 'venues', key: venue, text: <><code>{venue}</code> → {ids.length ? ids.map((r) => roomName[r] || `#${r}`).join(', ') : 'no room'}</>,
        })),
        ...Object.entries(answers.faculties).map(([name, id]) => ({
            kind: 'faculties', key: name,
            text: <><code>{name}</code> → {id === null ? 'left out' : faculties.find((f) => f.id === id)?.name || id}</>,
        })),
    ];
    if (!rows.length) return null;
    return (
        <div className={styles.chips}>
            {rows.map((r) => (
                <span key={`${r.kind}-${r.key}`} className={styles.answer}>
                    {r.text}
                    <button type="button" title="Change" onClick={() => onUndo(r.kind, r.key)}>×</button>
                </span>
            ))}
        </div>
    );
}

function formatDate(iso) {
    return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
