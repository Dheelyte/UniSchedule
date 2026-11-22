'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { ROLE_LABELS } from '@/lib/roles';
import RetractControls from '@/components/EditorAccess/RetractControls';
import styles from './ProfileMenu.module.css';

// Who is signed in and, for an editor who handed their access over, the
// controls to take it back.
export default function ProfileMenu() {
    const { user, editorAccess } = useAuth();
    const [isOpen, setIsOpen] = useState(false);
    const rootRef = useRef(null);

    useEffect(() => {
        if (!isOpen) return;
        const close = (event) => {
            if (rootRef.current && !rootRef.current.contains(event.target)) setIsOpen(false);
        };
        const onKey = (event) => { if (event.key === 'Escape') setIsOpen(false); };
        document.addEventListener('mousedown', close);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', close);
            document.removeEventListener('keydown', onKey);
        };
    }, [isOpen]);

    if (!user) return null;
    const { granted, received, candidates } = editorAccess;
    const initial = (user.email || '?').charAt(0).toUpperCase();

    return (
        <div className={styles.root} ref={rootRef}>
            <button
                type="button"
                className={`${styles.trigger} ${granted ? styles.triggerAttention : ''}`}
                onClick={() => setIsOpen(open => !open)}
                aria-haspopup="true"
                aria-expanded={isOpen}
                title={granted ? 'Your editor access is handed over' : `Profile: ${user.email}`}>
                {initial}
                {granted && <span className={styles.dot} aria-hidden="true" />}
            </button>

            {isOpen && (
                <div className={styles.menu} role="dialog" aria-label="Profile">
                    <div className={styles.identity}>
                        <span className={styles.email}>{user.email}</span>
                        <span className={styles.role}>{ROLE_LABELS[user.role] || user.role}</span>
                    </div>

                    {granted && (
                        <div className={styles.section}>
                            <span className={styles.sectionTitle}>Your editor access</span>
                            <RetractControls handover={granted} candidates={candidates} onDone={() => setIsOpen(false)} />
                        </div>
                    )}

                    {received && (
                        <p className={styles.note}>
                            {received.granted_by.email} gave you their Faculty Editor access. Only they can take it back or pass it on.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
