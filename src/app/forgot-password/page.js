'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';
import { useToast } from '@/components/Toast/Toast';
import AuthPanel, { authStyles as styles } from '@/components/Public/AuthPanel';

export default function ForgotPasswordPage() {
    const router = useRouter();
    const { addToast } = useToast();

    const [step, setStep] = useState('request');
    const [email, setEmail] = useState('');
    const [code, setCode] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleRequest = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const res = await apiClient.post('/auth/request-password-reset', { email });
            addToast({ type: 'success', title: 'Check your inbox', message: res.message });
            setStep('verify');
        } catch (err) {
            setError(err.message || 'Failed to request password reset.');
        } finally {
            setLoading(false);
        }
    };

    const handleVerify = async (e) => {
        e.preventDefault();
        setError('');

        if (!/^\d{6}$/.test(code)) {
            setError('Code must be exactly 6 digits.');
            return;
        }

        setLoading(true);
        try {
            await apiClient.post('/auth/verify-reset-code', { email, code });
            setStep('reset');
        } catch (err) {
            setError(err.message || 'Invalid or expired code.');
        } finally {
            setLoading(false);
        }
    };

    const handleReset = async (e) => {
        e.preventDefault();
        setError('');

        if (newPassword !== confirmPassword) {
            setError('Passwords do not match.');
            return;
        }

        if (newPassword.length < 8) {
            setError('Password must be at least 8 characters.');
            return;
        }
        if (!/\d/.test(newPassword) || !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword)) {
            setError('Password must include an uppercase letter, a lowercase letter, and a digit.');
            return;
        }

        setLoading(true);
        try {
            const res = await apiClient.post('/auth/reset-password', {
                email,
                code,
                new_password: newPassword,
            });
            addToast({ type: 'success', title: 'Password updated', message: res.message });
            router.push('/login');
        } catch (err) {
            setError(err.message || 'Failed to reset password.');
        } finally {
            setLoading(false);
        }
    };

    const STEP_TITLE = { request: 'Reset your password', verify: 'Enter your code', reset: 'Choose a new password' };
    return (
        <AuthPanel
            slot="Staff · password reset"
            title={<>Forgot your password? <mark>We&apos;ll send a code.</mark></>}
            intro="Enter the email you sign in with. If it has an account, a 6-digit code arrives within a minute and works for 10 minutes."
        >
            <h2 className={styles.panelTitle}>{STEP_TITLE[step]}</h2>

            {step === 'request' && (
                <>
                    {error && <div className={styles.error} role="alert">{error}</div>}
                    <form onSubmit={handleRequest} className={styles.form}>
                        <div className={styles.field}>
                            <label className={styles.label} htmlFor="reset-email">Email address</label>
                            <input
                                id="reset-email"
                                type="email"
                                className={styles.input}
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                autoComplete="email"
                                placeholder="e.g. admin@unilag.edu.ng"
                            />
                        </div>
                        <button type="submit" className={styles.button} disabled={loading}>
                            {loading ? 'Sending…' : 'Send reset code'}
                        </button>
                    </form>
                </>
            )}

            {step === 'verify' && (
                <>
                    <p className={styles.note}>
                        Enter the 6-digit code sent to <strong>{email}</strong>.
                    </p>
                    {error && <div className={styles.error} role="alert">{error}</div>}
                    <form onSubmit={handleVerify} className={styles.form}>
                        <div className={styles.field}>
                            <label className={styles.label} htmlFor="reset-code">Reset code</label>
                            <input
                                id="reset-code"
                                type="text"
                                inputMode="numeric"
                                pattern="\d{6}"
                                maxLength={6}
                                className={`${styles.input} ${styles.codeInput}`}
                                value={code}
                                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                                required
                                autoComplete="one-time-code"
                                placeholder="000000"
                            />
                        </div>
                        <button type="submit" className={styles.button} disabled={loading}>
                            {loading ? 'Checking…' : 'Verify code'}
                        </button>
                        <button
                            type="button"
                            className={styles.textButton}
                            onClick={() => { setStep('request'); setCode(''); setError(''); }}
                        >
                            Use a different email
                        </button>
                    </form>
                </>
            )}

            {step === 'reset' && (
                <>
                    {error && <div className={styles.error} role="alert">{error}</div>}
                    <form onSubmit={handleReset} className={styles.form}>
                        <div className={styles.field}>
                            <label className={styles.label} htmlFor="reset-new">New password</label>
                            <input
                                id="reset-new"
                                type="password"
                                className={styles.input}
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                required
                                autoComplete="new-password"
                                placeholder="••••••••"
                            />
                        </div>
                        <div className={styles.field}>
                            <label className={styles.label} htmlFor="reset-confirm">Confirm new password</label>
                            <input
                                id="reset-confirm"
                                type="password"
                                className={styles.input}
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                required
                                autoComplete="new-password"
                                placeholder="••••••••"
                            />
                        </div>
                        <button type="submit" className={styles.button} disabled={loading}>
                            {loading ? 'Updating…' : 'Reset password'}
                        </button>
                    </form>
                </>
            )}

            <div className={styles.links}>
                <Link href="/login">Back to sign in</Link>
            </div>
        </AuthPanel>
    );
}
