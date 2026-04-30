'use client';

import { createContext, useContext, useState, useCallback } from 'react';

const ConfirmContext = createContext(null);

const TONE_STYLES = {
    danger: { background: '#ef4444', border: 'none', boxShadow: 'none' },
    primary: { background: '#4f46e5', border: 'none', boxShadow: 'none' },
    success: { background: '#16a34a', border: 'none', boxShadow: 'none' },
};

export function ConfirmProvider({ children }) {
    const [confirmState, setConfirmState] = useState({
        isOpen: false,
        title: 'Confirm Required',
        message: '',
        details: null,
        confirmLabel: 'Yes',
        cancelLabel: 'Cancel',
        tone: 'danger',
        onConfirm: null,
        onCancel: null
    });

    const confirm = useCallback((input) => {
        const opts = typeof input === 'string' ? { message: input } : (input || {});
        return new Promise((resolve) => {
            setConfirmState({
                isOpen: true,
                title: opts.title || 'Confirm Required',
                message: opts.message || '',
                details: opts.details || null,
                confirmLabel: opts.confirmLabel || 'Yes',
                cancelLabel: opts.cancelLabel || 'Cancel',
                tone: opts.tone || 'danger',
                onConfirm: () => {
                    setConfirmState(prev => ({ ...prev, isOpen: false }));
                    resolve(true);
                },
                onCancel: () => {
                    setConfirmState(prev => ({ ...prev, isOpen: false }));
                    resolve(false);
                }
            });
        });
    }, []);

    const confirmBtnStyle = TONE_STYLES[confirmState.tone] || TONE_STYLES.danger;

    return (
        <ConfirmContext.Provider value={{ confirm }}>
            {children}
            {confirmState.isOpen && (
                <div className="modal-overlay" style={{ zIndex: 9999 }} onClick={confirmState.onCancel}>
                    <div className="modal" style={{ maxWidth: '460px' }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>{confirmState.title}</h3>
                            <button className="modal-close" onClick={confirmState.onCancel}>✕</button>
                        </div>
                        <div className="modal-body" style={{ padding: '24px 24px 12px 24px' }}>
                            <p style={{ color: '#334155', fontSize: '0.95rem', lineHeight: 1.5, margin: 0 }}>
                                {confirmState.message}
                            </p>
                            {Array.isArray(confirmState.details) && confirmState.details.length > 0 && (
                                <ul style={{ marginTop: '12px', paddingLeft: '20px', color: '#475569', fontSize: '0.9rem', lineHeight: 1.5 }}>
                                    {confirmState.details.map((d, i) => <li key={i}>{d}</li>)}
                                </ul>
                            )}
                        </div>
                        <div className="modal-footer" style={{ padding: '24px', display: 'flex', justifyContent: 'flex-end', gap: '12px', borderTop: 'none' }}>
                            <button className="btn btn-secondary" onClick={confirmState.onCancel}>{confirmState.cancelLabel}</button>
                            <button className="btn btn-primary" style={confirmBtnStyle} onClick={confirmState.onConfirm}>{confirmState.confirmLabel}</button>
                        </div>
                    </div>
                </div>
            )}
        </ConfirmContext.Provider>
    );
}

export function useConfirm() {
    const ctx = useContext(ConfirmContext);
    if (!ctx) throw new Error('useConfirm must be inside ConfirmProvider');
    return ctx.confirm;
}
