'use client';

import { useMemo, useState } from 'react';
import SearchableSelect from '@/components/SearchableSelect/SearchableSelect';
import { DAYS, EXAM_DAYS, isRoomActive } from '@/lib/utils';
import styles from './RequestChangeModal.module.css';

// 08:00 → 18:00 in 30-minute steps
const TIME_OPTIONS = (() => {
    const out = [];
    for (let h = 8; h <= 18; h++) {
        for (const m of [0, 30]) {
            if (h === 18 && m === 30) continue;
            out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
        }
    }
    return out;
})();

const hhmm = (t) => (t ? String(t).slice(0, 5) : '');

export default function RequestChangeModal({
    onClose,
    onSubmit,
    busy = false,
    mode = 'lecture',
    courses = [],
    departments = [],
    faculties = [],
    rooms = [],
    scheduleItems = [],
}) {
    const isExam = mode === 'exam';
    const activeDays = isExam ? EXAM_DAYS : DAYS;
    const itemNoun = isExam ? 'exam sitting' : 'lecture session';

    const [action, setAction] = useState('ADD');
    const [courseId, setCourseId] = useState('');
    const [targetItemId, setTargetItemId] = useState('');
    const [day, setDay] = useState(activeDays[0]);
    const [examDate, setExamDate] = useState('');
    const [startTime, setStartTime] = useState('08:00');
    const [endTime, setEndTime] = useState('10:00');
    const [roomIds, setRoomIds] = useState([]);
    const [reason, setReason] = useState('');
    const [error, setError] = useState('');

    const courseOptions = useMemo(
        () => courses.map((c) => ({ value: String(c.id), label: `${c.code}${c.title ? ` — ${c.title}` : ''}` })),
        [courses],
    );

    const targetOptions = useMemo(
        () =>
            scheduleItems.map((s) => {
                const when = isExam ? s.examDate || s.day : s.day;
                return { value: String(s.id), label: `${s.courseCode} · ${when || '—'} ${hhmm(s.startTime)}–${hhmm(s.endTime)}` };
            }),
        [scheduleItems, isExam],
    );

    const selectedTarget = useMemo(
        () => scheduleItems.find((s) => String(s.id) === String(targetItemId)) || null,
        [scheduleItems, targetItemId],
    );

    // When a target is chosen for MODIFY/REMOVE, prefill the proposed fields from it.
    const applyTargetPrefill = (item) => {
        if (!item) return;
        setCourseId(String(item.courseId));
        if (isExam) setExamDate(item.examDate || '');
        else setDay(item.day || activeDays[0]);
        setStartTime(hhmm(item.startTime) || '08:00');
        setEndTime(hhmm(item.endTime) || '10:00');
        setRoomIds((item.roomIds || []).map(String));
    };

    const roomRows = roomIds.length ? roomIds : [''];

    // A room already assigned to this slot stays selectable/visible even if it's since gone inactive;
    // inactive rooms are otherwise excluded from new picks.
    const availableRooms = (idx) =>
        rooms.filter((r) => {
            const s = String(r.id);
            if (s === roomRows[idx]) return true;
            if (!isRoomActive(r)) return false;
            return !roomRows.includes(s);
        });

    const selectableRoomCount = rooms.filter((r) => isRoomActive(r) || roomRows.includes(String(r.id))).length;

    const setRoomAt = (idx, val) => {
        setRoomIds(() => {
            const next = [...roomRows];
            next[idx] = String(val);
            return next.filter(Boolean);
        });
    };

    const addRoom = () => setRoomIds([...roomRows.filter(Boolean), '']);

    const removeRoomAt = (idx) => {
        const next = roomRows.filter((_, i) => i !== idx);
        setRoomIds(next.filter(Boolean));
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        setError('');

        const effectiveCourseId = action === 'ADD' ? courseId : selectedTarget?.courseId;
        if (!effectiveCourseId) {
            setError(action === 'ADD' ? 'Please choose a course.' : 'Please choose the session to change.');
            return;
        }
        if (action !== 'ADD' && !targetItemId) {
            setError('Please choose the session to change.');
            return;
        }
        if (action !== 'REMOVE') {
            if (!startTime || !endTime) { setError('Please set a start and end time.'); return; }
            if (endTime <= startTime) { setError('End time must be after start time.'); return; }
            if (isExam && !examDate) { setError('Please choose an exam date.'); return; }
        }

        const course = courses.find((c) => String(c.id) === String(effectiveCourseId));
        const dept = departments.find((d) => d.id === course?.departmentId);
        const facultyId = dept?.facultyId || faculties[0]?.id || null;

        const payload = {
            timetable_type: mode,
            action,
            course_id: Number(effectiveCourseId),
            target_schedule_item_id: action === 'ADD' ? null : Number(targetItemId),
            room_ids: action === 'REMOVE' ? null : roomIds.filter(Boolean).map(Number),
            faculty_id: facultyId,
            day_of_week: action === 'REMOVE' || isExam ? null : day,
            exam_date: action === 'REMOVE' || !isExam ? null : examDate,
            start_time: action === 'REMOVE' ? null : startTime,
            end_time: action === 'REMOVE' ? null : endTime,
            reason: reason.trim() || null,
        };
        onSubmit(payload);
    };

    const showProposed = action !== 'REMOVE';

    return (
        <>
            <div className={styles.overlay} onClick={busy ? undefined : onClose} />
            <div className={styles.modal}>
                <div className={styles.header}>
                    <h3 className={styles.title}>Request a {isExam ? 'exam' : 'lecture'} schedule change</h3>
                    <button className={styles.closeBtn} onClick={onClose} aria-label="Close" disabled={busy}>✕</button>
                </div>

                <form className={styles.body} onSubmit={handleSubmit}>
                    <p className={styles.intro}>
                        Describe the change you’d like a super admin to make. They’ll be notified and can approve it
                        (applying it directly) or reject it.
                    </p>

                    <div className={styles.formGroup}>
                        <label className={styles.label}>What kind of change?</label>
                        <div className={styles.segmented}>
                            {['ADD', 'MODIFY', 'REMOVE'].map((a) => (
                                <button
                                    type="button"
                                    key={a}
                                    className={`${styles.segment} ${action === a ? styles.segmentActive : ''}`}
                                    onClick={() => { setAction(a); setError(''); }}
                                    disabled={busy}
                                >
                                    {a === 'ADD' ? 'Add' : a === 'MODIFY' ? 'Modify' : 'Remove'}
                                </button>
                            ))}
                        </div>
                    </div>

                    {action === 'ADD' ? (
                        <div className={styles.formGroup}>
                            <label className={styles.label}>Course</label>
                            <SearchableSelect
                                options={courseOptions}
                                value={courseId}
                                onChange={(v) => setCourseId(v)}
                                placeholder="Select a course…"
                            />
                        </div>
                    ) : (
                        <div className={styles.formGroup}>
                            <label className={styles.label} style={{ textTransform: 'capitalize' }}>{action === 'REMOVE' ? `${itemNoun} to remove` : `${itemNoun} to modify`}</label>
                            <SearchableSelect
                                options={targetOptions}
                                value={targetItemId}
                                onChange={(v) => { setTargetItemId(v); applyTargetPrefill(scheduleItems.find((s) => String(s.id) === String(v))); }}
                                placeholder={`Select an existing ${itemNoun}…`}
                            />
                        </div>
                    )}

                    {showProposed && (
                        <>
                            <div className={styles.row}>
                                {isExam ? (
                                    <div className={styles.formGroup} style={{ flex: 1 }}>
                                        <label className={styles.label}>Exam date</label>
                                        <input type="date" className={styles.input} value={examDate} onChange={(e) => setExamDate(e.target.value)} disabled={busy} />
                                    </div>
                                ) : (
                                    <div className={styles.formGroup} style={{ flex: 1 }}>
                                        <label className={styles.label}>Day</label>
                                        <select className={styles.input} value={day} onChange={(e) => setDay(e.target.value)} disabled={busy}>
                                            {activeDays.map((d) => <option key={d} value={d}>{d}</option>)}
                                        </select>
                                    </div>
                                )}
                            </div>
                            <div className={styles.row}>
                                <div className={styles.formGroup} style={{ flex: 1 }}>
                                    <label className={styles.label}>Start</label>
                                    <select className={styles.input} value={startTime} onChange={(e) => setStartTime(e.target.value)} disabled={busy}>
                                        {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </div>
                                <div className={styles.formGroup} style={{ flex: 1 }}>
                                    <label className={styles.label}>End</label>
                                    <select className={styles.input} value={endTime} onChange={(e) => setEndTime(e.target.value)} disabled={busy}>
                                        {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div className={styles.formGroup}>
                                <label className={styles.label}>Room{roomIds.filter(Boolean).length > 1 ? 's' : ''}</label>
                                {selectableRoomCount === 0 ? (
                                    <span className={styles.muted}>No rooms available</span>
                                ) : (
                                    <div className={styles.roomList}>
                                        {roomRows.map((rid, idx) => (
                                            <div key={idx} className={styles.roomRow}>
                                                <SearchableSelect
                                                    options={availableRooms(idx).map((r) => ({ value: String(r.id), label: `${r.name}${r.capacity ? ` (Cap: ${r.capacity})` : ''}` }))}
                                                    value={rid}
                                                    onChange={(val) => setRoomAt(idx, val)}
                                                    placeholder="Select a room…"
                                                    className={styles.roomSelect}
                                                />
                                                {roomRows.length > 1 && (
                                                    <button type="button" className={styles.removeRoomBtn} onClick={() => removeRoomAt(idx)} disabled={busy} title="Remove this room">✕</button>
                                                )}
                                            </div>
                                        ))}
                                        {roomRows.every(Boolean) && roomRows.length < selectableRoomCount && (
                                            <button type="button" className={styles.addRoomBtn} onClick={addRoom} disabled={busy}>+ Add another room</button>
                                        )}
                                    </div>
                                )}
                            </div>
                        </>
                    )}

                    {action === 'REMOVE' && selectedTarget && (
                        <div className={styles.summary}>
                            Requesting removal of <strong>{selectedTarget.courseCode}</strong> on{' '}
                            {isExam ? selectedTarget.examDate : selectedTarget.day} {hhmm(selectedTarget.startTime)}–{hhmm(selectedTarget.endTime)}.
                        </div>
                    )}

                    <div className={styles.formGroup}>
                        <label className={styles.label} htmlFor="change-reason">Reason / details</label>
                        <textarea
                            id="change-reason"
                            className={styles.textarea}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Explain why this change is needed…"
                            rows={3}
                            disabled={busy}
                        />
                    </div>

                    {error && <p className={styles.error}>{error}</p>}

                    <div className={styles.footer}>
                        <button type="button" className={`btn btn-secondary ${styles.btn}`} onClick={onClose} disabled={busy}>
                            Cancel
                        </button>
                        <button type="submit" className={`btn btn-primary ${styles.btn}`} disabled={busy}>
                            {busy ? 'Sending…' : 'Send Request'}
                        </button>
                    </div>
                </form>
            </div>
        </>
    );
}
