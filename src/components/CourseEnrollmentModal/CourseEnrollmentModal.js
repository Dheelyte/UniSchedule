'use client';

import { useState, useMemo } from 'react';
import { apiClient } from '@/lib/apiClient';
import { useToast } from '@/components/Toast/Toast';
import styles from './CourseEnrollmentModal.module.css';

const LEVELS = [100, 200, 300, 400, 500, 600, 700];

/**
 * Modal for managing which (department × level) audiences "take" an interfaculty/UW course.
 *
 * Props:
 *  - course: { id, code, title, level, scope }
 *  - departments: [{ id, name, facultyId }] — only the user's faculty's depts (or all for SUPER_ADMIN)
 *  - faculties: [{ id, name }] — used by SUPER_ADMIN to label dept rows by faculty
 *  - currentEnrollments: [{ id, course_id, department_id, level }] — for this course
 *  - isSuperAdmin: bool
 *  - onClose: () => void
 *  - onSaved: (next) => void  — receives the new list of enrollments for this course
 */
export default function CourseEnrollmentModal({
    course,
    departments,
    faculties = [],
    currentEnrollments = [],
    isSuperAdmin = false,
    onClose,
    onSaved,
}) {
    const { addToast } = useToast();
    const [busy, setBusy] = useState(false);

    // Form state: dept_id -> { selected: bool, level: number }
    const initial = useMemo(() => {
        const map = {};
        departments.forEach((d) => {
            const enrolled = currentEnrollments.find((e) => e.department_id === d.id);
            map[d.id] = enrolled
                ? { selected: true, level: enrolled.level }
                : { selected: false, level: course.level || 100 };
        });
        return map;
    }, [departments, currentEnrollments, course.level]);

    const [form, setForm] = useState(initial);

    const setRow = (deptId, patch) => {
        setForm((prev) => ({ ...prev, [deptId]: { ...prev[deptId], ...patch } }));
    };

    const grouped = useMemo(() => {
        if (!isSuperAdmin) return [{ facultyId: null, facultyName: null, depts: departments }];
        const byFac = new Map();
        departments.forEach((d) => {
            const fid = d.facultyId;
            if (!byFac.has(fid)) byFac.set(fid, []);
            byFac.get(fid).push(d);
        });
        return Array.from(byFac.entries()).map(([fid, depts]) => ({
            facultyId: fid,
            facultyName: faculties.find((f) => f.id === fid)?.name || fid,
            depts,
        }));
    }, [departments, faculties, isSuperAdmin]);

    const handleSave = async () => {
        if (busy) return;
        setBusy(true);
        try {
            const ops = [];
            // For each dept row, diff against current enrollment
            departments.forEach((d) => {
                const next = form[d.id];
                const existing = currentEnrollments.find((e) => e.department_id === d.id);
                if (next.selected && !existing) {
                    ops.push(apiClient.post('/timetable/enrollments', {
                        course_id: course.id,
                        department_id: d.id,
                        level: next.level,
                    }));
                } else if (next.selected && existing && existing.level !== next.level) {
                    // Level changed — drop and re-create
                    ops.push(
                        apiClient.delete(`/timetable/enrollments?course_id=${course.id}&department_id=${d.id}&level=${existing.level}`)
                            .then(() => apiClient.post('/timetable/enrollments', {
                                course_id: course.id,
                                department_id: d.id,
                                level: next.level,
                            }))
                    );
                } else if (!next.selected && existing) {
                    ops.push(apiClient.delete(`/timetable/enrollments?course_id=${course.id}&department_id=${d.id}&level=${existing.level}`));
                }
            });

            if (ops.length === 0) {
                onClose();
                return;
            }

            await Promise.all(ops);
            const fresh = await apiClient.get(`/timetable/courses/${course.id}/enrollments`).catch(() => []);
            addToast({ type: 'success', title: 'Enrollments updated', message: `${course.code} enrollments saved.` });
            onSaved?.(fresh || []);
            onClose();
        } catch (e) {
            console.error(e);
            addToast({ type: 'error', title: 'Update Failed', message: e?.message || 'Could not update enrollments.' });
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <div className={styles.overlay} onClick={busy ? undefined : onClose} />
            <div className={styles.modal}>
                <div className={styles.header}>
                    <div>
                        <h3 className={styles.title}>Manage enrollment — {course.code}</h3>
                        <p className={styles.subtitle}>{course.title}</p>
                    </div>
                    <button className={styles.closeBtn} onClick={onClose} aria-label="Close" disabled={busy}>✕</button>
                </div>

                <div className={styles.body}>
                    <p className={styles.intro}>
                        Tick the departments whose students take this course, and set the level at which they take it.
                        Conflict detection uses these audiences to flag student double-bookings.
                    </p>

                    {grouped.map((group) => (
                        <div key={group.facultyId || 'self'} className={styles.group}>
                            {group.facultyName && <div className={styles.groupHeader}>{group.facultyName}</div>}
                            {group.depts.map((d) => (
                                <div key={d.id} className={styles.row}>
                                    <label className={styles.checkboxLabel}>
                                        <input
                                            type="checkbox"
                                            checked={form[d.id]?.selected || false}
                                            onChange={(e) => setRow(d.id, { selected: e.target.checked })}
                                            disabled={busy}
                                        />
                                        <span className={styles.deptName}>{d.name}</span>
                                    </label>
                                    <select
                                        className={styles.levelSelect}
                                        value={form[d.id]?.level || course.level || 100}
                                        onChange={(e) => setRow(d.id, { level: parseInt(e.target.value, 10) })}
                                        disabled={busy || !form[d.id]?.selected}
                                    >
                                        {LEVELS.map((l) => (
                                            <option key={l} value={l}>{l}L</option>
                                        ))}
                                    </select>
                                </div>
                            ))}
                        </div>
                    ))}

                    {departments.length === 0 && (
                        <div className={styles.empty}>No departments available to enroll.</div>
                    )}
                </div>

                <div className={styles.footer}>
                    <button type="button" className={`btn btn-secondary ${styles.btn}`} onClick={onClose} disabled={busy}>
                        Cancel
                    </button>
                    <button type="button" className={`btn btn-primary ${styles.btn}`} onClick={handleSave} disabled={busy}>
                        {busy ? 'Saving…' : 'Save'}
                    </button>
                </div>
            </div>
        </>
    );
}
