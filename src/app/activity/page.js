'use client';

import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { apiClient } from '@/lib/apiClient';
import { useToast } from '@/components/Toast/Toast';
import { TablePageSkeleton } from '@/components/Skeleton/Skeleton';
import { ROLE_LABELS } from '@/lib/roles';
import FilterBar, { FilterChips } from './FilterBar';
import ExportAnalysisModal from './ExportAnalysisModal';
import ExportJobPanel from './ExportJobPanel';
import { formatLagos, isDefault, parseFilters, toApiParams, toSearchParams } from './filters';
import styles from './activity.module.css';

const PAGE_SIZE = 50;

function actionBadgeColor(action) {
    if (action.endsWith('.create')) return { bg: 'rgba(22, 163, 74, 0.12)', fg: '#15803d' };
    if (action.endsWith('.update')) return { bg: 'rgba(37, 99, 235, 0.12)', fg: '#1d4ed8' };
    if (action.endsWith('.delete') || action.endsWith('.invite_revoke')) return { bg: 'rgba(220, 38, 38, 0.12)', fg: '#b91c1c' };
    if (action === 'timetable.lock') return { bg: 'rgba(217, 119, 6, 0.15)', fg: '#b45309' };
    if (action === 'timetable.unlock') return { bg: 'rgba(8, 145, 178, 0.12)', fg: '#0e7490' };
    if (action === 'change_request.approve') return { bg: 'rgba(22, 163, 74, 0.12)', fg: '#15803d' };
    if (action === 'change_request.reject') return { bg: 'rgba(220, 38, 38, 0.12)', fg: '#b91c1c' };
    if (action === 'change_request.create') return { bg: 'rgba(37, 99, 235, 0.12)', fg: '#1d4ed8' };
    if (action.startsWith('auth.')) return { bg: 'rgba(139, 92, 246, 0.12)', fg: '#7c3aed' };
    if (action.startsWith('editor_access.')) return { bg: 'rgba(217, 119, 6, 0.15)', fg: '#b45309' };
    if (action === 'activity_log.export') return { bg: 'rgba(217, 119, 6, 0.15)', fg: '#b45309' };
    return { bg: 'var(--color-surface-2)', fg: 'var(--color-text-muted)' };
}

// The filters live in the URL, which a prerendered page can only read inside
// a Suspense boundary (node_modules/next/dist/docs: use-search-params.md).
export default function ActivityLogsPage() {
    return (
        <Suspense fallback={<TablePageSkeleton columns={5} rows={8} />}>
            <ActivityLogs />
        </Suspense>
    );
}

function ActivityLogs() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { addToast } = useToast();

    const allowed = user?.role === 'SUPER_ADMIN' || user?.role === 'SUPER_VIEWER';
    // Exporting checks the effective role on the server too: impersonating anyone hides it.
    const canExport = user?.role === 'SUPER_ADMIN' && !user?.impersonating;

    // The URL holds the filters (bookmarkable, shareable). A change shows at once
    // from local state while router.replace updates the address; Back, Forward
    // and opened links set the state from the URL.
    const urlQuery = searchParams.toString();
    const [filters, setLocalFilters] = useState(() => parseFilters(urlQuery));
    const [seenQuery, setSeenQuery] = useState(urlQuery);
    if (urlQuery !== seenQuery) {
        setSeenQuery(urlQuery);
        setLocalFilters(parseFilters(urlQuery));
    }
    const apiQuery = useMemo(() => toApiParams(filters).toString(), [filters]);
    const setFilters = useCallback(
        (next) => {
            setLocalFilters(next);
            const query = toSearchParams(next).toString();
            router.replace(query ? `/activity?${query}` : '/activity', { scroll: false });
        },
        [router],
    );

    const [options, setOptions] = useState(null);
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [reachedEnd, setReachedEnd] = useState(false);
    const [expandedId, setExpandedId] = useState(null);
    const [exportOpen, setExportOpen] = useState(false);
    const requestId = useRef(0);

    useEffect(() => {
        if (authLoading) return;
        if (!user) { router.push('/login'); return; }
        if (!allowed) {
            router.push('/');
            addToast({ type: 'error', title: 'Unauthorized', message: 'You do not have permission to view activity logs.' });
        }
    }, [authLoading, user, allowed]);

    useEffect(() => {
        if (!allowed) return;
        apiClient
            .get('/audit/logs/options')
            .then(setOptions)
            .catch((e) => console.error('Failed to load the filter choices', e));
    }, [allowed]);

    const load = useCallback(
        async (offset) => {
            const id = ++requestId.current;
            setLoading(true);
            setError(null);
            try {
                const data = (await apiClient.get(`/audit/logs?${apiQuery}&limit=${PAGE_SIZE}&offset=${offset}`)) || [];
                if (id !== requestId.current) return; // a newer filter won
                setLogs((prev) => (offset === 0 ? data : [...prev, ...data]));
                setReachedEnd(data.length < PAGE_SIZE);
            } catch (e) {
                if (id !== requestId.current) return;
                if (offset === 0) setLogs([]);
                setError(e?.message || 'Failed to load activity logs.');
            } finally {
                if (id === requestId.current) setLoading(false);
            }
        },
        [apiQuery],
    );

    useEffect(() => {
        if (!allowed) return;
        setExpandedId(null);
        load(0);
    }, [allowed, load]);

    if (authLoading) return <TablePageSkeleton columns={5} rows={8} />;
    if (!allowed) return null;

    const filtered = !isDefault(filters);

    return (
        <div className={styles.page}>
            <div className={styles.header}>
                <div>
                    <h2 className={styles.title}>Activity Logs</h2>
                    <p className={styles.subtitle}>Audit trail of major actions across the system. All times are Lagos time (WAT, UTC+01:00).</p>
                </div>
                {canExport && (
                    <div className={styles.headerActions}>
                        <button type="button" className="btn btn-primary" onClick={() => setExportOpen(true)} data-testid="export-analysis-button" data-tour="act-export">
                            Export analysis
                        </button>
                    </div>
                )}
            </div>

            <ExportJobPanel />

            <FilterBar value={filters} onChange={setFilters} options={options} roleLabels={ROLE_LABELS} idPrefix="page" />
            <FilterChips value={filters} onChange={setFilters} options={options} roleLabels={ROLE_LABELS} />

            {error && <div className={styles.error} role="alert">{error}</div>}

            <div className="table-container">
                <table className="data-table" data-testid="activity-table" data-tour="act-table">
                    <thead>
                        <tr>
                            <th style={{ width: 190 }}>When (Lagos)</th>
                            <th style={{ width: 200 }}>User</th>
                            <th style={{ width: 200 }}>Action</th>
                            <th>Description</th>
                            <th style={{ width: 70 }}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {logs.length === 0 && (
                            <tr>
                                <td colSpan={5} style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: 24 }}>
                                    {loading ? 'Loading…' : error ? 'Nothing to show.' : filtered ? 'No activity matches these filters.' : 'No activity recorded in the last 30 days.'}
                                </td>
                            </tr>
                        )}
                        {logs.map((row) => {
                            const expanded = expandedId === row.id;
                            const colors = actionBadgeColor(row.action);
                            const impersonation = row.extra?.impersonation;
                            return (
                                <Fragment key={row.id}>
                                    <tr>
                                        <td className={styles.whenCell}>{formatLagos(row.created_at)}</td>
                                        <td>
                                            <div style={{ fontSize: '0.85rem', fontWeight: 500 }}>{row.user_email || <span style={{ color: 'var(--color-text-muted)' }}>—</span>}</div>
                                            {row.user_role && (
                                                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                                                    {ROLE_LABELS[row.user_role] || row.user_role}{row.user_faculty_id ? ` · ${row.user_faculty_id}` : ''}
                                                    {impersonation ? ` · acting as (real role: ${ROLE_LABELS[impersonation.real_role] || impersonation.real_role})` : ''}
                                                </div>
                                            )}
                                        </td>
                                        <td>
                                            <span style={{ background: colors.bg, color: colors.fg, padding: '2px 8px', borderRadius: 6, fontSize: '0.75rem', fontWeight: 500 }}>{row.action}</span>
                                        </td>
                                        <td style={{ fontSize: '0.88rem' }}>{row.description}</td>
                                        <td>
                                            {row.extra && Object.keys(row.extra).length > 0 ? (
                                                <button className="btn btn-secondary" style={{ padding: '2px 10px', fontSize: '0.75rem' }} onClick={() => setExpandedId(expanded ? null : row.id)} data-tour="act-details">
                                                    {expanded ? 'Hide' : 'Details'}
                                                </button>
                                            ) : null}
                                        </td>
                                    </tr>
                                    {expanded && row.extra && (
                                        <tr>
                                            <td colSpan={5} style={{ background: 'var(--color-surface-2)', padding: 12 }}>
                                                <pre style={{ margin: 0, fontSize: '0.75rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                                    {JSON.stringify(row.extra, null, 2)}
                                                </pre>
                                            </td>
                                        </tr>
                                    )}
                                </Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {!reachedEnd && logs.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0' }}>
                    <button className="btn btn-secondary" onClick={() => load(logs.length)} disabled={loading} data-tour="act-more-rows">
                        {loading ? 'Loading…' : 'Load more'}
                    </button>
                </div>
            )}

            {canExport && exportOpen && (
                <ExportAnalysisModal
                    pageFilters={filters}
                    options={options}
                    roleLabels={ROLE_LABELS}
                    onClose={() => setExportOpen(false)}
                />
            )}
        </div>
    );
}
