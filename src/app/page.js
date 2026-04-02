'use client';

import styles from './page.module.css';
import Link from 'next/link';
import { useApp } from '@/context/AppContext';
import { countConflicts } from '@/lib/conflicts';

export default function DashboardPage() {
  const { stats, getSchedulesWithDetails } = useApp();

  // Use the real conflict detection engine
  const { errorCount: conflictsCount } = countConflicts(getSchedulesWithDetails);

  return (
    <div className={styles.dashboard}>
      {/* Greeting */}
      <div className={styles.greeting}>
        <h2 className={styles.greetingTitle}>
          Welcome back, <span>Admin</span> 👋
        </h2>
        <p className={styles.greetingSub}>
          Here&apos;s an overview of your timetable management system.
        </p>
      </div>

      {/* Metric Cards */}
      <div className={styles.metricsGrid}>
        {/* Total Courses Scheduled */}
        <div className={styles.metricCard}>
          <div className={`${styles.metricIcon} ${styles.metricIconPurple}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
          </div>
          <div className={styles.metricValue}>{stats.totalScheduled}</div>
          <div className={styles.metricLabel}>Courses Scheduled</div>
          <div className={`${styles.metricTrend} ${styles.trendUp}`}>
            {stats.lectureCount} lectures · {stats.examCount} exams
          </div>
        </div>

        {/* Active Faculties */}
        <div className={styles.metricCard}>
          <div className={`${styles.metricIcon} ${styles.metricIconGreen}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 20V8l10-5 10 5v12" />
              <path d="M6 10v10" />
              <path d="M18 10v10" />
              <path d="M2 20h20" />
            </svg>
          </div>
          <div className={styles.metricValue}>{stats.activeFaculties}</div>
          <div className={styles.metricLabel}>Active Faculties</div>
          <div className={`${styles.metricTrend} ${styles.trendUp}`}>
            {stats.totalDepartments} departments
          </div>
        </div>

        {/* Unresolved Conflicts */}
        <div className={styles.metricCard}>
          <div className={`${styles.metricIcon} ${styles.metricIconOrange}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div className={styles.metricValue}>{conflictsCount}</div>
          <div className={styles.metricLabel}>Unresolved Conflicts</div>
          <div className={`${styles.metricTrend} ${conflictsCount > 0 ? styles.trendWarning : styles.trendUp}`}>
            {conflictsCount > 0 ? '⚠ Needs attention' : '✓ All clear'}
          </div>
        </div>

        {/* Rooms Available */}
        <div className={styles.metricCard}>
          <div className={`${styles.metricIcon} ${styles.metricIconCyan}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </div>
          <div className={styles.metricValue}>{stats.totalRooms}</div>
          <div className={styles.metricLabel}>Rooms Available</div>
          <div className={`${styles.metricTrend} ${styles.trendUp}`}>
            {stats.totalCourses} courses registered
          </div>
        </div>
      </div>

      {/* Bottom Section */}
      <div className={styles.bottomGrid}>
        {/* Recent Activity */}
        <div className={styles.panelCard}>
          <div className={styles.panelHeader}>
            <h3 className={styles.panelTitle}>Recent Activity</h3>
            <span className={styles.panelAction}>View all</span>
          </div>
          <div className={styles.panelBody}>
            <div className={styles.activityItem}>
              <span className={`${styles.activityDot} ${styles.dotPurple}`} />
              <div>
                <div className={styles.activityText}>
                  <strong>CSC 301</strong> scheduled in <strong>Room SCI-101</strong> for Monday 14:00–16:00
                </div>
                <div className={styles.activityTime}>2 hours ago</div>
              </div>
            </div>
            <div className={styles.activityItem}>
              <span className={`${styles.activityDot} ${styles.dotOrange}`} />
              <div>
                <div className={styles.activityText}>
                  {conflictsCount} conflict{conflictsCount !== 1 ? 's' : ''} detected across timetables
                </div>
                <div className={styles.activityTime}>5 hours ago</div>
              </div>
            </div>
            <div className={styles.activityItem}>
              <span className={`${styles.activityDot} ${styles.dotGreen}`} />
              <div>
                <div className={styles.activityText}>
                  <strong>{stats.activeFaculties}</strong> faculties with <strong>{stats.totalDepartments}</strong> departments active
                </div>
                <div className={styles.activityTime}>Yesterday</div>
              </div>
            </div>
            <div className={styles.activityItem}>
              <span className={`${styles.activityDot} ${styles.dotCyan}`} />
              <div>
                <div className={styles.activityText}>
                  <strong>{stats.totalRooms}</strong> rooms registered with capacities set
                </div>
                <div className={styles.activityTime}>2 days ago</div>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className={styles.panelCard}>
          <div className={styles.panelHeader}>
            <h3 className={styles.panelTitle}>Quick Actions</h3>
          </div>
          <div className={styles.panelBody}>
            <div className={styles.quickActions}>
              <Link href="/timetable/lectures" className={styles.quickAction}>
                <div className={`${styles.quickActionIcon} ${styles.metricIconPurple}`}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                </div>
                <div className={styles.quickActionText}>
                  <div className={styles.quickActionTitle}>Schedule a Lecture</div>
                  <div className={styles.quickActionDesc}>Add a new lecture to the timetable</div>
                </div>
                <span className={styles.quickActionArrow}>→</span>
              </Link>

              <Link href="/courses" className={styles.quickAction}>
                <div className={`${styles.quickActionIcon} ${styles.metricIconGreen}`}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </div>
                <div className={styles.quickActionText}>
                  <div className={styles.quickActionTitle}>Add a Course</div>
                  <div className={styles.quickActionDesc}>Register a new course in the system</div>
                </div>
                <span className={styles.quickActionArrow}>→</span>
              </Link>

              <Link href="/rooms" className={styles.quickAction}>
                <div className={`${styles.quickActionIcon} ${styles.metricIconCyan}`}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                    <polyline points="9 22 9 12 15 12 15 22" />
                  </svg>
                </div>
                <div className={styles.quickActionText}>
                  <div className={styles.quickActionTitle}>Manage Rooms</div>
                  <div className={styles.quickActionDesc}>View and edit room allocations</div>
                </div>
                <span className={styles.quickActionArrow}>→</span>
              </Link>

              <Link href="/timetable/exams" className={styles.quickAction}>
                <div className={`${styles.quickActionIcon} ${styles.metricIconOrange}`}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                    <rect x="8" y="2" width="8" height="4" rx="1" />
                  </svg>
                </div>
                <div className={styles.quickActionText}>
                  <div className={styles.quickActionTitle}>Exam Timetable</div>
                  <div className={styles.quickActionDesc}>Schedule examination sessions</div>
                </div>
                <span className={styles.quickActionArrow}>→</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
