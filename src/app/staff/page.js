'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { apiClient } from '@/lib/apiClient';
import { useToast } from '@/components/Toast/Toast';
import { useConfirm } from '@/components/ConfirmModal/ConfirmContext';
import styles from './staff.module.css';
import { TablePageSkeleton } from '@/components/Skeleton/Skeleton';

export default function StaffManagementPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const { addToast } = useToast();
    const confirm = useConfirm();

    const [users, setUsers] = useState([]);
    const [invitations, setInvitations] = useState([]);
    const [faculties, setFaculties] = useState([]);
    const [availableSemesters, setAvailableSemesters] = useState([]);

    const [loading, setLoading] = useState(true);

    // Modal states
    const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
    const [inviteForm, setInviteForm] = useState({
        email: '',
        role: 'FACULTY_EDITOR',
        facultyId: '',
        semesterId: ''
    });

    useEffect(() => {
        if (!authLoading) {
            if (!user) {
                router.push('/login');
                return;
            }
            if (user.role !== 'SUPER_ADMIN') {
                router.push('/');
                addToast({ type: 'error', title: 'Unauthorized', message: 'You need Super Admin access to manage staff.' });
                return;
            }
            fetchData();
        }
    }, [user, authLoading, router]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [usersData, invitesData, facultiesData] = await Promise.all([
                apiClient.get('/auth/users'),
                apiClient.get('/auth/invitations'),
                apiClient.get('/timetable/faculties')
            ]);
            setUsers(usersData || []);
            setInvitations(invitesData || []);
            setFaculties(facultiesData || []);

            const sessList = await apiClient.get(`/calendar/sessions`).catch(() => []);
            let allSems = [];
            for (let s of sessList) {
                const sems = await apiClient.get(`/calendar/sessions/${s.id}/semesters`);
                allSems.push(...sems.map(sem => ({ ...sem, sessionName: s.name })));
            }
            setAvailableSemesters(allSems);
        } catch (e) {
            console.error(e);
            addToast({ type: 'error', title: 'Failed to Fetch', message: 'Could not fetch staff records.' });
        }
        setLoading(false);
    };

    const handleCopyToken = async (token) => {
        try {
            await navigator.clipboard.writeText(token);
            addToast({ type: 'success', title: 'Copied', message: 'Token copied to clipboard.' });
        } catch (e) {
            addToast({ type: 'error', title: 'Copy Error', message: 'Failed to access clipboard.' });
        }
    };

    const handleInvite = async () => {
        if (!inviteForm.email) {
            addToast({ type: 'warning', title: 'Validation', message: 'Email address is required.' });
            return;
        }
        try {
            const payload = {
                email: inviteForm.email,
                target_role: inviteForm.role,
                faculty_id: inviteForm.role === 'FACULTY_EDITOR' ? inviteForm.facultyId : null,
                semester_id: inviteForm.semesterId ? parseInt(inviteForm.semesterId) : null
            };
            const response = await apiClient.post('/auth/invite', payload);
            addToast({ type: 'success', title: 'Invitation Generated', message: 'New setup token generated successfully.' });
            setIsInviteModalOpen(false);
            setInviteForm({ email: '', role: 'FACULTY_EDITOR', facultyId: '', semesterId: '' });
            fetchData(); // Reload constraints
        } catch (e) {
            console.error(e);
            addToast({ type: 'error', title: 'API Error', message: 'Failed to construct token constraint.' });
        }
    };

    const handleDeleteUser = async (userId, email) => {
        if (!await confirm(`Are you sure you want to completely remove ${email}?`)) return;
        try {
            await apiClient.delete(`/auth/users/${userId}`);
            addToast({ type: 'info', title: 'Deleted', message: 'User access immediately revoked.' });
            fetchData();
        } catch (e) {
            addToast({ type: 'error', title: 'API Error', message: 'Failed to revoke permissions.' });
        }
    };

    const handleDeleteInvite = async (invId) => {
        if (!await confirm(`Delete this outstanding system invitation natively?`)) return;
        try {
            await apiClient.delete(`/auth/invitations/${invId}`);
            addToast({ type: 'info', title: 'Revoked', message: 'Invitation destroyed securely.' });
            fetchData();
        } catch (e) {
            addToast({ type: 'error', title: 'API Error', message: 'Could not withdraw execution token.' });
        }
    };

    if (authLoading || loading) return <TablePageSkeleton columns={4} rows={5} hasFilters={false} />;

    return (
        <div className={styles.page}>
            <div className={styles.pageHeader}>
                <div />
                <div className={styles.headerActions}>
                    <button className={styles.btnPrimary} onClick={() => setIsInviteModalOpen(true)}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                            <circle cx="8.5" cy="7" r="4" />
                            <line x1="20" y1="8" x2="20" y2="14" />
                            <line x1="23" y1="11" x2="17" y2="11" />
                        </svg>
                        Invite Staff
                    </button>
                </div>
            </div>

            {/* Pending Invitations */}
            <div className={styles.section}>
                <h3 className={styles.sectionTitle}>
                    Pending Invitations
                    <span style={{ fontSize: '0.8rem', background: '#f1f5f9', padding: '4px 8px', borderRadius: '12px' }}>{invitations.length}</span>
                </h3>

                {invitations.length === 0 ? (
                    <div className={styles.emptyState}>No pending invitations outstanding.</div>
                ) : (
                    <div className={styles.tableWrapper}>
                        <table className={styles.table}>
                            <thead>
                                <tr>
                                    <th>Target Email</th>
                                    <th>Assigned Role</th>
                                    <th>Restricted Boundary</th>
                                    <th>Semester Override</th>
                                    <th>Register Token</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {invitations.map(inv => (
                                    <tr key={inv.id}>
                                        <td style={{ fontWeight: 600 }}>{inv.email}</td>
                                        <td>
                                            <span className={`${styles.roleBadge} ${inv.target_role === 'SUPER_ADMIN' ? styles.roleBadgeAdmin : ''}`}>
                                                {inv.target_role.replace('_', ' ')}
                                            </span>
                                        </td>
                                        <td>{inv.faculty_id ? (faculties.find(f => f.id === inv.faculty_id)?.name || inv.faculty_id) : 'Global'}</td>
                                        <td style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>
                                            {inv.semester_id ? (availableSemesters.find(s => s.id === inv.semester_id)?.name || `ID: ${inv.semester_id}`) : 'Global'}
                                        </td>
                                        <td>
                                            {inv.is_used ? (
                                                <span style={{ color: '#10b981', fontWeight: 'bold' }}>✓ Registered</span>
                                            ) : (
                                                <div className={styles.tokenField}>
                                                    {inv.token.substring(0, 15)}...
                                                    <button className={styles.copyBtn} onClick={() => handleCopyToken(inv.token)} title="Copy Full Token">
                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                                        </svg>
                                                    </button>
                                                </div>
                                            )}
                                        </td>
                                        <td>
                                            <button className={styles.btnDangerOutlined} onClick={() => handleDeleteInvite(inv.id)}>Revoke</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Active Accounts */}
            <div className={styles.section}>
                <h3 className={styles.sectionTitle}>
                    Active Access Lists
                    <span style={{ fontSize: '0.8rem', background: '#f1f5f9', padding: '4px 8px', borderRadius: '12px' }}>{users.length}</span>
                </h3>

                {users.length === 0 ? (
                    <div className={styles.emptyState}>No users registered systematically yet.</div>
                ) : (
                    <div className={styles.tableWrapper}>
                        <table className={styles.table}>
                            <thead>
                                <tr>
                                    <th>Authorized User</th>
                                    <th>Configured Role</th>
                                    <th>Boundary Profile</th>
                                    <th>Created Sequence</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.map(u => (
                                    <tr key={u.id}>
                                        <td style={{ fontWeight: 600 }}>{u.email}</td>
                                        <td>
                                            <span className={`${styles.roleBadge} ${u.role === 'SUPER_ADMIN' ? styles.roleBadgeAdmin : ''}`}>
                                                {u.role.replace('_', ' ')}
                                            </span>
                                        </td>
                                        <td>{u.faculty_id ? (faculties.find(f => f.id === u.faculty_id)?.name || u.faculty_id) : 'Global Architecture'}</td>
                                        <td style={{ color: '#64748b' }}>{new Date(u.created_at).toLocaleDateString()}</td>
                                        <td>
                                            {user.email !== u.email ? (
                                                <button className={styles.btnDangerOutlined} onClick={() => handleDeleteUser(u.id, u.email)}>Remove Access</button>
                                            ) : (
                                                <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Current Session</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {isInviteModalOpen && (
                <div className="modal-overlay" onClick={() => setIsInviteModalOpen(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Generate Setup Token</h3>
                            <button className="modal-close" onClick={() => setIsInviteModalOpen(false)}>✕</button>
                        </div>
                        <div className="modal-body">
                            <div className={styles.modalFormGroup}>
                                <label className={styles.modalFormLabel}>Staff Email Address</label>
                                <input
                                    className={styles.modalFormInput}
                                    type="email"
                                    required
                                    value={inviteForm.email}
                                    onChange={e => setInviteForm({ ...inviteForm, email: e.target.value })}
                                    placeholder="professor@unilag.edu.ng"
                                />
                            </div>

                            <div className={styles.modalFormGroup}>
                                <label className={styles.modalFormLabel}>Assigned System Role</label>
                                <select
                                    className={styles.modalFormInput}
                                    value={inviteForm.role}
                                    onChange={e => setInviteForm({ ...inviteForm, role: e.target.value })}
                                >
                                    <option value="FACULTY_EDITOR">Faculty Editor (Constrained)</option>
                                    <option value="SUPER_ADMIN">Super Administrator (Global)</option>
                                </select>
                            </div>

                            {inviteForm.role === 'FACULTY_EDITOR' && (
                                <div className={styles.modalFormGroup}>
                                    <label className={styles.modalFormLabel}>Assign Faculty Constraint</label>
                                    <select
                                        className={styles.modalFormInput}
                                        value={inviteForm.facultyId}
                                        onChange={e => setInviteForm({ ...inviteForm, facultyId: e.target.value })}
                                    >
                                        <option value="">Select Faculty...</option>
                                        {faculties.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                                    </select>
                                </div>
                            )}

                            <div className={styles.modalFormGroup}>
                                <label className={styles.modalFormLabel}>Restrict to Semester (Optional)</label>
                                <select
                                    className={styles.modalFormInput}
                                    value={inviteForm.semesterId}
                                    onChange={e => setInviteForm({ ...inviteForm, semesterId: e.target.value })}
                                >
                                    <option value="">Global / All Semesters</option>
                                    {availableSemesters.map(s => <option key={s.id} value={s.id}>{s.name} ({s.sessionName})</option>)}
                                </select>
                            </div>

                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setIsInviteModalOpen(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleInvite} disabled={!inviteForm.email || (inviteForm.role === 'FACULTY_EDITOR' && !inviteForm.facultyId)}>
                                Generate Setup Token
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
