'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import styles from './activity.module.css';

/**
 * A searchable list of checkboxes in a dropdown.
 *
 * options: [{ value, label, hint }]. `locked` values show ticked and disabled,
 * with "included" (a category its parent already covers).
 */
export default function MultiSelect({
    label,
    placeholder,
    options,
    value,
    onChange,
    locked = [],
    lockedHint = 'included',
    searchPlaceholder = 'Search…',
    emptyText = 'Nothing to choose from.',
    testId,
}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const ref = useRef(null);
    const id = useId();

    useEffect(() => {
        if (!open) return;
        const onDown = (e) => {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    // Chosen values that aren't offered (e.g. from a shared link) still show, so they can be unticked.
    const all = useMemo(() => {
        const known = new Set(options.map((o) => o.value));
        return [...options, ...value.filter((v) => !known.has(v)).map((v) => ({ value: v, label: v }))];
    }, [options, value]);

    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        return q ? all.filter((o) => `${o.label} ${o.value}`.toLowerCase().includes(q)) : all;
    }, [all, query]);

    const lockedSet = new Set(locked);
    const chosen = new Set(value);
    const toggle = (v) => onChange(chosen.has(v) ? value.filter((x) => x !== v) : [...value, v]);

    const summary =
        value.length === 0
            ? null
            : value.length === 1
                ? all.find((o) => o.value === value[0])?.label ?? value[0]
                : `${value.length} selected`;

    return (
        <div className={styles.multi} ref={ref}>
            <button
                type="button"
                className={styles.multiButton}
                onClick={() => setOpen((v) => !v)}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label={label}
                data-testid={testId}
            >
                <span className={`${styles.multiValue} ${summary ? '' : styles.multiPlaceholder}`}>{summary ?? placeholder}</span>
                <span className={styles.caret} aria-hidden="true">▾</span>
            </button>
            {open && (
                <div className={styles.multiPanel} role="listbox" aria-multiselectable="true" aria-label={label}>
                    {all.length > 8 && (
                        <input
                            className={styles.multiSearch}
                            placeholder={searchPlaceholder}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            aria-label={`Search ${label}`}
                            autoFocus
                        />
                    )}
                    <div className={styles.multiList}>
                        {shown.length === 0 && <div className={styles.multiEmpty}>{all.length === 0 ? emptyText : 'No matches.'}</div>}
                        {shown.map((o, i) => {
                            const isLocked = lockedSet.has(o.value);
                            const optionId = `${id}-${i}`;
                            return (
                                <label key={o.value} htmlFor={optionId} className={`${styles.multiOption} ${isLocked ? styles.multiOptionLocked : ''}`}>
                                    <input
                                        id={optionId}
                                        type="checkbox"
                                        checked={isLocked || chosen.has(o.value)}
                                        disabled={isLocked}
                                        onChange={() => toggle(o.value)}
                                    />
                                    <span className={styles.multiOptionLabel}>{o.label}</span>
                                    {(isLocked || o.hint) && <span className={styles.multiOptionHint}>{isLocked ? lockedHint : o.hint}</span>}
                                </label>
                            );
                        })}
                    </div>
                    {value.length > 0 && (
                        <button type="button" className={styles.multiClear} onClick={() => onChange([])}>
                            Clear selection
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
