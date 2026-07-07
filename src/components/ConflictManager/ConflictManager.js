'use client';

import { useMemo, useState } from 'react';
import { apiClient } from '@/lib/apiClient';
import { conflictSignature } from '@/lib/conflicts';
import { useToast } from '@/components/Toast/Toast';
import styles from './ConflictManager.module.css';

const TYPE_LABELS = {
    room: 'Room',
    course: 'Course',
    audience: 'Audience',
    duplicate: 'Duplicate',
    time: 'Time',
};

export default function ConflictManager({
    mode = 'lecture',
    conflictMap,
    schedules = [],
    departments = [],
    dismissals = [],
    onClose,
    onChanged,
}) {
    const { addToast } = useToast();
    const [tab, setTab] = useState('active');
    const [reason, setReason] = useState('');
    const [deptId, setDeptId] = useState('');
    const [busy, setBusy] = useState(false);

    const schedulesById = useMemo(() => {
        const m = new Map();
        schedules.forEach((s) => m.set(s.id, s));
        return m;
    }, [schedules]);

    const codeOf = (id) => schedulesById.get(id)?.courseCode || `#${id}`;

    // Unique active conflicts (deduped across the mirrored a↔b entries).
    const activeConflicts = useMemo(() => {
        const bySig = new Map();
        for (const [itemId, list] of conflictMap.entries()) {
            for (const c of list) {
                const bId = c.relatedId ?? null;
                const sig = conflictSignature(c.type, itemId, bId);
                if (bySig.has(sig)) continue;
                bySig.set(sig, {
                    signature: sig,
                    conflict_type: c.type,
                    item_a_id: itemId,
                    item_b_id: bId,
                    message: c.message,
                });
            }
        }
        return Array.from(bySig.values());
    }, [conflictMap]);

    // Active conflicts that involve the selected department (either side's course).
    const deptConflicts = useMemo(() => {
        if (!deptId) return [];
        const d = Number(deptId);
        return activeConflicts.filter((c) => {
            const a = schedulesById.get(c.item_a_id);
            const b = c.item_b_id != null ? schedulesById.get(c.item_b_id) : null;
            return a?.courseDepartmentId === d || b?.courseDepartmentId === d;
        });
    }, [deptId, activeConflicts, schedulesById]);

    const requireReason = () => {
        if (!reason.trim()) {
            addToast({ type: 'error', title: 'Reason required', message: 'Enter a reason before dismissing a conflict.' });
            return false;
        }
        return true;
    };

    const dismissOne = async (c) => {
        if (!requireReason()) return;
        setBusy(true);
        try {
            await apiClient.post('/timetable/conflict-dismissals', {
                conflict_type: c.conflict_type,
                item_a_id: c.item_a_id,
                item_b_id: c.item_b_id,
                reason: reason.trim(),
            });
            addToast({ type: 'success', title: 'Conflict dismissed', message: 'The conflict has been overridden.' });
            await onChanged?.();
        } catch (e) {
            addToast({ type: 'error', title: 'Dismiss failed', message: e?.message || 'Could not dismiss conflict.' });
        } finally {
            setBusy(false);
        }
    };

    const dismissDepartment = async () => {
        if (!deptId) {
            addToast({ type: 'error', title: 'Department required', message: 'Select a department first.' });
            return;
        }
        if (!requireReason()) return;
        if (deptConflicts.length === 0) {
            addToast({ type: 'info', title: 'Nothing to resolve', message: 'No active conflicts in that department.' });
            return;
        }
        setBusy(true);
        try {
            await apiClient.post('/timetable/conflict-dismissals/bulk', {
                department_id: Number(deptId),
                reason: reason.trim(),
                dismissals: deptConflicts.map((c) => ({
                    conflict_type: c.conflict_type,
                    item_a_id: c.item_a_id,
                    item_b_id: c.item_b_id,
                })),
            });
            addToast({ type: 'success', title: 'Conflicts dismissed', message: `Dismissed ${deptConflicts.length} conflict(s).` });
            await onChanged?.();
        } catch (e) {
            addToast({ type: 'error', title: 'Bulk dismiss failed', message: e?.message || 'Could not resolve department conflicts.' });
        } finally {
            setBusy(false);
        }
    };

    const restore = async (d) => {
        setBusy(true);
        try {
            await apiClient.delete(`/timetable/conflict-dismissals/${d.id}`);
            addToast({ type: 'success', title: 'Conflict restored', message: 'The conflict is active again.' });
            await onChanged?.();
        } catch (e) {
            addToast({ type: 'error', title: 'Restore failed', message: e?.message || 'Could not restore conflict.' });
        } finally {
            setBusy(false);
        }
    };

    const dismissalLabel = (d) =>
        d.item_b_id != null
            ? `${codeOf(d.item_a_id)} ↔ ${codeOf(d.item_b_id)}`
            : codeOf(d.item_a_id);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
                <div className="modal-header">
                    <h3>Manage {mode} conflicts</h3>
                    <button className="modal-close" onClick={onClose}>✕</button>
                </div>
                <div className="modal-body">
                    <div className={styles.tabs}>
                        <button
                            className={`${styles.tab} ${tab === 'active' ? styles.tabActive : ''}`}
                            onClick={() => setTab('active')}>
                            Active ({activeConflicts.length})
                        </button>
                        <button
                            className={`${styles.tab} ${tab === 'dismissed' ? styles.tabActive : ''}`}
                            onClick={() => setTab('dismissed')}>
                            Dismissed ({dismissals.length})
                        </button>
                    </div>

                    {tab === 'active' && (
                        <>
                            <label className={styles.reasonLabel}>
                                Reason (applied to dismissals below)
                                <textarea
                                    className={styles.reason}
                                    rows={2}
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                    placeholder="Why is this conflict acceptable?"
                                />
                            </label>

                            <div className={styles.bulkRow}>
                                <select
                                    className={styles.select}
                                    value={deptId}
                                    onChange={(e) => setDeptId(e.target.value)}>
                                    <option value="">Resolve all in department…</option>
                                    {departments.map((d) => (
                                        <option key={d.id} value={d.id}>{d.name}</option>
                                    ))}
                                </select>
                                <button
                                    className="btn btn-primary"
                                    disabled={busy || !deptId}
                                    onClick={dismissDepartment}>
                                    Dismiss {deptId ? deptConflicts.length : ''} in dept
                                </button>
                            </div>

                            {activeConflicts.length === 0 ? (
                                <div className={styles.empty}>No active conflicts. 🎉</div>
                            ) : (
                                <ul className={styles.list}>
                                    {activeConflicts.map((c) => (
                                        <li key={c.signature} className={styles.row}>
                                            <div className={styles.rowMain}>
                                                <span className={styles.badge}>{TYPE_LABELS[c.conflict_type] || c.conflict_type}</span>
                                                <span className={styles.rowLabel}>
                                                    {c.item_b_id != null
                                                        ? `${codeOf(c.item_a_id)} ↔ ${codeOf(c.item_b_id)}`
                                                        : codeOf(c.item_a_id)}
                                                </span>
                                                <span className={styles.rowMsg}>{c.message}</span>
                                            </div>
                                            <button
                                                className="btn btn-secondary"
                                                disabled={busy}
                                                onClick={() => dismissOne(c)}>
                                                Dismiss
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </>
                    )}

                    {tab === 'dismissed' && (
                        dismissals.length === 0 ? (
                            <div className={styles.empty}>Nothing dismissed yet.</div>
                        ) : (
                            <ul className={styles.list}>
                                {dismissals.map((d) => (
                                    <li key={d.id} className={styles.row}>
                                        <div className={styles.rowMain}>
                                            <span className={styles.badge}>{TYPE_LABELS[d.conflict_type] || d.conflict_type}</span>
                                            <span className={styles.rowLabel}>{dismissalLabel(d)}</span>
                                            <span className={styles.rowMsg}>
                                                {d.reason}
                                                <span className={styles.meta}>
                                                    {' · '}{new Date(d.created_at).toLocaleDateString()}
                                                </span>
                                            </span>
                                        </div>
                                        <button
                                            className="btn btn-secondary"
                                            disabled={busy}
                                            onClick={() => restore(d)}>
                                            Restore
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )
                    )}
                </div>
                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    );
}
