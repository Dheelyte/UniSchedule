'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import MultiSelect from './MultiSelect';
import { CATEGORIES, includedBy, inCategories, normalizeCategories } from './categories';
import { DEFAULT_FILTERS, PORTAL_SCOPES, PRESETS, TIMETABLE_TYPES, filterChips, isDefault, normalizeTimeWindow } from './filters';
import styles from './activity.module.css';

const CATEGORY_OPTIONS = CATEGORIES.map((c) => ({ value: c.key, label: c.label }));

/**
 * Every filter as form fields. Used by the page's filter bar and by the export
 * modal (which leaves out "All time": exports cover at most 12 months).
 */
export function FilterFields({ value, onChange, options, roleLabels = {}, allowAllTime = true, idPrefix = 'filter' }) {
    const set = (patch) => onChange({ ...value, ...patch });

    // The keyword updates after a pause in typing, not on every key. The timer
    // reads the latest filters, so a change made meanwhile isn't undone.
    const latest = useRef({ value, onChange });
    useEffect(() => {
        latest.current = { value, onChange };
    });
    const [keyword, setKeyword] = useState(value.q);
    // Follow the keyword when it changes from outside (a chip removed, "Clear
    // all"), but not when it's just what was typed, trimmed.
    const [seenQ, setSeenQ] = useState(value.q);
    if (value.q !== seenQ) {
        setSeenQ(value.q);
        if (value.q !== keyword.trim().slice(0, 200)) setKeyword(value.q);
    }
    useEffect(() => {
        const q = keyword.trim().slice(0, 200);
        if (q === latest.current.value.q) return undefined;
        const timer = setTimeout(() => latest.current.onChange({ ...latest.current.value, q }), 400);
        return () => clearTimeout(timer);
    }, [keyword]);

    // The time-of-day inputs hold a half-typed window until both ends are set.
    const [timeStart, timeEnd] = value.time ? value.time.split('-') : ['', ''];
    const [draftStart, setDraftStart] = useState(timeStart);
    const [draftEnd, setDraftEnd] = useState(timeEnd);
    const [seenTime, setSeenTime] = useState(value.time);
    if (value.time !== seenTime) {
        setSeenTime(value.time);
        setDraftStart(timeStart);
        setDraftEnd(timeEnd);
    }
    const setWindow = (start, end) => {
        setDraftStart(start);
        setDraftEnd(end);
        if (!start && !end) set({ time: '' });
        else if (start && end) set({ time: normalizeTimeWindow(`${start}-${end}`) });
    };

    const presets = PRESETS.filter((p) => allowAllTime || p.value !== 'all');
    const sessionAvailable = !options || Boolean(options.presets?.session);

    const changeRange = (range) => {
        if (range === 'custom') {
            // Start from what the current preset covers, else the last 30 days.
            const covered = options?.presets?.[value.range] || options?.presets?.last_30_days;
            const today = options?.today || new Date().toISOString().slice(0, 10);
            set({ range, from: value.from || covered?.start || today, to: value.to || covered?.end || today });
        } else {
            set({ range, from: '', to: '', time: '' });
        }
    };

    const actionOptions = useMemo(
        () =>
            (options?.actions || [])
                .filter((a) => inCategories(a.code, value.cat))
                .map((a) => ({ value: a.code, label: a.code, hint: a.count.toLocaleString() })),
        [options, value.cat],
    );
    const userOptions = useMemo(
        () => (options?.users || []).map((u) => ({ value: u.email, label: u.email, hint: u.deleted ? 'deleted account' : undefined })),
        [options],
    );
    const roleOptions = useMemo(
        () => (options?.roles || []).map((r) => ({ value: r, label: roleLabels[r] || r })),
        [options, roleLabels],
    );
    const departments = (options?.departments || []).filter((d) => !value.faculty || d.faculty_id === value.faculty);
    const today = options?.today;

    // The filters most searches need stay in view; the rest fold away behind
    // "More filters", which opens by itself when one of them is in use.
    const advancedCount =
        (value.type !== DEFAULT_FILTERS.type ? 1 : 0) +
        (value.portal !== DEFAULT_FILTERS.portal ? 1 : 0) +
        (value.cat.length ? 1 : 0) +
        (value.action.length ? 1 : 0) +
        (value.role.length ? 1 : 0) +
        (value.faculty ? 1 : 0) +
        (value.dept ? 1 : 0);
    const [showMore, setShowMore] = useState(advancedCount > 0);

    return (
        <>
            <div className={styles.primaryRow}>
                <div className={`${styles.field} ${styles.searchField}`}>
                    <label className={styles.fieldLabel} htmlFor={`${idPrefix}-q`}>Search</label>
                    <input
                        id={`${idPrefix}-q`}
                        type="search"
                        className={styles.input}
                        placeholder="Search descriptions…"
                        value={keyword}
                        maxLength={200}
                        onChange={(e) => setKeyword(e.target.value)}
                    />
                </div>
                <div className={styles.field}>
                    <label className={styles.fieldLabel} htmlFor={`${idPrefix}-range`}>Timeframe</label>
                    <select id={`${idPrefix}-range`} className={styles.input} value={value.range} onChange={(e) => changeRange(e.target.value)}>
                        {presets.map((p) => (
                            <option key={p.value} value={p.value} disabled={p.value === 'session' && !sessionAvailable}>
                                {p.label}
                                {p.value === 'session' && !sessionAvailable ? ' (start not recorded)' : ''}
                            </option>
                        ))}
                    </select>
                </div>
                <div className={styles.field}>
                    <span className={styles.fieldLabel}>Users</span>
                    <MultiSelect
                        label="Users"
                        placeholder="All users"
                        options={userOptions}
                        value={value.user}
                        onChange={(user) => set({ user })}
                        searchPlaceholder="Search emails…"
                        testId={`${idPrefix}-users`}
                    />
                </div>
                <button
                    type="button"
                    className={`${styles.moreToggle} ${showMore ? styles.moreToggleOpen : ''}`}
                    onClick={() => setShowMore((open) => !open)}
                    aria-expanded={showMore}
                    aria-controls={`${idPrefix}-more`}
                    data-testid={`${idPrefix}-more-toggle`}
                >
                    More filters
                    {advancedCount > 0 && <span className={styles.moreCount}>{advancedCount}</span>}
                    <span className={styles.moreChevron} aria-hidden>▾</span>
                </button>
            </div>

            {value.range === 'custom' && (
                <div className={styles.fieldRow}>
                    <div className={`${styles.field} ${styles.fieldWide}`}>
                        <span className={styles.fieldLabel}>From – to (Lagos dates)</span>
                        <div className={styles.inline}>
                            <input
                                type="date"
                                className={styles.input}
                                value={value.from}
                                max={value.to || today}
                                onChange={(e) => e.target.value && set({ from: e.target.value, to: value.to < e.target.value ? e.target.value : value.to })}
                                aria-label="From date"
                            />
                            <span className={styles.dash}>–</span>
                            <input
                                type="date"
                                className={styles.input}
                                value={value.to}
                                min={value.from}
                                max={today}
                                onChange={(e) => e.target.value && set({ to: e.target.value, from: value.from > e.target.value ? e.target.value : value.from })}
                                aria-label="To date"
                            />
                        </div>
                    </div>
                    <div className={`${styles.field} ${styles.fieldWide}`}>
                        <span className={styles.fieldLabel}>Time of day (optional)</span>
                        <div className={styles.inline}>
                            <input type="time" className={styles.input} value={draftStart} onChange={(e) => setWindow(e.target.value, draftEnd)} aria-label="From time" />
                            <span className={styles.dash}>–</span>
                            <input type="time" className={styles.input} value={draftEnd} onChange={(e) => setWindow(draftStart, e.target.value)} aria-label="To time" />
                        </div>
                        <span className={styles.hint}>
                            Start included, end not. A start after the end runs overnight (e.g. 22:00–06:00).
                        </span>
                    </div>
                </div>
            )}

            {showMore && (
                <div id={`${idPrefix}-more`} className={styles.moreFilters}>
                    <div className={styles.filterGroup}>
                        <span className={styles.groupTitle}>What happened</span>
                        <div className={styles.fieldRow}>
                            <div className={styles.field}>
                                <span className={styles.fieldLabel}>Categories</span>
                                <MultiSelect
                                    label="Categories"
                                    placeholder="All actions"
                                    options={CATEGORY_OPTIONS}
                                    value={value.cat}
                                    locked={includedBy(value.cat)}
                                    lockedHint="included in Schedule items (all)"
                                    onChange={(cat) => {
                                        const next = normalizeCategories(cat);
                                        // Drop specific actions the new categories no longer cover.
                                        set({ cat: next, action: value.action.filter((a) => inCategories(a, next)) });
                                    }}
                                    testId={`${idPrefix}-categories`}
                                />
                            </div>
                            <div className={styles.field}>
                                <span className={styles.fieldLabel}>Specific actions</span>
                                <MultiSelect
                                    label="Specific actions"
                                    placeholder="Any action"
                                    options={actionOptions}
                                    value={value.action}
                                    onChange={(action) => set({ action })}
                                    emptyText="No actions recorded in these categories."
                                    testId={`${idPrefix}-actions`}
                                />
                            </div>
                            <div className={styles.field}>
                                <label className={styles.fieldLabel} htmlFor={`${idPrefix}-type`}>Timetable type</label>
                                <select id={`${idPrefix}-type`} className={styles.input} value={value.type} onChange={(e) => set({ type: e.target.value })}>
                                    {TIMETABLE_TYPES.map((t) => (
                                        <option key={t.value} value={t.value}>{t.label}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>

                    <div className={styles.filterGroup}>
                        <span className={styles.groupTitle}>Who and where</span>
                        <div className={styles.fieldRow}>
                            <div className={styles.field}>
                                <span className={styles.fieldLabel}>Roles (as acted)</span>
                                <MultiSelect
                                    label="Roles"
                                    placeholder="All roles"
                                    options={roleOptions}
                                    value={value.role}
                                    onChange={(role) => set({ role })}
                                    testId={`${idPrefix}-roles`}
                                />
                            </div>
                            <div className={styles.field}>
                                <label className={styles.fieldLabel} htmlFor={`${idPrefix}-faculty`}>Faculty</label>
                                <select id={`${idPrefix}-faculty`} className={styles.input} value={value.faculty} onChange={(e) => set({ faculty: e.target.value, dept: '' })}>
                                    <option value="">All faculties</option>
                                    {(options?.faculties || []).map((f) => (
                                        <option key={f.id} value={f.id}>{f.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className={styles.field}>
                                <label className={styles.fieldLabel} htmlFor={`${idPrefix}-dept`}>Department</label>
                                <select id={`${idPrefix}-dept`} className={styles.input} value={value.dept} onChange={(e) => set({ dept: e.target.value })}>
                                    <option value="">All departments</option>
                                    {departments.map((d) => (
                                        <option key={d.id} value={String(d.id)}>{d.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className={styles.field}>
                                <label className={styles.fieldLabel} htmlFor={`${idPrefix}-portal`}>Portal</label>
                                <select id={`${idPrefix}-portal`} className={styles.input} value={value.portal} onChange={(e) => set({ portal: e.target.value })}>
                                    {PORTAL_SCOPES.map((p) => (
                                        <option key={p.value} value={p.value}>{p.label}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

/** The page's filter bar: the fields in a card. */
export default function FilterBar(props) {
    return (
        <section className={styles.filterBar} aria-label="Filters" data-testid="activity-filter-bar">
            <FilterFields {...props} />
        </section>
    );
}

/** The active filters as removable chips above the table, with "Clear all". */
export function FilterChips({ value, onChange, options, roleLabels }) {
    const chips = filterChips(value, { options, roleLabels });
    if (chips.length === 0) return null;
    return (
        <div className={styles.chips} data-testid="activity-chips">
            <span className={styles.chipsLabel}>Filtered by:</span>
            {chips.map((chip) => (
                <span key={chip.id} className={styles.chip} title={chip.label}>
                    <span className={styles.chipText}>{chip.label}</span>
                    <button type="button" className={styles.chipRemove} onClick={() => onChange(chip.next)} aria-label={`Remove filter: ${chip.label}`}>
                        ✕
                    </button>
                </span>
            ))}
            {!isDefault(value) && (
                <button type="button" className={styles.clearAll} onClick={() => onChange({ ...DEFAULT_FILTERS })}>
                    Clear all
                </button>
            )}
        </div>
    );
}
