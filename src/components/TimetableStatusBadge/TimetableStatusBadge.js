'use client';

import styles from './TimetableStatusBadge.module.css';

export default function TimetableStatusBadge({
    isLocked,
    canToggle,
    onToggle,
    disabled,
    canRequestEdit,
    onRequestEdit,
    requestBusy,
}) {
    const label = isLocked ? 'FINAL' : 'DRAFT';
    const badgeClass = isLocked ? styles.badgeFinal : styles.badgeDraft;

    return (
        <div className={styles.wrapper}>
            <div className={`${styles.badge} ${badgeClass}`}>
                <span className={styles.dot} />
                {label}
            </div>
            {canToggle && (
                <button
                    type="button"
                    className={`btn ${isLocked ? 'btn-secondary' : 'btn-primary'}`}
                    onClick={onToggle}
                    disabled={disabled}
                >
                    {isLocked ? (
                        <>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                            </svg>
                            Unlock
                        </>
                    ) : (
                        <>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                            </svg>
                            Lock and mark as FINAL
                        </>
                    )}
                </button>
            )}
            {!canToggle && isLocked && canRequestEdit && (
                <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={onRequestEdit}
                    disabled={requestBusy}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4z" />
                    </svg>
                    Request Edit
                </button>
            )}
        </div>
    );
}
