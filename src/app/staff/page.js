'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { apiClient } from '@/lib/apiClient';
import { loadTerms } from '@/lib/loadTerms';
import { useToast } from '@/components/Toast/Toast';
import { useConfirm } from '@/components/ConfirmModal/ConfirmContext';
import styles from './staff.module.css';
import { TablePageSkeleton } from '@/components/Skeleton/Skeleton';
import { isCrossRealmRole, isFacultyScopedRole, ROLE_LABELS } from '@/lib/roles';
import { canOpenStaffPage } from '@/lib/editorAccess';
import { useEditorAccessActions } from '@/components/EditorAccess/useEditorAccessActions';
import RetractControls from '@/components/EditorAccess/RetractControls';

// Roles a super admin can give a registered account, in the invite list's order.
const EDITABLE_ROLES = ['FACULTY_EDITOR', 'FACULTY_VIEWER', 'HOD', 'GS_ADMIN', 'SUPER_ADMIN', 'SUPER_VIEWER', 'CITS_ADMIN', 'DEO'];

export default function StaffManagementPage() {
    const { user, loading: authLoading, realmName, editorAccess } = useAuth();
    const { grant, reverse, busy: editorAccessBusy } = useEditorAccessActions();
    // The listing holds this realm's accounts plus the cross-realm ones (no realm).
    const programmeLabel = (realmKey) => (realmKey ? realmName || realmKey : 'All programmes');
    const router = useRouter();
    const { addToast } = useToast();
    const confirm = useConfirm();

    const [users, setUsers] = useState([]);
    const [invitations, setInvitations] = useState([]);
    const [faculties, setFaculties] = useState([]);
    const [availableSemesters, setAvailableSemesters] = useState([]);
    // Super admins: every editor access handed over in this realm right now.
    const [handovers, setHandovers] = useState([]);

    const [loading, setLoading] = useState(true);

    // Modal states
    const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
    const [isInviting, setIsInviting] = useState(false);
    const [inviteForm, setInviteForm] = useState({
        email: '',
        role: 'FACULTY_EDITOR',
        facultyId: '',
        semesterId: ''
    });

    // The account whose role is being edited, and the form prefilled from it.
    const [editingUser, setEditingUser] = useState(null);
    const [isSavingRole, setIsSavingRole] = useState(false);
    const [roleForm, setRoleForm] = useState({ role: '', facultyId: '', semesterId: '' });

    useEffect(() => {
        if (!authLoading) {
            if (!user) {
                router.push('/login');
                return;
            }
            if (!canOpenStaffPage(user.role, editorAccess)) {
                router.push('/');
                addToast({ type: 'error', title: 'Unauthorized', message: 'You need Super Admin or Faculty Editor access to manage staff.' });
                return;
            }
            // An editor who handed their access over only sees the controls to take it back.
            if (user.role === 'FACULTY_VIEWER') {
                setLoading(false);
                return;
            }
            if (user.role === 'FACULTY_EDITOR') {
                setInviteForm(prev => ({ ...prev, role: 'DEO' }));
            }
            fetchData();
        }
    }, [user, authLoading, router, editorAccess]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [usersData, invitesData, facultiesData, handoversData] = await Promise.all([
                apiClient.get('/auth/users'),
                apiClient.get('/auth/invitations'),
                apiClient.get('/timetable/faculties'),
                user?.role === 'SUPER_ADMIN' ? apiClient.get('/editor-access/handovers') : Promise.resolve([])
            ]);
            setUsers(usersData || []);
            setInvitations(invitesData || []);
            setFaculties(facultiesData || []);
            setHandovers(handoversData || []);

            const { semesters: allSems } = await loadTerms();
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
        setIsInviting(true);
        try {
            const facultyScoped = isFacultyScopedRole(inviteForm.role);
            const payload = {
                email: inviteForm.email,
                target_role: inviteForm.role,
                faculty_id: facultyScoped ? inviteForm.facultyId : null,
                semester_id: inviteForm.semesterId ? parseInt(inviteForm.semesterId) : null
            };
            const response = await apiClient.post('/auth/invite', payload);
            addToast({ type: 'success', title: 'Invitation Generated', message: 'Invitation email sent successfully.' });
            setIsInviteModalOpen(false);
            setInviteForm({ email: '', role: user?.role === 'FACULTY_EDITOR' ? 'DEO' : 'FACULTY_EDITOR', facultyId: '', semesterId: '' });
            fetchData(); // Reload constraints
        } catch (e) {
            console.error(e);
            addToast({ type: 'error', title: 'Invitation Failed', message: e.message || 'Failed to construct token constraint.' });
        } finally {
            setIsInviting(false);
        }
    };

    const handleDeleteUser = async (userId, email) => {
        if (!await confirm(`Are you sure you want to completely remove ${email}?`)) return;
        try {
            await apiClient.delete(`/auth/users/${userId}`);
            addToast({ type: 'info', title: 'Deleted', message: 'User access immediately revoked.' });
            fetchData();
        } catch (e) {
            addToast({ type: 'error', title: 'API Error', message: e.message || 'Failed to revoke permissions.' });
        }
    };

    const openEditRole = (u) => {
        setRoleForm({ role: u.role, facultyId: u.faculty_id || '', semesterId: u.semester_id ? String(u.semester_id) : '' });
        setEditingUser(u);
    };

    const closeEditRole = () => {
        if (!isSavingRole) setEditingUser(null);
    };

    // What Save would send: a faculty only applies to faculty-scoped roles.
    const roleFormFacultyId = isFacultyScopedRole(roleForm.role) ? (roleForm.facultyId || null) : null;
    const roleFormSemesterId = roleForm.semesterId ? parseInt(roleForm.semesterId) : null;
    const roleFormChanged = !!editingUser && (
        roleForm.role !== editingUser.role ||
        roleFormFacultyId !== (editingUser.faculty_id || null) ||
        roleFormSemesterId !== (editingUser.semester_id || null)
    );
    const roleFormMissingFaculty = isFacultyScopedRole(roleForm.role) && !roleForm.facultyId;

    const handleSaveRole = async () => {
        const from = ROLE_LABELS[editingUser.role] || editingUser.role;
        const to = ROLE_LABELS[roleForm.role] || roleForm.role;
        const question = roleForm.role === editingUser.role
            ? `Update ${editingUser.email}'s ${to} access?`
            : `Change ${editingUser.email} from ${from} to ${to}?`;
        if (!await confirm(question)) return;
        setIsSavingRole(true);
        try {
            await apiClient.patch(`/auth/users/${editingUser.id}`, {
                role: roleForm.role,
                faculty_id: roleFormFacultyId,
                semester_id: roleFormSemesterId
            });
            addToast({ type: 'success', title: 'Role Updated', message: `${editingUser.email} is now ${to}.` });
            setEditingUser(null);
            fetchData();
        } catch (e) {
            addToast({ type: 'error', title: 'Update Failed', message: e.message || 'Could not change this role.' });
        } finally {
            setIsSavingRole(false);
        }
    };

    const handleDeleteInvite = async (invId) => {
        if (!await confirm(`Delete this outstanding system invitation natively?`)) return;
        try {
            await apiClient.delete(`/auth/invitations/${invId}`);
            addToast({ type: 'info', title: 'Revoked', message: 'Invitation destroyed securely.' });
            fetchData();
        } catch (e) {
            addToast({ type: 'error', title: 'API Error', message: e.message || 'Could not withdraw execution token.' });
        }
    };

    // Viewers of the editor's faculty who may receive the access, if they may hand it over.
    const grantableIds = new Set(editorAccess.can_grant ? editorAccess.candidates.map(c => c.id) : []);
    const facultyName = (facultyId) => faculties.find(f => f.id === facultyId)?.name || facultyId;

    // Granting turns this editor into a viewer; the page then shows the retract controls.
    const handleGrant = (u) => grant(u, facultyName(user.faculty_id));

    const handleReverse = async (handover) => {
        if (await reverse(handover)) fetchData();
    };

    if (authLoading || loading) return <TablePageSkeleton columns={4} rows={5} hasFilters={false} />;

    if (user?.role === 'FACULTY_VIEWER') {
        return (
            <div className={styles.page}>
                {editorAccess.granted && (
                    <div className={styles.section}>
                        <h3 className={styles.sectionTitle}>Your Editor Access</h3>
                        <div className={styles.handoverPanel}>
                            <RetractControls handover={editorAccess.granted} candidates={editorAccess.candidates} />
                        </div>
                    </div>
                )}
            </div>
        );
    }

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

            {editorAccess.received && (
                <div className={styles.handoverNote}>
                    {editorAccess.received.granted_by.email} gave you their Faculty Editor access. You can do everything a
                    Faculty Editor can, but only they can take it back or pass it on.
                </div>
            )}

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
                                    <th>Programme</th>
                                    <th>Restriction</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {invitations.map(inv => (
                                    <tr key={inv.id}>
                                        <td style={{ fontWeight: 600 }}>{inv.email}</td>
                                        <td>
                                            <span className={`${styles.roleBadge} ${inv.target_role === 'SUPER_ADMIN' || inv.target_role === 'CITS_ADMIN' ? styles.roleBadgeAdmin : ''}`}>
                                                {inv.target_role === 'CITS_ADMIN' ? 'SUPER ADMINISTRATOR (CITS)' : inv.target_role === 'HOD' ? 'FACULTY VIEWER (HOD)' : inv.target_role.replace('_', ' ')}
                                            </span>
                                        </td>
                                        <td>{programmeLabel(inv.realm_key)}</td>
                                        <td>{inv.faculty_id ? (faculties.find(f => f.id === inv.faculty_id)?.name || inv.faculty_id) : 'Global'}</td>
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
                                    <th>Role</th>
                                    <th>Programme</th>
                                    <th>Restriction</th>
                                    <th>Access Date</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.map(u => (
                                    <tr key={u.id}>
                                        <td style={{ fontWeight: 600 }}>{u.email}</td>
                                        <td>
                                            <span className={`${styles.roleBadge} ${u.role === 'SUPER_ADMIN' || u.role === 'CITS_ADMIN' ? styles.roleBadgeAdmin : ''}`}>
                                                {u.role === 'GS_ADMIN' ? 'GENERAL STUDIES' : u.role === 'CITS_ADMIN' ? 'SUPER ADMINISTRATOR (CITS)' : u.role === 'HOD' ? 'FACULTY VIEWER (HOD)' : u.role.replace('_', ' ')}
                                            </span>
                                        </td>
                                        <td>{programmeLabel(u.realm_key)}</td>
                                        <td>{u.faculty_id ? (faculties.find(f => f.id === u.faculty_id)?.name || u.faculty_id) : 'Global'}</td>
                                        <td style={{ color: '#64748b' }}>{new Date(u.created_at).toLocaleDateString()}</td>
                                        <td>
                                            {user.email !== u.email ? (
                                                <div className={styles.rowActions}>
                                                    {user.role === 'SUPER_ADMIN' && (
                                                        <button className={styles.btnSecondaryOutlined} onClick={() => openEditRole(u)}>Edit Role</button>
                                                    )}
                                                    {grantableIds.has(u.id) && (
                                                        <button className={styles.btnSecondaryOutlined} onClick={() => handleGrant(u)} disabled={editorAccessBusy}>Grant Editor Access</button>
                                                    )}
                                                    <button className={styles.btnDangerOutlined} onClick={() => handleDeleteUser(u.id, u.email)}>Remove Access</button>
                                                </div>
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

            {/* Editor access handed from a Faculty Editor to a Faculty Viewer */}
            {user.role === 'SUPER_ADMIN' && (
                <div className={styles.section}>
                    <h3 className={styles.sectionTitle}>
                        Active Editor Handovers
                        <span style={{ fontSize: '0.8rem', background: '#f1f5f9', padding: '4px 8px', borderRadius: '12px' }}>{handovers.length}</span>
                    </h3>

                    {handovers.length === 0 ? (
                        <div className={styles.emptyState}>No Faculty Editor has handed over their access.</div>
                    ) : (
                        <div className={styles.tableWrapper}>
                            <table className={styles.table}>
                                <thead>
                                    <tr>
                                        <th>Faculty</th>
                                        <th>Original Editor</th>
                                        <th>Current Holder</th>
                                        <th>Since</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {handovers.map(h => (
                                        <tr key={h.id}>
                                            <td>{h.faculty_name}</td>
                                            <td style={{ fontWeight: 600 }}>{h.granted_by.email}</td>
                                            <td style={{ fontWeight: 600 }}>{h.holder.email}</td>
                                            <td style={{ color: '#64748b' }}>{new Date(h.started_at).toLocaleDateString()}</td>
                                            <td>
                                                <button className={styles.btnDangerOutlined} onClick={() => handleReverse(h)} disabled={editorAccessBusy}>Reverse</button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {isInviteModalOpen && (
                <div className="modal-overlay" onClick={() => setIsInviteModalOpen(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Invite Staff</h3>
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
                                    {user?.role === 'FACULTY_EDITOR' ? (
                                        <option value="DEO">Departmental Examination Officer</option>
                                    ) : (
                                        <>
                                            <option value="FACULTY_EDITOR">Faculty Editor</option>
                                            <option value="FACULTY_VIEWER">Faculty Viewer</option>
                                            <option value="HOD">Faculty Viewer (HOD)</option>
                                            <option value="GS_ADMIN">General Studies Admin</option>
                                            <option value="SUPER_ADMIN">Super Administrator</option>
                                            <option value="SUPER_VIEWER">Super Administrator (View only)</option>
                                            <option value="CITS_ADMIN">Super Administrator (CITS)</option>
                                            <option value="DEO">Departmental Examination Officer</option>
                                        </>
                                    )}
                                </select>
                            </div>

                            {isFacultyScopedRole(inviteForm.role) && user?.role !== 'FACULTY_EDITOR' && (
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

                            <p style={{ fontSize: '0.8rem', color: '#64748b', margin: 0 }}>
                                {isCrossRealmRole(inviteForm.role)
                                    ? 'This role works across all programmes.'
                                    : `This account will belong to the ${realmName} portal.`}
                            </p>

                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setIsInviteModalOpen(false)} disabled={isInviting}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleInvite} disabled={!inviteForm.email || (isFacultyScopedRole(inviteForm.role) && user?.role !== 'FACULTY_EDITOR' && !inviteForm.facultyId) || isInviting}>
                                {isInviting ? 'Sending...' : 'Send Invitation Email'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {editingUser && (
                <div className="modal-overlay" onClick={closeEditRole}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Edit Role</h3>
                            <button className="modal-close" onClick={closeEditRole}>✕</button>
                        </div>
                        <div className="modal-body">
                            <div className={styles.modalFormGroup}>
                                <label className={styles.modalFormLabel}>Staff Email Address</label>
                                <input
                                    className={`${styles.modalFormInput} ${styles.modalReadOnly}`}
                                    type="email"
                                    value={editingUser.email}
                                    readOnly
                                />
                            </div>

                            <div className={styles.modalFormGroup}>
                                <label className={styles.modalFormLabel}>Assigned System Role</label>
                                <select
                                    className={styles.modalFormInput}
                                    value={roleForm.role}
                                    onChange={e => setRoleForm({ ...roleForm, role: e.target.value })}
                                >
                                    {EDITABLE_ROLES.map(role => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
                                </select>
                            </div>

                            {isFacultyScopedRole(roleForm.role) && (
                                <div className={styles.modalFormGroup}>
                                    <label className={styles.modalFormLabel}>Assign Faculty Constraint</label>
                                    <select
                                        className={styles.modalFormInput}
                                        value={roleForm.facultyId}
                                        onChange={e => setRoleForm({ ...roleForm, facultyId: e.target.value })}
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
                                    value={roleForm.semesterId}
                                    onChange={e => setRoleForm({ ...roleForm, semesterId: e.target.value })}
                                >
                                    <option value="">Global / All Semesters</option>
                                    {availableSemesters.map(s => <option key={s.id} value={s.id}>{s.name} ({s.sessionName})</option>)}
                                </select>
                            </div>

                            <p style={{ fontSize: '0.8rem', color: '#64748b', margin: 0 }}>
                                {isCrossRealmRole(roleForm.role)
                                    ? 'This role works across all programmes.'
                                    : `This account will belong to the ${realmName} portal.`}
                            </p>

                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={closeEditRole} disabled={isSavingRole}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleSaveRole} disabled={!roleFormChanged || roleFormMissingFaculty || isSavingRole}>
                                {isSavingRole ? 'Saving...' : 'Save Changes'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
