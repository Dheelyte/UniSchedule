'use client';

import { createContext, useContext, useState, useCallback } from 'react';

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
    const [confirmState, setConfirmState] = useState({
        isOpen: false,
        message: '',
        onConfirm: null,
        onCancel: null
    });

    const confirm = useCallback((message) => {
        return new Promise((resolve) => {
            setConfirmState({
                isOpen: true,
                message,
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

    return (
        <ConfirmContext.Provider value={{ confirm }}>
            {children}
            {confirmState.isOpen && (
                <div className="modal-overlay" style={{ zIndex: 9999 }} onClick={confirmState.onCancel}>
                    <div className="modal" style={{ maxWidth: '400px' }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Confirm Required</h3>
                            <button className="modal-close" onClick={confirmState.onCancel}>✕</button>
                        </div>
                        <div className="modal-body" style={{ padding: '24px 24px 12px 24px' }}>
                            <p style={{ color: '#334155', fontSize: '0.95rem', lineHeight: 1.5, margin: 0 }}>
                                {confirmState.message}
                            </p>
                        </div>
                        <div className="modal-footer" style={{ padding: '24px', display: 'flex', justifyContent: 'flex-end', gap: '12px', borderTop: 'none' }}>
                            <button className="btn btn-secondary" onClick={confirmState.onCancel}>Cancel</button>
                            <button className="btn btn-primary" style={{ background: '#ef4444', border: 'none', boxShadow: 'none' }} onClick={confirmState.onConfirm}>Yes</button>
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
