'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { apiClient } from '@/lib/apiClient';
import { useToast } from '@/components/Toast/Toast';
import { TablePageSkeleton } from '@/components/Skeleton/Skeleton';

const STATUS_FILTERS = [
    { value: 'PENDING', label: 'Pending' },
    { value: 'APPROVED', label: 'Approved' },
    { value: 'REJECTED', label: 'Rejected' },
    { value: '', label: 'All' },
];

const ACTION_LABEL = { ADD: 'Add', MODIFY: 'Modify', REMOVE: 'Remove' };

const STATUS_COLORS = {
    PENDING: { bg: 'rgba(217, 119, 6, 0.15)', fg: '#b45309' },
    APPROVED: { bg: 'rgba(22, 163, 74, 0.12)', fg: '#15803d' },
    REJECTED: { bg: 'rgba(220, 38, 38, 0.12)', fg: '#b91c1c' },
};

function formatTime(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString();
}

const hhmm = (t) => (t ? String(t).slice(0, 5) : '');

export default function ChangeRequestsPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const { addToast } = useToast();

    const [requests, setRequests] = useState([]);
    const [rooms, setRooms] = useState([]);
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState('PENDING');
    const [expandedId, setExpandedId] = useState(null);
    const [notes, setNotes] = useState({});
    const [busyId, setBusyId] = useState(null);

    const allowed = user?.role === 'SUPER_ADMIN' || user?.role === 'SUPER_VIEWER';
    const canReview = user?.role === 'SUPER_ADMIN';

    useEffect(() => {
        if (!authLoading) {
            if (!user) { router.push('/login'); return; }
            if (!allowed) {
                router.push('/');
                addToast({ type: 'error', title: 'Unauthorized', message: 'You do not have permission to view change requests.' });
            }
        }
    }, [authLoading, user, allowed]);

    const roomName = useCallback((id) => rooms.find((r) => r.id === id)?.name || `Room #${id}`, [rooms]);

    const load = useCallback(async () => {
        if (!allowed) return;
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (status) params.set('status', status);
            const [data, roomData] = await Promise.all([
                apiClient.get(`/timetable/change-requests?${params.toString()}`),
                apiClient.get('/timetable/rooms?all=true').catch(() => []),
            ]);
            setRequests(data || []);
            setRooms(roomData || []);
        } catch (e) {
            console.error('Failed to load change requests', e);
            addToast({ type: 'error', title: 'Error', message: e?.message || 'Failed to load change requests.' });
        } finally {
            setLoading(false);
        }
    }, [status, allowed]);

    useEffect(() => {
        if (allowed) load();
    }, [status, allowed]);

    const review = async (id, approve) => {
        setBusyId(id);
        try {
            await apiClient.post(`/timetable/change-requests/${id}/review`, { approve, note: notes[id]?.trim() || null });
            addToast({
                type: 'success',
                title: approve ? 'Request Approved' : 'Request Rejected',
                message: approve ? 'The change has been applied to the timetable.' : 'The requester has been notified.',
            });
            await load();
        } catch (e) {
            addToast({ type: 'error', title: 'Action Failed', message: e?.message || 'Unable to process this request.' });
        } finally {
            setBusyId(null);
        }
    };

    if (authLoading || (loading && requests.length === 0)) return <TablePageSkeleton columns={5} rows={6} />;
    if (!allowed) return null;

    const renderProposed = (r) => {
        if (r.action === 'REMOVE') return <span style={{ color: 'var(--color-text-muted)' }}>Remove the existing session</span>;
        const when = r.timetable_type === 'exam' ? r.exam_date : r.day_of_week;
        const roomsLabel = (r.room_ids && r.room_ids.length) ? r.room_ids.map(roomName).join(', ') : 'No room';
        return <span>{when || '—'} · {hhmm(r.start_time)}–{hhmm(r.end_time)} · {roomsLabel}</span>;
    };

    return (
        <div style={{ padding: '0 4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
                <div>
                    <h2 style={{ margin: 0 }}>Change Requests</h2>
                    <p style={{ margin: '4px 0 0', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                        Course-schedule changes proposed by faculty and other roles. Approving applies the change directly.
                    </p>
                </div>
                <select className="form-select form-input" value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 200 }}>
                    {STATUS_FILTERS.map((s) => <option key={s.label} value={s.value}>{s.label}</option>)}
                </select>
            </div>

            <div className="table-container">
                <table className="data-table">
                    <thead>
                        <tr>
                            <th style={{ width: 150 }}>Requested</th>
                            <th style={{ width: 180 }}>By</th>
                            <th style={{ width: 90 }}>Type</th>
                            <th>Change</th>
                            <th style={{ width: 110 }}>Status</th>
                            <th style={{ width: 90 }}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {requests.length === 0 && (
                            <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: 24 }}>No change requests.</td></tr>
                        )}
                        {requests.map((r) => {
                            const expanded = expandedId === r.id;
                            const sc = STATUS_COLORS[r.status] || {};
                            return (
                                <Fragment key={r.id}>
                                    <tr>
                                        <td style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{formatTime(r.created_at)}</td>
                                        <td style={{ fontSize: '0.85rem' }}>{r.requester_email || '—'}</td>
                                        <td style={{ fontSize: '0.82rem', textTransform: 'capitalize' }}>{r.timetable_type}</td>
                                        <td style={{ fontSize: '0.88rem' }}>
                                            <strong>{ACTION_LABEL[r.action] || r.action}</strong> · {r.course_code || `Course #${r.course_id}`}
                                            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: 2 }}>{renderProposed(r)}</div>
                                        </td>
                                        <td>
                                            <span style={{ background: sc.bg, color: sc.fg, padding: '2px 8px', borderRadius: 6, fontSize: '0.75rem', fontWeight: 500 }}>{r.status}</span>
                                        </td>
                                        <td>
                                            <button className="btn btn-secondary" style={{ padding: '2px 10px', fontSize: '0.75rem' }} onClick={() => setExpandedId(expanded ? null : r.id)}>
                                                {expanded ? 'Hide' : 'View'}
                                            </button>
                                        </td>
                                    </tr>
                                    {expanded && (
                                        <tr>
                                            <td colSpan={6} style={{ background: 'var(--color-surface-2)', padding: 16 }}>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: '0.85rem' }}>
                                                    {r.course_title && <div><strong>Course:</strong> {r.course_code} — {r.course_title}</div>}
                                                    <div><strong>Proposed:</strong> {renderProposed(r)}</div>
                                                    <div><strong>Reason:</strong> {r.reason || <span style={{ color: 'var(--color-text-muted)' }}>—</span>}</div>
                                                    {r.review_note && <div><strong>Review note:</strong> {r.review_note}</div>}
                                                    {r.status === 'PENDING' && canReview && (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4, maxWidth: 560 }}>
                                                            <textarea
                                                                className="form-input"
                                                                placeholder="Optional note to the requester…"
                                                                rows={2}
                                                                value={notes[r.id] || ''}
                                                                onChange={(e) => setNotes((p) => ({ ...p, [r.id]: e.target.value }))}
                                                            />
                                                            <div style={{ display: 'flex', gap: 10 }}>
                                                                <button className="btn btn-primary" disabled={busyId === r.id} onClick={() => review(r.id, true)}>
                                                                    {busyId === r.id ? 'Working…' : 'Approve & Apply'}
                                                                </button>
                                                                <button className="btn btn-secondary" disabled={busyId === r.id} onClick={() => review(r.id, false)}>
                                                                    Reject
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
