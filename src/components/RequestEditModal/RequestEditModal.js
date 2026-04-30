'use client';

import { useState } from 'react';
import styles from './RequestEditModal.module.css';

export default function RequestEditModal({ onClose, onSubmit, mode = 'lecture', busy = false }) {
    const [reason, setReason] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        onSubmit(reason.trim() || null);
    };

    const label = mode === 'exam' ? 'exam' : 'lecture';

    return (
        <>
            <div className={styles.overlay} onClick={busy ? undefined : onClose} />
            <div className={styles.modal}>
                <div className={styles.header}>
                    <h3 className={styles.title}>Request edit access</h3>
                    <button className={styles.closeBtn} onClick={onClose} aria-label="Close" disabled={busy}>✕</button>
                </div>

                <form className={styles.body} onSubmit={handleSubmit}>
                    <p className={styles.intro}>
                        The {label} timetable is currently locked. Submitting this request will notify all super
                        admins, who can choose to unlock it.
                    </p>

                    <div className={styles.formGroup}>
                        <label className={styles.label} htmlFor="edit-reason">Reason (optional)</label>
                        <textarea
                            id="edit-reason"
                            className={styles.textarea}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Briefly explain what needs to change…"
                            rows={4}
                            disabled={busy}
                        />
                    </div>

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
