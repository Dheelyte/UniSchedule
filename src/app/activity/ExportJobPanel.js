'use client';

import { useSyncExternalStore } from 'react';
import { cancelJob, dismissJob, getJob, subscribeJob } from './exportJob';
import styles from './activity.module.css';

/** Progress of the export being built in this tab, then its download link. */
export default function ExportJobPanel() {
    const job = useSyncExternalStore(subscribeJob, getJob, () => null);
    if (!job) return null;

    const pct = job.total ? Math.min(100, Math.round((job.done / job.total) * 100)) : 0;

    return (
        <div className={styles.job} role="status" aria-live="polite" data-testid="export-job">
            {job.status === 'running' && (
                <>
                    <span className={styles.jobText}>
                        <strong>Building {job.fileName}</strong>
                        {job.total ? ` · ${job.done.toLocaleString()} of ${job.total.toLocaleString()} rows` : ' · preparing…'}
                        {job.background ? '. Keep this tab open until it finishes; you can keep using the page.' : ''}
                    </span>
                    <div className={styles.progress} aria-label={`${pct}% done`}>
                        <div className={styles.progressBar} style={{ width: `${pct}%` }} />
                    </div>
                    <button type="button" className="btn btn-secondary" onClick={cancelJob}>Cancel</button>
                </>
            )}
            {job.status === 'done' && (
                <>
                    <span className={styles.jobText}>
                        <strong>Your export is ready.</strong> {job.background ? '' : 'It has been downloaded. '}
                    </span>
                    <a className="btn btn-primary" href={job.url} download={job.fileName} data-testid="export-job-download">
                        {job.background ? 'Download' : 'Download again'} {job.fileName}
                    </a>
                    <button type="button" className="btn btn-secondary" onClick={dismissJob}>Dismiss</button>
                </>
            )}
            {job.status === 'error' && (
                <>
                    <span className={styles.jobText} style={{ color: 'var(--color-danger)' }}>
                        <strong>The export failed.</strong> {job.message}
                    </span>
                    <button type="button" className="btn btn-secondary" onClick={dismissJob}>Dismiss</button>
                </>
            )}
            {job.status === 'cancelled' && (
                <>
                    <span className={styles.jobText}>Export cancelled.</span>
                    <button type="button" className="btn btn-secondary" onClick={dismissJob}>Dismiss</button>
                </>
            )}
        </div>
    );
}
