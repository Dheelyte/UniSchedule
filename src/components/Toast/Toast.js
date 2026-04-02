'use client';

import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import styles from './Toast.module.css';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([]);

    const addToast = useCallback((toast) => {
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        setToasts((prev) => [...prev, { id, ...toast }]);

        // Auto-remove after duration
        const duration = toast.duration || 6000;
        setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id));
        }, duration);

        return id;
    }, []);

    const removeToast = useCallback((id) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    return (
        <ToastContext.Provider value={{ addToast, removeToast }}>
            {children}
            {/* Toast container */}
            {toasts.length > 0 && (
                <div className={styles.container}>
                    {toasts.map((toast) => (
                        <div
                            key={toast.id}
                            className={`${styles.toast} ${styles[`toast_${toast.type || 'info'}`]}`}
                        >
                            <div className={styles.iconWrap}>
                                {toast.type === 'error' && (
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <circle cx="12" cy="12" r="10" />
                                        <line x1="15" y1="9" x2="9" y2="15" />
                                        <line x1="9" y1="9" x2="15" y2="15" />
                                    </svg>
                                )}
                                {toast.type === 'warning' && (
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                                        <line x1="12" y1="9" x2="12" y2="13" />
                                        <line x1="12" y1="17" x2="12.01" y2="17" />
                                    </svg>
                                )}
                                {toast.type === 'success' && (
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                                        <polyline points="22 4 12 14.01 9 11.01" />
                                    </svg>
                                )}
                                {(!toast.type || toast.type === 'info') && (
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <circle cx="12" cy="12" r="10" />
                                        <line x1="12" y1="16" x2="12" y2="12" />
                                        <line x1="12" y1="8" x2="12.01" y2="8" />
                                    </svg>
                                )}
                            </div>
                            <div className={styles.content}>
                                {toast.title && <div className={styles.title}>{toast.title}</div>}
                                <div className={styles.message}>{toast.message}</div>
                            </div>
                            <button className={styles.close} onClick={() => removeToast(toast.id)}>
                                ✕
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </ToastContext.Provider>
    );
}

export function useToast() {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
    return ctx;
}
