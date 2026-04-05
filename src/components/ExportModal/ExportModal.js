import { useState, useEffect } from 'react';
import { useApp } from '@/context/AppContext';
import styles from './ExportModal.module.css';

export default function ExportModal({ isOpen, onClose, onExport, mode }) {
    const { state } = useApp();

    // Default values
    const [session, setSession] = useState('2025/2026');
    const [semester, setSemester] = useState('1st Semester');
    const [facultyId, setFacultyId] = useState('ALL');

    useEffect(() => {
        if (isOpen) {
            setSession('2025/2026');
            setSemester('1st Semester');
            setFacultyId('ALL');
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleExport = (e) => {
        e.preventDefault();
        onExport({ session, semester, facultyId });
    };

    return (
        <>
            <div className={styles.overlay} onClick={onClose} />
            <div className={styles.modal}>
                <div className={styles.header}>
                    <h3 className={styles.title}>Export {mode === 'lecture' ? 'Lecture' : 'Exam'} Timetable</h3>
                    <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
                </div>

                <form className={styles.body} onSubmit={handleExport}>
                    <div className={styles.formGroup}>
                        <label className={styles.label}>Academic Session</label>
                        <input
                            type="text"
                            className={styles.input}
                            value={session}
                            onChange={(e) => setSession(e.target.value)}
                            placeholder="e.g. 2025/2026"
                            required
                        />
                    </div>

                    <div className={styles.formGroup}>
                        <label className={styles.label}>Semester</label>
                        <select
                            className={styles.input}
                            value={semester}
                            onChange={(e) => setSemester(e.target.value)}
                        >
                            <option value="1st Semester">1st Semester</option>
                            <option value="2nd Semester">2nd Semester</option>
                        </select>
                    </div>

                    <div className={styles.formGroup}>
                        <label className={styles.label}>Faculty Filter</label>
                        <select
                            className={styles.input}
                            value={facultyId}
                            onChange={(e) => setFacultyId(e.target.value)}
                        >
                            <option value="ALL">All Faculties</option>
                            {state.faculties.map((f) => (
                                <option key={f.id} value={f.id}>{f.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className={styles.footer}>
                        <button type="button" className={`btn btn-secondary ${styles.btn}`} onClick={onClose}>
                            Cancel
                        </button>
                        <button type="submit" className={`btn btn-primary ${styles.btn}`}>
                            Download PDF
                        </button>
                    </div>
                </form>
            </div>
        </>
    );
}
