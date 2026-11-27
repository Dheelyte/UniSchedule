'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { apiClient } from '@/lib/apiClient';
import { useToast } from '@/components/Toast/Toast';
import { FilterFields } from './FilterBar';
import { SECTIONS, PDF_APPENDIX_LIMIT } from './report';
import { BACKGROUND_THRESHOLD, buildExportFile, needsBackground, requestExport } from './exportRunner';
import { getJob, runJob, subscribeJob } from './exportJob';
import { TIMEZONE_NOTE, exportStartFilters, formatDay, toApiParams } from './filters';
import styles from './activity.module.css';

const api = {
    post: (path, body) => apiClient.post(path, body),
    get: (path, headers) => apiClient.get(path, { headers }),
};

const SUPER_ADMIN_SECTIONS = ['impersonation', 'exports'];
const DEFAULT_SECTIONS = SECTIONS.map((s) => s.key).filter((k) => k !== 'raw');

/**
 * "Export analysis": SUPER_ADMIN only (the page hides the button otherwise, and
 * the server checks the effective role again). Opens with the page's filters.
 */
export default function ExportAnalysisModal({ pageFilters, options, roleLabels, onClose }) {
    const { addToast } = useToast();
    const [start] = useState(() => exportStartFilters(pageFilters, options));
    const [filters, setFilters] = useState(start.filters);
    const [sections, setSections] = useState(() => new Set(DEFAULT_SECTIONS));
    const [format, setFormat] = useState('pdf');
    const [mask, setMask] = useState(false);
    const [preview, setPreview] = useState({ loading: true, data: null, error: null });
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const job = useSyncExternalStore(subscribeJob, getJob, () => null);

    const query = useMemo(() => toApiParams(filters).toString(), [filters]);

    // The live count, a moment after the filters stop changing.
    useEffect(() => {
        let cancelled = false;
        setPreview((p) => ({ ...p, loading: true }));
        const timer = setTimeout(() => {
            apiClient
                .get(`/audit/export/preview?${query}`, { fresh: true })
                .then((data) => !cancelled && setPreview({ loading: false, data, error: null }))
                .catch((e) => !cancelled && setPreview({ loading: false, data: null, error: e?.message || 'The count could not be loaded.' }));
        }, 300);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [query]);

    useEffect(() => {
        const onKey = (e) => {
            if (e.key === 'Escape' && !submitting) onClose();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose, submitting]);

    const toggle = (key) =>
        setSections((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });

    const events = preview.data?.events ?? null;
    const membersTicked = sections.has('members');
    const noEvents = events === 0 && !membersTicked;
    const chosen = SECTIONS.map((s) => s.key).filter((k) => sections.has(k) || (k === 'raw' && format === 'xlsx'));
    const nothingTicked = chosen.length === 0;
    const background = events !== null && needsBackground({ format, events });
    const busy = job?.status === 'running';
    const canDownload = Boolean(preview.data) && !preview.loading && !preview.error && !noEvents && !nothingTicked && !submitting && !busy;

    const download = async () => {
        setSubmitting(true);
        setError(null);
        try {
            const started = await requestExport(api, { filters, format, sections: chosen, mask });
            const inBackground = needsBackground({ format: started.format, events: started.events });
            runJob({
                fileName: started.file_name,
                total: started.sections.includes('raw') ? started.events : 0,
                background: inBackground,
                task: ({ signal, onProgress }) =>
                    buildExportFile(api, { started, filters, options, roleLabels, mask, note: start.note, onProgress, signal }),
            }).then((finished) => {
                if (finished?.status === 'done' && !inBackground) {
                    addToast({ type: 'success', title: 'Export downloaded', message: `${started.file_name} is in your downloads.` });
                }
            });
            if (inBackground) {
                addToast({
                    type: 'info',
                    title: 'Export running in the background',
                    message: `${started.events.toLocaleString()} rows. Progress shows at the top of the page; keep this tab open.`,
                });
            }
            onClose();
        } catch (e) {
            setError(e?.message || 'The export could not be started.');
        } finally {
            setSubmitting(false);
        }
    };

    const range = preview.data ? (preview.data.first === preview.data.last ? formatDay(preview.data.first) : `${formatDay(preview.data.first)} – ${formatDay(preview.data.last)}`) : null;

    return (
        <>
            <div className={styles.overlay} onClick={() => !submitting && onClose()} />
            <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="export-analysis-title" data-testid="export-modal">
                <div className={styles.modalHeader}>
                    <h3 id="export-analysis-title" className={styles.modalTitle}>Export analysis</h3>
                    <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close" disabled={submitting}>✕</button>
                </div>

                <div className={styles.modalBody}>
                    {start.note && <div className={styles.note} data-testid="export-shortened-note">{start.note}</div>}

                    <section className={styles.modalSection}>
                        <h4 className={styles.sectionTitle}>Filters</h4>
                        <span className={styles.hint}>These start from the page&apos;s filters. Changing them here doesn&apos;t change the page.</span>
                        <FilterFields value={filters} onChange={setFilters} options={options} roleLabels={roleLabels} allowAllTime={false} idPrefix="export" />
                    </section>

                    <div className={styles.count} data-testid="export-count" aria-live="polite">
                        {preview.error ? (
                            <span style={{ color: 'var(--color-danger)' }}>{preview.error}</span>
                        ) : preview.data ? (
                            <>
                                <span className={styles.countNumber}>{preview.data.events.toLocaleString()}</span>
                                <span>matching event{preview.data.events === 1 ? '' : 's'}</span>
                                <span className={styles.countMuted}>
                                    · {preview.data.members.toLocaleString()} member{preview.data.members === 1 ? '' : 's'} and {preview.data.invitations.toLocaleString()} open invitation{preview.data.invitations === 1 ? '' : 's'} listed · {range}
                                    {preview.data.clamped ? ' (shortened to 12 months)' : ''}
                                    {preview.loading ? ' · updating…' : ''}
                                </span>
                            </>
                        ) : (
                            <span className={styles.countMuted}>Counting…</span>
                        )}
                    </div>

                    <section className={styles.modalSection}>
                        <h4 className={styles.sectionTitle}>Sections</h4>
                        <div className={styles.checkGrid}>
                            {SECTIONS.map((s) => {
                                const forced = s.key === 'raw' && format === 'xlsx';
                                // Only super admins impersonate and export this log: a report about
                                // people who can't leaves those sections out (the server decides; this shows it).
                                const notApplicable = SUPER_ADMIN_SECTIONS.includes(s.key) && preview.data?.impersonation_applies === false;
                                return (
                                    <label key={s.key} className={`${styles.check} ${forced || notApplicable ? styles.checkLocked : ''}`}>
                                        <input
                                            type="checkbox"
                                            checked={!notApplicable && (forced || sections.has(s.key))}
                                            disabled={forced || notApplicable}
                                            onChange={() => toggle(s.key)}
                                            data-testid={`export-section-${s.key}`}
                                        />
                                        <span>
                                            {s.key === 'raw' ? (format === 'xlsx' ? 'Raw data sheet' : 'Raw log appendix') : s.label}
                                            <small>
                                                {notApplicable
                                                    ? 'Left out: only super admins can do this, and the report covers none'
                                                    : s.key === 'raw'
                                                      ? format === 'xlsx'
                                                          ? 'Always included in Excel'
                                                          : `First ${PDF_APPENDIX_LIMIT.toLocaleString()} rows`
                                                      : s.hint}
                                            </small>
                                        </span>
                                    </label>
                                );
                            })}
                        </div>
                    </section>

                    <section className={styles.modalSection}>
                        <h4 className={styles.sectionTitle}>Format</h4>
                        <div className={styles.formatRow} role="radiogroup" aria-label="Format">
                            <label className={`${styles.formatOption} ${format === 'pdf' ? styles.formatOptionActive : ''}`}>
                                <input type="radio" name="export-format" value="pdf" checked={format === 'pdf'} onChange={() => setFormat('pdf')} data-testid="export-format-pdf" />
                                <span>
                                    PDF report
                                    <small>Charts and tables; members overview and flagged members</small>
                                </span>
                            </label>
                            <label className={`${styles.formatOption} ${format === 'xlsx' ? styles.formatOptionActive : ''}`}>
                                <input type="radio" name="export-format" value="xlsx" checked={format === 'xlsx'} onChange={() => setFormat('xlsx')} data-testid="export-format-xlsx" />
                                <span>
                                    Excel workbook (.xlsx)
                                    <small>One sheet per section, plus Raw data and Filters</small>
                                </span>
                            </label>
                        </div>
                        <label className={styles.check}>
                            <input type="checkbox" checked={mask} onChange={(e) => setMask(e.target.checked)} data-testid="export-mask" />
                            <span>
                                Mask emails
                                <small>Every address in the file becomes like w***m@unilag.edu.ng</small>
                            </span>
                        </label>
                    </section>

                    {noEvents && (
                        <div className={styles.info} data-testid="export-empty">
                            No events match these filters, so there&apos;s nothing to export. Change the filters, or tick Members to export the member list on its own.
                        </div>
                    )}
                    {nothingTicked && <div className={styles.info}>Tick at least one section.</div>}
                    {background && !noEvents && (
                        <div className={styles.info}>
                            This export has {events.toLocaleString()} rows (over {BACKGROUND_THRESHOLD.toLocaleString()}), so it will be built in the background in this tab, with progress and a download link at the top of the page. Keep the tab open until it finishes.
                        </div>
                    )}
                    {busy && <div className={styles.info}>Another export is still being built. Wait for it to finish or cancel it.</div>}
                    {error && <div className={styles.error} role="alert">{error}</div>}
                </div>

                <div className={styles.modalFooter}>
                    <span className={styles.footerNote}>{TIMEZONE_NOTE}. Every export is recorded in the activity log.</span>
                    <button type="button" className={`btn btn-secondary ${styles.action}`} onClick={onClose} disabled={submitting}>Cancel</button>
                    <button type="button" className={`btn btn-primary ${styles.action}`} onClick={download} disabled={!canDownload} data-testid="export-download">
                        {submitting ? 'Starting…' : background ? 'Start export' : 'Download'}
                    </button>
                </div>
            </div>
        </>
    );
}
