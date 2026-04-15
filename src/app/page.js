'use client';

import styles from './page.module.css';
import Link from 'next/link';
import { useEffect, useState, useMemo } from 'react';
import { useApp, ACTION_TYPES } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { apiClient } from '@/lib/apiClient';
import { DashboardSkeleton } from '@/components/Skeleton/Skeleton';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const TIMELINE_COLORS = ['#6366f1', '#0891b2', '#059669', '#d97706', '#db2777', '#2563eb', '#ea580c', '#8b5cf6'];
const BAR_COLORS = ['#6366f1', '#0891b2', '#059669', '#d97706', '#db2777', '#2563eb', '#16a34a', '#ea580c'];

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function DashboardPage() {
  const { state, stats, dispatch, getSchedulesWithDetails } = useApp();
  const { user } = useAuth();
  const [currentTerm, setCurrentTerm] = useState(null);
  const [currentSession, setCurrentSession] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function loadDashboard() {
      try {
        const [faculties, departments, rooms, courses, scheduleItems, semester, sessions] = await Promise.all([
          apiClient.get('/timetable/faculties').catch(() => []),
          apiClient.get('/timetable/departments').catch(() => []),
          apiClient.get('/timetable/rooms').catch(() => []),
          apiClient.get('/timetable/courses').catch(() => []),
          apiClient.get('/timetable/schedule-items').catch(() => []),
          apiClient.get('/calendar/semesters/current').catch(() => null),
          apiClient.get('/calendar/sessions').catch(() => []),
        ]);
        if (mounted) {
          dispatch({
            type: ACTION_TYPES.INIT_STATE,
            payload: {
              faculties: faculties || [],
              departments: (departments || []).map(d => ({ ...d, facultyId: d.faculty_id })),
              rooms: rooms || [],
              courses: (courses || []).map(c => ({ ...c, creditLoad: c.credit_load, departmentId: c.department_id })),
              scheduleItems: (scheduleItems || []).map(s => ({
                ...s,
                courseId: s.course_id,
                roomIds: s.room_ids,
                facultyId: s.faculty_id,
                day: s.day_of_week,
                startTime: s.start_time,
                endTime: s.end_time
              }))
            }
          });
          setCurrentTerm(semester);
          const active = (sessions || []).find(s => s.is_current);
          setCurrentSession(active || null);
          setLoaded(true);
        }
      } catch (e) { console.error('Dashboard sync error', e); }
    }
    loadDashboard();
    return () => { mounted = false; };
  }, [dispatch]);

  const today = DAYS[new Date().getDay() - 1] || null;

  // Today's schedule sorted by start time
  const todaySchedules = useMemo(() => {
    if (!today) return [];
    return getSchedulesWithDetails
      .filter(s => s.type === 'lecture' && s.day === today)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [getSchedulesWithDetails, today]);

  // Faculty distribution
  const facultyDistribution = useMemo(() => {
    const map = {};
    state.faculties.forEach(f => { map[f.id] = { name: f.name, courses: 0, schedules: 0 }; });
    const deptFacultyMap = {};
    state.departments.forEach(d => { deptFacultyMap[d.id] = d.facultyId; });
    state.courses.forEach(c => {
      const fId = deptFacultyMap[c.departmentId];
      if (fId && map[fId]) map[fId].courses++;
    });
    state.scheduleItems.forEach(s => {
      if (s.facultyId && map[s.facultyId]) map[s.facultyId].schedules++;
    });
    return Object.entries(map)
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.courses - a.courses);
  }, [state]);

  const maxFacultyCourses = Math.max(1, ...facultyDistribution.map(f => f.courses));

  // Room utilization (top 8)
  const roomUtilization = useMemo(() => {
    const roomCountMap = {};
    state.scheduleItems.forEach(s => {
      (s.roomIds || []).forEach(rid => {
        roomCountMap[rid] = (roomCountMap[rid] || 0) + 1;
      });
    });
    return state.rooms
      .map(r => ({ ...r, sessions: roomCountMap[r.id] || 0 }))
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 8);
  }, [state]);

  // Scheduling progress
  const scheduledCourseIds = useMemo(() => new Set(state.scheduleItems.map(s => s.courseId)), [state.scheduleItems]);
  const totalCourses = state.courses.length;
  const scheduledCount = scheduledCourseIds.size;
  const progressPct = totalCourses > 0 ? Math.round((scheduledCount / totalCourses) * 100) : 0;

  const firstName = user?.email?.split('@')[0]?.split('.')[0] || 'there';
  const displayName = firstName.charAt(0).toUpperCase() + firstName.slice(1);

  if (!loaded) return <DashboardSkeleton />;

  return (
    <div className={styles.dashboard}>
      {/* Welcome + Term Badge */}
      <div className={styles.welcomeHeader}>
        <div className={styles.welcomeLeft}>
          <h1>{getGreeting()}, {displayName} 👋</h1>
        </div>
        {currentSession && currentTerm && (
          <div className={styles.termBadge}>
            {currentSession.name} - {currentTerm.name}
          </div>
        )}
      </div>

      {/* Stats Grid */}
      <div className={styles.statsGrid}>
        <div className={`${styles.statCard} ${styles.statCardPurple}`}>
          <div className={`${styles.statIcon} ${styles.statIconPurple}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </div>
          <div className={styles.statValue}>{stats.lectureCount + stats.examCount}</div>
          <div className={styles.statLabel}>Courses Scheduled</div>
        </div>

        <div className={`${styles.statCard} ${styles.statCardGreen}`}>
          <div className={`${styles.statIcon} ${styles.statIconGreen}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </div>
          <div className={styles.statValue}>{stats.totalCourses}</div>
          <div className={styles.statLabel}>Courses</div>
        </div>

        <div className={`${styles.statCard} ${styles.statCardCyan}`}>
          <div className={`${styles.statIcon} ${styles.statIconCyan}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </div>
          <div className={styles.statValue}>{stats.totalRooms}</div>
          <div className={styles.statLabel}>Rooms</div>
        </div>

        {user?.role === 'SUPER_ADMIN' && (
          <div className={`${styles.statCard} ${styles.statCardOrange}`}>
            <div className={`${styles.statIcon} ${styles.statIconOrange}`}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 20V8l10-5 10 5v12" /><path d="M6 10v10" /><path d="M18 10v10" /><path d="M2 20h20" />
              </svg>
            </div>
            <div className={styles.statValue}>{stats.activeFaculties}</div>
            <div className={styles.statLabel}>Faculties</div>
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className={styles.quickActionsGrid}>
        <Link href="/rooms" className={styles.quickAction}>
          <div className={`${styles.quickActionIcon} ${styles.statIconCyan}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </div>
          <div className={styles.quickActionText}>
            <h4>Manage Rooms</h4>
            <p>Venues &amp; capacities</p>
          </div>
        </Link>

        <Link href="/courses" className={styles.quickAction}>
          <div className={`${styles.quickActionIcon} ${styles.statIconGreen}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </div>
          <div className={styles.quickActionText}>
            <h4>Manage Courses</h4>
            <p>Add &amp; configure courses</p>
          </div>
        </Link>

        <Link href="/timetable/lectures" className={styles.quickAction}>
          <div className={`${styles.quickActionIcon} ${styles.statIconPurple}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </div>
          <div className={styles.quickActionText}>
            <h4>Lecture Timetable</h4>
            <p>Create &amp; manage lectures</p>
          </div>
        </Link>

        <Link href="/timetable/exams" className={styles.quickAction}>
          <div className={`${styles.quickActionIcon} ${styles.statIconOrange}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
              <rect x="8" y="2" width="8" height="4" rx="1" />
            </svg>
          </div>
          <div className={styles.quickActionText}>
            <h4>Exam Timetable</h4>
            <p>Schedule exam sessions</p>
          </div>
        </Link>
      </div>

      {/* Two-Column Content */}
      <div className={styles.contentGrid}>
        {/* Today's Schedule */}
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
              Today&apos;s Lectures {today && <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>— {today}</span>}
            </span>
            <Link href="/timetable/lectures" className={styles.panelLink}>View All →</Link>
          </div>
          <div className={styles.panelBody}>
            {!today || todaySchedules.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyIcon}>📅</div>
                {!today ? 'No lectures on weekends. Enjoy your day!' : 'No lectures scheduled for today.'}
              </div>
            ) : (
              <div className={styles.timelineList}>
                {todaySchedules.slice(0, 6).map((s, i) => (
                  <div key={s.id} className={styles.timelineItem}>
                    <span className={styles.timelineTime}>
                      {s.startTime?.slice(0, 5)}
                    </span>
                    <span className={styles.timelineDot} style={{ background: TIMELINE_COLORS[i % TIMELINE_COLORS.length] }} />
                    <div className={styles.timelineContent}>
                      <div className={styles.timelineCourse}>{s.courseCode} — {s.courseTitle}</div>
                      <div className={styles.timelineDetail}>
                        📍 {s.roomNames} &nbsp;·&nbsp; {s.startTime?.slice(0, 5)} – {s.endTime?.slice(0, 5)}
                      </div>
                    </div>
                  </div>
                ))}
                {todaySchedules.length > 6 && (
                  <div style={{ textAlign: 'center', paddingTop: '8px', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                    + {todaySchedules.length - 6} more
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Faculty Distribution */}
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 20V8l10-5 10 5v12" /><path d="M6 10v10" /><path d="M18 10v10" /><path d="M2 20h20" /></svg>
              Faculty Overview
            </span>
            <Link href="/faculties" className={styles.panelLink}>Manage →</Link>
          </div>
          <div className={styles.panelBody}>
            {facultyDistribution.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyIcon}>🏛️</div>
                No faculties registered yet.
              </div>
            ) : (
              <div className={styles.facultyList}>
                {facultyDistribution.map((f, i) => (
                  <div key={f.id} className={styles.facultyRow}>
                    <span className={styles.facultyName} title={f.name}>{f.name}</span>
                    <div className={styles.facultyBarTrack}>
                      <div
                        className={styles.facultyBarFill}
                        style={{
                          width: `${(f.courses / maxFacultyCourses) * 100}%`,
                          background: BAR_COLORS[i % BAR_COLORS.length]
                        }}
                      />
                    </div>
                    <span className={styles.facultyCount}>{f.courses}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Grid: Room Utilization + Scheduling Progress */}
      <div className={styles.contentGrid}>
        {/* Room Utilization */}
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
              Room Utilization
            </span>
            <Link href="/rooms" className={styles.panelLink}>All Rooms →</Link>
          </div>
          <div className={styles.panelBody}>
            {roomUtilization.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyIcon}>🏠</div>
                No rooms registered yet.
              </div>
            ) : (
              <div className={styles.roomGrid}>
                {roomUtilization.map(r => (
                  <div key={r.id} className={styles.roomTile}>
                    <span className={styles.roomName} title={r.name}>{r.name}</span>
                    <span className={`${styles.roomSessions} ${r.sessions === 0 ? styles.roomIdle : ''}`}>
                      {r.sessions > 0 ? `${r.sessions} slots` : 'Idle'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Scheduling Progress */}
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
              Scheduling Progress
            </span>
          </div>
          <div className={styles.panelBody}>
            <div style={{ textAlign: 'center', padding: '8px 0 20px' }}>
              {/* Circular Progress */}
              <div style={{ position: 'relative', width: '140px', height: '140px', margin: '0 auto 16px' }}>
                <svg viewBox="0 0 140 140" width="140" height="140">
                  <circle cx="70" cy="70" r="58" fill="none" stroke="var(--color-border)" strokeWidth="10" />
                  <circle
                    cx="70" cy="70" r="58"
                    fill="none" stroke="#6366f1" strokeWidth="10" strokeLinecap="round"
                    strokeDasharray={`${(progressPct / 100) * 364.4} 364.4`}
                    transform="rotate(-90 70 70)"
                    style={{ transition: 'stroke-dasharray 1s ease' }}
                  />
                </svg>
                <div style={{
                  position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center'
                }}>
                  <span style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--color-text)', lineHeight: 1 }}>{progressPct}%</span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', fontWeight: 500 }}>Complete</span>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'center', gap: '32px' }}>
                <div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#059669' }}>{scheduledCount}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', fontWeight: 500 }}>Scheduled</div>
                </div>
                <div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#d97706' }}>{totalCourses - scheduledCount}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', fontWeight: 500 }}>Unscheduled</div>
                </div>
                <div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--color-text)' }}>{totalCourses}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', fontWeight: 500 }}>Total</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
