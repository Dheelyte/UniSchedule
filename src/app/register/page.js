'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';
import { useToast } from '@/components/Toast/Toast';
import { useAuth } from '@/context/AuthContext';
import styles from '../login/login.module.css';

export default function RegisterPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const token = searchParams.get('token');

    const { user, loading: authLoading } = useAuth();
    const { addToast } = useToast();

    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!authLoading && user) {
            router.push('/');
        }
    }, [user, authLoading, router]);

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!token) {
            addToast({ type: 'error', title: 'Invalid Link', message: 'The invitation token is missing from the URL.' });
            return;
        }

        if (password !== confirmPassword) {
            addToast({ type: 'error', title: 'Mismatch', message: 'Passwords do not match.' });
            return;
        }

        if (password.length < 8) {
            addToast({ type: 'warning', title: 'Security', message: 'Password must be at least 8 characters natively.' });
            return;
        }

        setLoading(true);
        try {
            await apiClient.post(`/auth/register/${token}`, { password });
            addToast({ type: 'success', title: 'Account Created', message: 'Your account has been successfully configured. You may now login.' });
            router.push('/login');
        } catch (e) {
            addToast({ type: 'error', title: 'Registration Failed', message: e.message || 'The invitation token is invalid or expired natively.' });
        } finally {
            setLoading(false);
        }
    };

    if (authLoading) return null;

    if (!token) {
        return (
            <div className={styles.container}>
                <div className={styles.card}>
                    <div className={styles.logo}>🏫 UniSchedule</div>
                    <p style={{ textAlign: 'center', color: '#ef4444', padding: '20px' }}>Invalid or missing registration token.</p>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.card}>
                <div className={styles.logo}>🏫 UniSchedule</div>
                <h1 className={styles.title}>Complete Setup</h1>
                <p className={styles.subtitle}>Welcome! Enter a new robust password to activate your staff profile account.</p>

                <form className={styles.form} onSubmit={handleSubmit}>
                    <div className={styles.formGroup}>
                        <label className={styles.label} htmlFor="password">Create Password</label>
                        <input
                            type="password"
                            id="password"
                            className={styles.input}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                        />
                    </div>
                    <div className={styles.formGroup}>
                        <label className={styles.label} htmlFor="confirmPassword">Confirm Password</label>
                        <input
                            type="password"
                            id="confirmPassword"
                            className={styles.input}
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            required
                        />
                    </div>
                    <button type="submit" className={styles.button} disabled={loading}>
                        {loading ? 'Processing Registration...' : 'Complete Registration'}
                    </button>
                </form>
            </div>
        </div>
    );
}
