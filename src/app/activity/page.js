'use client';

import { Fragment, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { apiClient } from '@/lib/apiClient';
import { useToast } from '@/components/Toast/Toast';
import { TablePageSkeleton } from '@/components/Skeleton/Skeleton';

const PAGE_SIZE = 50;

const ACTION_GROUPS = [
    { value: '', label: 'All actions' },
    { value: 'course.', label: 'Courses' },
    { value: 'schedule_item.', label: 'Schedule items' },
    { value: 'timetable.', label: 'Timetable locks / requests' },
    { value: 'change_request.', label: 'Change requests' },
    { value: 'blocked_slot.', label: 'Blocked slots' },
    { value: 'faculty.', label: 'Faculties' },
    { value: 'department.', label: 'Departments' },
    { value: 'room.', label: 'Rooms' },
    { value: 'user.', label: 'Users / invitations' },
    { value: 'auth.', label: 'Auth' },
];

function formatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString();
}

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
    return { bg: 'var(--color-surface-2)', fg: 'var(--color-text-muted)' };
}

export default function ActivityLogsPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const { addToast } = useToast();

    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [actionPrefix, setActionPrefix] = useState('');
    const [offset, setOffset] = useState(0);
    const [reachedEnd, setReachedEnd] = useState(false);
    const [expandedId, setExpandedId] = useState(null);

    const allowed = user?.role === 'SUPER_ADMIN' || user?.role === 'SUPER_VIEWER';

    useEffect(() => {
        if (!authLoading) {
            if (!user) { router.push('/login'); return; }
            if (!allowed) {
                router.push('/');
                addToast({ type: 'error', title: 'Unauthorized', message: 'You do not have permission to view activity logs.' });
            }
        }
    }, [authLoading, user, allowed]);

    const load = useCallback(async (resetOffset = false) => {
        if (!allowed) return;
        setLoading(true);
        try {
            const o = resetOffset ? 0 : offset;
            const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(o) });
            if (actionPrefix) params.set('action_prefix', actionPrefix);
            const data = await apiClient.get(`/audit/logs?${params.toString()}`);
            const next = data || [];
            if (resetOffset) {
                setLogs(next);
                setOffset(next.length);
            } else {
                setLogs((prev) => [...prev, ...next]);
                setOffset((prev) => prev + next.length);
            }
            setReachedEnd(next.length < PAGE_SIZE);
        } catch (e) {
            console.error('Failed to load activity logs', e);
            addToast({ type: 'error', title: 'Error', message: e?.message || 'Failed to load activity logs.' });
        } finally {
            setLoading(false);
        }
    }, [actionPrefix, offset, allowed]);

    useEffect(() => {
        if (allowed) load(true);
    }, [actionPrefix, allowed]);

    if (authLoading || (loading && logs.length === 0)) return <TablePageSkeleton columns={5} rows={8} />;
    if (!allowed) return null;

    return (
        <div style={{ padding: '0 4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
                <div>
                    <h2 style={{ margin: 0 }}>Activity Logs</h2>
                    <p style={{ margin: '4px 0 0', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                        Audit trail of major actions across the system.
                    </p>
                </div>
                <select className="form-select form-input" value={actionPrefix} onChange={(e) => setActionPrefix(e.target.value)} style={{ maxWidth: 260 }}>
                    {ACTION_GROUPS.map((g) => (
                        <option key={g.label} value={g.value}>{g.label}</option>
                    ))}
                </select>
            </div>

            <div className="table-container">
                <table className="data-table">
                    <thead>
                        <tr>
                            <th style={{ width: 170 }}>When</th>
                            <th style={{ width: 200 }}>User</th>
                            <th style={{ width: 200 }}>Action</th>
                            <th>Description</th>
                            <th style={{ width: 70 }}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {logs.length === 0 && (
                            <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: 24 }}>No activity recorded yet.</td></tr>
                        )}
                        {logs.map((row) => {
                            const expanded = expandedId === row.id;
                            const colors = actionBadgeColor(row.action);
                            return (
                                <Fragment key={row.id}>
                                    <tr>
                                        <td style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{formatTime(row.created_at)}</td>
                                        <td>
                                            <div style={{ fontSize: '0.85rem', fontWeight: 500 }}>{row.user_email || <span style={{ color: 'var(--color-text-muted)' }}>—</span>}</div>
                                            {row.user_role && (
                                                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                                                    {row.user_role}{row.user_faculty_id ? ` · ${row.user_faculty_id}` : ''}
                                                </div>
                                            )}
                                        </td>
                                        <td>
                                            <span style={{ background: colors.bg, color: colors.fg, padding: '2px 8px', borderRadius: 6, fontSize: '0.75rem', fontWeight: 500 }}>{row.action}</span>
                                        </td>
                                        <td style={{ fontSize: '0.88rem' }}>{row.description}</td>
                                        <td>
                                            {row.extra && Object.keys(row.extra).length > 0 ? (
                                                <button className="btn btn-secondary" style={{ padding: '2px 10px', fontSize: '0.75rem' }} onClick={() => setExpandedId(expanded ? null : row.id)}>
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
                    <button className="btn btn-secondary" onClick={() => load(false)} disabled={loading}>
                        {loading ? 'Loading…' : 'Load more'}
                    </button>
                </div>
            )}
        </div>
    );
}
