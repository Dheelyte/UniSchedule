'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { apiClient } from '@/lib/apiClient';
import { useToast } from '@/components/Toast/Toast';
import styles from './terms.module.css';
import { TermsSkeleton } from '@/components/Skeleton/Skeleton';

export default function TermsPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const { addToast } = useToast();

    const [sessions, setSessions] = useState([]);
    // semestersMap: { [sessionId]: semester[] }
    const [semestersMap, setSemestersMap] = useState({});
    // expandedSessions: Set of session IDs that are open
    const [expandedSessions, setExpandedSessions] = useState(new Set());
    const [loading, setLoading] = useState(true);

    const [sessionName, setSessionName] = useState('');
    // addingSemFor: session id currently adding a semester to
    const [addingSemFor, setAddingSemFor] = useState(null);
    const [semName, setSemName] = useState('');

    const currentYear = new Date().getFullYear();
    const sessionOptions = Array.from({ length: 6 }, (_, i) => {
        const y = currentYear - 3 + i;
        return `${y}/${y + 1}`;
    }).filter(opt => !sessions.some(s => s.name === opt));

    useEffect(() => {
        if (!authLoading) {
            if (!user) { router.push('/login'); return; }
            if (user.role !== 'SUPER_ADMIN') {
                router.push('/');
                addToast({ type: 'error', title: 'Unauthorized', message: 'Only Super Admins can manage terms.' });
                return;
            }
            fetchInitialData();
        }
    }, [user, authLoading]);

    const fetchInitialData = async () => {
        setLoading(true);
        try {
            const sessList = await apiClient.get('/calendar/sessions');
            setSessions(sessList);
            // Auto-expand the current session
            const current = sessList.find(s => s.is_current);
            if (current) {
                setExpandedSessions(new Set([current.id]));
                await fetchSemesters(current.id);
            }
        } catch (e) {
            console.error(e);
            addToast({ type: 'error', title: 'Error', message: 'Failed to load term configuration.' });
        }
        setLoading(false);
    };

    const fetchSemesters = async (sessId) => {
        if (semestersMap[sessId]) return; // already loaded
        try {
            const semList = await apiClient.get(`/calendar/sessions/${sessId}/semesters`);
            setSemestersMap(prev => ({ ...prev, [sessId]: semList }));
        } catch (e) {
            console.error(e);
        }
    };

    const toggleExpand = async (sessId) => {
        const next = new Set(expandedSessions);
        if (next.has(sessId)) {
            next.delete(sessId);
            setAddingSemFor(null);
        } else {
            next.add(sessId);
            await fetchSemesters(sessId);
        }
        setExpandedSessions(next);
    };

    const handleAddSession = async () => {
        if (!sessionName.trim()) return;
        try {
            const res = await apiClient.post('/calendar/sessions', { name: sessionName.trim() });
            setSessions(prev => [res, ...prev.map(s => ({ ...s, is_current: false }))]);
            setSessionName('');
            setExpandedSessions(new Set([res.id]));
            // Demote all semesters across all sessions in local state
            setSemestersMap(prev => {
                const updated = {};
                for (const id in prev) {
                    updated[id] = (prev[id] || []).map(s => ({ ...s, is_current: false }));
                }
                updated[res.id] = [];
                return updated;
            });
            addToast({ type: 'success', title: 'Created', message: 'Academic session created.' });
        } catch (e) {
            console.error(e);
            addToast({ type: 'error', title: 'Error', message: 'Failed to create session.' });
        }
    };

    const handleAddSemester = async (sessId) => {
        if (!semName) return;
        try {
            const res = await apiClient.post('/calendar/semesters', { name: semName, session_id: sessId });
            setSemestersMap(prev => ({
                ...prev,
                [sessId]: [...(prev[sessId] || []).map(s => ({ ...s, is_current: false })), res]
            }));
            setSemName('');
            setAddingSemFor(null);
            addToast({ type: 'success', title: 'Created', message: 'Semester created.' });
        } catch (e) {
            console.error(e);
            addToast({ type: 'error', title: 'Error', message: 'Failed to create semester.' });
        }
    };

    if (authLoading || loading) return <TermsSkeleton />;

    return (
        <div className={styles.page}>
            <div className={styles.pageHeader}>
                <div />
            </div>

            <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Academic Sessions</h3>

                {/* Add Session */}
                <div style={{ marginBottom: '20px', display: 'flex', gap: '8px' }}>
                    <select className="form-input" value={sessionName} onChange={(e) => setSessionName(e.target.value)}>
                        <option value="">— Select Academic Session —</option>
                        {sessionOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                    <button className="btn btn-primary" onClick={handleAddSession} disabled={!sessionName}>
                        Add Session
                    </button>
                </div>

                {/* Sessions accordion */}
                {sessions.length === 0 && (
                    <p style={{ color: 'var(--color-text-muted)', padding: '12px 0' }}>No sessions established.</p>
                )}
                <div className={styles.accordion}>
                    {sessions.map(s => {
                        const isOpen = expandedSessions.has(s.id);
                        const sems = semestersMap[s.id] || [];
                        const availSemOpts = ['First Semester', 'Second Semester'].filter(
                            opt => !sems.some(sem => sem.name === opt)
                        );

                        return (
                            <div key={s.id} className={`${styles.accordionItem} ${s.is_current ? styles.accordionItemCurrent : ''}`}>
                                {/* Session header row */}
                                <button className={styles.accordionHeader} onClick={() => toggleExpand(s.id)}>
                                    <div className={styles.accordionHeaderLeft}>
                                        <span className={styles.accordionTitle}>{s.name}</span>
                                        <span className={`badge ${s.is_current ? styles.badgeSuccess : styles.badgeNeutral}`}>
                                            {s.is_current ? 'Current' : 'Inactive'}
                                        </span>
                                    </div>
                                    <svg
                                        width="18" height="18" viewBox="0 0 24 24" fill="none"
                                        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                                        style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
                                    >
                                        <polyline points="6 9 12 15 18 9" />
                                    </svg>
                                </button>

                                {/* Expanded semesters */}
                                {isOpen && (
                                    <div className={styles.accordionBody}>
                                        {sems.length === 0 && (
                                            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', marginBottom: '12px' }}>
                                                No semesters defined for this session.
                                            </p>
                                        )}
                                        <div className={styles.semesterList}>
                                            {sems.map(sem => (
                                                <div key={sem.id} className={styles.semesterChip}>
                                                    <span className={styles.semesterChipName}>{sem.name}</span>
                                                    <span className={`badge ${sem.is_current ? styles.badgeSuccess : styles.badgeNeutral}`}>
                                                        {sem.is_current ? 'Current' : 'Inactive'}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>

                                        {/* Add semester inline — current session only */}
                                        {s.is_current ? (
                                            <>
                                                {availSemOpts.length > 0 && (
                                                    addingSemFor === s.id ? (
                                                        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                                                            <select className="form-input" value={semName} onChange={(e) => setSemName(e.target.value)}>
                                                                <option value="">— Select Semester —</option>
                                                                {availSemOpts.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                                            </select>
                                                            <button className="btn btn-primary" onClick={() => handleAddSemester(s.id)} disabled={!semName}>
                                                                Add
                                                            </button>
                                                            <button className="btn btn-secondary" onClick={() => { setAddingSemFor(null); setSemName(''); }}>
                                                                Cancel
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            className="btn btn-secondary"
                                                            style={{ marginTop: '12px' }}
                                                            onClick={() => { setAddingSemFor(s.id); setSemName(''); }}
                                                        >
                                                            + Add Semester
                                                        </button>
                                                    )
                                                )}
                                                {availSemOpts.length === 0 && (
                                                    <p style={{ fontSize: '0.8rem', color: '#10b981', marginTop: '8px' }}>✓ All semesters added</p>
                                                )}
                                            </>
                                        ) : (
                                            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '8px' }}>
                                                🔒 View only — semesters can only be added to the current session.
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
