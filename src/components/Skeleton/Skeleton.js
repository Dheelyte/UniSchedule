import styles from './Skeleton.module.css';

/** Base bone element */
function Bone({ width = '100%', height = 16, circle = false, rounded = false, style = {} }) {
    const cls = [styles.bone];
    if (circle) cls.push(styles.circle);
    if (rounded) cls.push(styles.rounded);
    return <div className={cls.join(' ')} style={{ width, height, ...style }} />;
}

/** Dashboard skeleton */
export function DashboardSkeleton() {
    return (
        <div className={styles.pageShell}>
            {/* Header */}
            <div className={styles.headerSkeleton}>
                <div className={styles.headerLeft}>
                    <Bone width={260} height={28} />
                    <Bone width={200} height={14} />
                </div>
                <Bone width={180} height={36} rounded />
            </div>

            {/* Stats */}
            <div className={styles.statsRow}>
                {[...Array(5)].map((_, i) => (
                    <div key={i} className={styles.statSkeleton}>
                        <Bone width={42} height={42} style={{ borderRadius: 10 }} />
                        <Bone width={60} height={28} />
                        <Bone width={90} height={12} />
                    </div>
                ))}
            </div>

            {/* Quick Actions */}
            <div className={styles.quickRow}>
                {[...Array(4)].map((_, i) => (
                    <div key={i} className={styles.quickSkeleton}>
                        <Bone width={44} height={44} style={{ borderRadius: 10 }} />
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <Bone width={100} height={14} />
                            <Bone width={140} height={10} />
                        </div>
                    </div>
                ))}
            </div>

            {/* Content Grid */}
            <div className={styles.gridTwo}>
                {[0, 1].map(i => (
                    <div key={i} className={styles.panelSkeleton}>
                        <div className={styles.panelHeaderSkel}>
                            <Bone width={140} height={16} />
                            <Bone width={60} height={12} />
                        </div>
                        <div className={styles.panelBodySkel}>
                            {[...Array(4)].map((_, j) => (
                                <div key={j} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                                    <Bone width={10} height={10} circle />
                                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                        <Bone width="70%" height={12} />
                                        <Bone width="40%" height={10} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

/** Table page skeleton (rooms, courses, staff) */
export function TablePageSkeleton({ columns = 4, rows = 6, hasFilters = true }) {
    return (
        <div className={styles.pageShell}>
            <div className={styles.headerSkeleton}>
                <div className={styles.headerLeft}>
                    <Bone width={200} height={24} />
                    <Bone width={280} height={14} />
                </div>
                <div className={styles.headerRight}>
                    <Bone width={120} height={38} style={{ borderRadius: 10 }} />
                </div>
            </div>

            {hasFilters && (
                <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                    <Bone width={200} height={38} style={{ borderRadius: 10 }} />
                    <Bone width={160} height={38} style={{ borderRadius: 10 }} />
                </div>
            )}

            <div className={styles.tableSkeleton}>
                <div className={styles.tableHeaderSkel}>
                    {[...Array(columns)].map((_, i) => (
                        <Bone key={i} width={`${100 / columns}%`} height={12} />
                    ))}
                </div>
                {[...Array(rows)].map((_, i) => (
                    <div key={i} className={styles.tableRowSkel}>
                        {[...Array(columns)].map((_, j) => (
                            <Bone key={j} width={`${100 / columns}%`} height={14} />
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}

/** Timetable page skeleton */
export function TimetableSkeleton() {
    return (
        <div className={styles.pageShell}>
            <div className={styles.headerSkeleton}>
                <div className={styles.headerLeft}>
                    <Bone width={220} height={24} />
                    <Bone width={300} height={14} />
                </div>
                <div className={styles.headerRight}>
                    <Bone width={240} height={38} style={{ borderRadius: 10 }} />
                    <Bone width={110} height={38} style={{ borderRadius: 10 }} />
                    <Bone width={100} height={28} rounded />
                </div>
            </div>

            <div className={styles.gridSkeleton}>
                {/* Filter row */}
                <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                    <Bone width={160} height={36} style={{ borderRadius: 10 }} />
                    <Bone width={160} height={36} style={{ borderRadius: 10 }} />
                    <div style={{ flex: 1 }} />
                    <Bone width={100} height={36} style={{ borderRadius: 10 }} />
                </div>
                {/* Day tabs */}
                <div className={styles.gridHeader}>
                    {[...Array(5)].map((_, i) => (
                        <Bone key={i} width={80} height={32} style={{ borderRadius: 8 }} />
                    ))}
                </div>
                {/* Grid rows */}
                <div className={styles.gridRows}>
                    {[...Array(8)].map((_, i) => (
                        <div key={i} className={styles.gridRowSkel}>
                            <Bone width={60} height={50} style={{ borderRadius: 6 }} />
                            {[...Array(3)].map((_, j) => (
                                <Bone key={j} width="30%" height={50} style={{ borderRadius: 8 }} />
                            ))}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

/** Terms (academic sessions) page skeleton */
export function TermsSkeleton() {
    return (
        <div className={styles.pageShell}>
            <div className={styles.headerSkeleton}>
                <div className={styles.headerLeft}>
                    <Bone width={280} height={24} />
                    <Bone width={340} height={14} />
                </div>
            </div>

            <div style={{ marginBottom: 20, display: 'flex', gap: 8 }}>
                <Bone width={280} height={40} style={{ borderRadius: 10 }} />
                <Bone width={110} height={40} style={{ borderRadius: 10 }} />
            </div>

            <div className={styles.accordionSkeleton}>
                {[...Array(3)].map((_, i) => (
                    <div key={i} className={styles.accordionItemSkel}>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                            <Bone width={160} height={16} />
                            <Bone width={60} height={22} rounded />
                        </div>
                        <Bone width={18} height={18} />
                    </div>
                ))}
            </div>
        </div>
    );
}

/** Faculties page skeleton */
export function FacultiesSkeleton() {
    return (
        <div className={styles.pageShell}>
            <div className={styles.headerSkeleton}>
                <div className={styles.headerLeft}>
                    <Bone width={260} height={24} />
                    <Bone width={300} height={14} />
                </div>
                <div className={styles.headerRight}>
                    <Bone width={130} height={38} style={{ borderRadius: 10 }} />
                    <Bone width={160} height={38} style={{ borderRadius: 10 }} />
                </div>
            </div>

            {/* Faculty cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 20 }}>
                {[...Array(4)].map((_, i) => (
                    <div key={i} className={styles.panelSkeleton}>
                        <div className={styles.panelHeaderSkel}>
                            <Bone width={160} height={18} />
                            <Bone width={24} height={24} />
                        </div>
                        <div className={styles.panelBodySkel}>
                            {[...Array(3)].map((_, j) => (
                                <div key={j} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <Bone width="60%" height={14} />
                                    <Bone width={60} height={22} rounded />
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default Bone;
