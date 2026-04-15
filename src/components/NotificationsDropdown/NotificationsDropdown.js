'use client';

import { useState, useEffect, useRef } from 'react';
import { apiClient } from '@/lib/apiClient';
import styles from './NotificationsDropdown.module.css';

export default function NotificationsDropdown() {
    const [isOpen, setIsOpen] = useState(false);
    const [notifications, setNotifications] = useState([]);
    const [hasUnread, setHasUnread] = useState(false);
    const dropdownRef = useRef(null);

    useEffect(() => {
        let mounted = true;
        apiClient.get('/notifications').then((data) => {
            if (mounted && Array.isArray(data)) {
                setNotifications(data);
                setHasUnread(data.some(n => !n.is_read));
            }
        }).catch(err => console.error("Failed to fetch notifications", err));

        return () => { mounted = false; };
    }, []);

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
            setNotifications(prev => {
                const next = prev.map(n => n.id === id ? { ...n, is_read: true } : n);
                setHasUnread(next.some(n => !n.is_read));
                return next;
            });
        } catch (e) {
            console.error("Failed to mark as read", e);
        }
    };

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
                    <div className={styles.header}>Notifications</div>
                    <div className={styles.list}>
                        {notifications.length === 0 ? (
                            <div className={styles.empty}>No notifications yet</div>
                        ) : (
                            notifications.map(notif => (
                                <div
                                    key={notif.id}
                                    className={`${styles.item} ${!notif.is_read ? styles.unread : ''}`}
                                    onClick={() => !notif.is_read && markAsRead(notif.id)}
                                >
                                    <div className={styles.title}>{notif.title}</div>
                                    <div className={styles.message}>{notif.message}</div>
                                    <div className={styles.date}>
                                        {new Date(notif.created_at).toLocaleDateString()}
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
