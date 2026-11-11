'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';
import { useToast } from '@/components/Toast/Toast';
import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';
import AuthPanel, { authStyles as styles } from '@/components/Public/AuthPanel';
import { loginPath } from '@/lib/realm';


export default function RegisterPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const token = searchParams.get('token');
    // Invitation links name the portal the account belongs to.
    const realm = searchParams.get('realm');

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
            router.push(loginPath(realm));
        } catch (e) {
            addToast({ type: 'error', title: 'Registration Failed', message: e.message || 'The invitation token is invalid or expired natively.' });
        } finally {
            setLoading(false);
        }
    };

    if (authLoading) return null;

    if (!token) {
        return (
            <AuthPanel
                slot="Staff invitation"
                title={<>This link is <mark>incomplete.</mark></>}
                intro="Invitation links carry a code that identifies your invitation, and this one is missing it."
            >
                <h2 className={styles.panelTitle}>Invalid invitation link</h2>
                <div className={styles.error} role="alert">
                    Open the link from your invitation email again, or ask the timetable office to send a new one.
                </div>
                <div className={styles.links}>
                    <Link href="/realms">Go to sign in</Link>
                </div>
            </AuthPanel>
        );
    }

    return (
        <AuthPanel
            slot="Staff invitation"
            title={<>Welcome to <mark>UniSchedule.</mark></>}
            intro="You've been invited to help manage University of Lagos timetables. Choose a password to activate your account."
        >
            <h2 className={styles.panelTitle}>Create your password</h2>
            <form className={styles.form} onSubmit={handleSubmit}>
                <div className={styles.field}>
                    <label className={styles.label} htmlFor="password">Password</label>
                    <input
                        type="password"
                        id="password"
                        className={styles.input}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        autoComplete="new-password"
                        placeholder="••••••••"
                    />
                </div>
                <div className={styles.field}>
                    <label className={styles.label} htmlFor="confirmPassword">Confirm password</label>
                    <input
                        type="password"
                        id="confirmPassword"
                        className={styles.input}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                        autoComplete="new-password"
                        placeholder="••••••••"
                    />
                </div>
                <button type="submit" className={styles.button} disabled={loading}>
                    {loading ? 'Activating…' : 'Activate account'}
                </button>
            </form>
        </AuthPanel>
    );
}
