'use client';

import { useState, useRef, useEffect } from 'react';
import styles from './SearchableSelect.module.css';

export default function SearchableSelect({ options, value, onChange, placeholder = "Select...", className = "" }) {
    const [search, setSearch] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const wrapperRef = useRef(null);

    const selectedOption = options.find(o => o.value == value);

    useEffect(() => {
        function handleClickOutside(event) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const filteredOptions = options.filter(o =>
        o.label.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className={`${styles.wrapper} ${className}`} ref={wrapperRef}>
            <div
                className={`${styles.header} ${isOpen ? styles.open : ''}`}
                onClick={() => { setIsOpen(!isOpen); setSearch(''); }}
            >
                <div className={styles.selectedLabel}>
                    {selectedOption ? selectedOption.label : <span className={styles.placeholder}>{placeholder}</span>}
                </div>
                <div className={styles.arrow} />
            </div>

            {isOpen && (
                <div className={styles.dropdown}>
                    <input
                        type="text"
                        className={styles.searchInput}
                        placeholder="Search..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        autoFocus
                    />
                    <div className={styles.optionsList}>
                        {filteredOptions.length > 0 ? (
                            filteredOptions.map(option => (
                                <div
                                    key={option.value}
                                    className={`${styles.option} ${option.value == value ? styles.selected : ''}`}
                                    onClick={() => {
                                        onChange(option.value);
                                        setIsOpen(false);
                                    }}
                                >
                                    {option.label}
                                </div>
                            ))
                        ) : (
                            <div className={styles.noResults}>No results found</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
