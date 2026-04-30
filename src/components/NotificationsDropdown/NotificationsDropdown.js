'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';
import styles from './NotificationsDropdown.module.css';

const POLL_INTERVAL_MS = 600_000;

export default function NotificationsDropdown() {
    const [isOpen, setIsOpen] = useState(false);
    const [notifications, setNotifications] = useState([]);
    const dropdownRef = useRef(null);
    const router = useRouter();

    const refresh = useCallback(() => {
        apiClient.get('/notifications')
            .then((data) => { if (Array.isArray(data)) setNotifications(data); })
            .catch((err) => console.error("Failed to fetch notifications", err));
    }, []);

    useEffect(() => {
        refresh();
        const id = setInterval(refresh, POLL_INTERVAL_MS);
        return () => clearInterval(id);
    }, [refresh]);

    useEffect(() => {
        function handleClickOutside(event) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const markAsRead = async (id) => {
        try {
            await apiClient.patch(`/notifications/${id}/read`);
            setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
        } catch (e) {
            console.error("Failed to mark as read", e);
        }
    };

    const markAllRead = async () => {
        const unread = notifications.filter(n => !n.is_read);
        if (unread.length === 0) return;
        setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
        await Promise.all(
            unread.map(n => apiClient.patch(`/notifications/${n.id}/read`).catch(err => console.error('mark-read failed', err)))
        );
    };

    const handleItemClick = (notif) => {
        if (!notif.is_read) markAsRead(notif.id);
        if (notif.link) {
            setIsOpen(false);
            router.push(notif.link);
        }
    };

    const hasUnread = notifications.some(n => !n.is_read);

    return (
        <div className={styles.container} ref={dropdownRef}>
            <button
                title="Notifications"
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    position: 'relative',
                    width: '36px', height: '36px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: '8px', color: 'var(--color-text-secondary)',
                    background: 'transparent', border: 'none', cursor: 'pointer'
                }}
            >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                {hasUnread && (
                    <span style={{
                        position: 'absolute', top: '7px', right: '7px', width: '7px', height: '7px',
                        borderRadius: '50%', background: 'var(--color-danger)', boxShadow: '0 0 6px var(--color-danger)'
                    }} />
                )}
            </button>

            {isOpen && (
                <div className={styles.dropdown}>
                    <div className={styles.header}>
                        <span>Notifications</span>
                        <button
                            type="button"
                            className={styles.markAll}
                            onClick={markAllRead}
                            disabled={!hasUnread}
                        >
                            Mark all as read
                        </button>
                    </div>
                    <div className={styles.list}>
                        {notifications.length === 0 ? (
                            <div className={styles.empty}>No notifications yet</div>
                        ) : (
                            notifications.map(notif => (
                                <div
                                    key={notif.id}
                                    className={`${styles.item} ${!notif.is_read ? styles.unread : ''}`}
                                    onClick={() => handleItemClick(notif)}
                                >
                                    <div className={styles.title}>{notif.title}</div>
                                    <div className={styles.message}>{notif.message}</div>
                                    <div className={styles.date}>
                                        {new Date(notif.created_at).toLocaleString()}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
