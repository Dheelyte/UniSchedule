'use client';

import { useState } from 'react';
import { useEditorAccessActions } from './useEditorAccessActions';
import styles from './EditorAccess.module.css';

// For the editor who handed their access over: who holds it now, and the two
// ways to take it back. Used on the staff page and in the profile menu.
export default function RetractControls({ handover, candidates = [], onDone }) {
    const { retract, busy } = useEditorAccessActions();
    const [toId, setToId] = useState('');
    const to = candidates.find(c => String(c.id) === toId) || null;

    const act = async (target) => {
        if (await retract(handover, target)) {
            setToId('');
            onDone?.();
        }
    };

    return (
        <div className={styles.controls}>
            <p className={styles.summary}>
                Your Faculty Editor access for {handover.faculty_name} is with{' '}
                <strong>{handover.holder.email}</strong> since {new Date(handover.started_at).toLocaleDateString()}.
                You are a Faculty Viewer until you retract it.
            </p>

            <button type="button" className={styles.primaryBtn} onClick={() => act(null)} disabled={busy}>
                Return editor access to me
            </button>

            <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor={`redirect-${handover.id}`}>Or give it to another Faculty Viewer</label>
                {candidates.length === 0 ? (
                    <span className={styles.muted}>There is no other Faculty Viewer in your faculty.</span>
                ) : (
                    <div className={styles.inline}>
                        <select
                            id={`redirect-${handover.id}`}
                            className={styles.select}
                            value={toId}
                            onChange={e => setToId(e.target.value)}
                            disabled={busy}
                        >
                            <option value="">Choose a Faculty Viewer…</option>
                            {candidates.map(c => <option key={c.id} value={c.id}>{c.email}</option>)}
                        </select>
                        <button type="button" className={styles.secondaryBtn} onClick={() => act(to)} disabled={busy || !to}>
                            Give access
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
