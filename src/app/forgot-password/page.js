'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';
import { useToast } from '@/components/Toast/Toast';
import styles from '../login/login.module.css';
import { unilagLogoBase64 } from '@/lib/logo';

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

    return (
        <div className={styles.container}>
            <div className={styles.card}>
                <div className={styles.logo} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                    <img src={unilagLogoBase64} alt="UNILAG Logo" width="100" height="100" style={{ borderRadius: '4px', objectFit: 'contain' }} />
                </div>
                <h1 className={styles.title}>University of Lagos</h1>
                <p className={styles.subtitle} style={{ fontSize: '1rem', fontWeight: 'bold', letterSpacing: '1px' }}>
                    Timetable Manager
                </p>

                {step === 'request' && (
                    <>
                        <p className={styles.subtitle}>
                            Enter your email and we&apos;ll send you a 6-digit code to reset your password.
                        </p>
                        {error && <div className={styles.error}>{error}</div>}
                        <form onSubmit={handleRequest} className={styles.form}>
                            <div className={styles.formGroup}>
                                <label className={styles.label}>Email Address</label>
                                <input
                                    type="email"
                                    className={styles.input}
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    placeholder="e.g., admin@unilag.edu.ng"
                                />
                            </div>
                            <button type="submit" className={styles.button} disabled={loading}>
                                {loading ? 'Sending...' : 'Send Reset Code'}
                            </button>
                        </form>
                    </>
                )}

                {step === 'verify' && (
                    <>
                        <p className={styles.subtitle}>
                            Enter the 6-digit code sent to <strong>{email}</strong>.
                        </p>
                        {error && <div className={styles.error}>{error}</div>}
                        <form onSubmit={handleVerify} className={styles.form}>
                            <div className={styles.formGroup}>
                                <label className={styles.label}>Reset Code</label>
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="\d{6}"
                                    maxLength={6}
                                    className={styles.input}
                                    value={code}
                                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                                    required
                                    placeholder="000000"
                                    style={{ letterSpacing: '0.5em', textAlign: 'center', fontSize: '18px' }}
                                />
                            </div>
                            <button type="submit" className={styles.button} disabled={loading}>
                                {loading ? 'Verifying...' : 'Verify Code'}
                            </button>
                            <button
                                type="button"
                                onClick={() => { setStep('request'); setCode(''); setError(''); }}
                                style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '13px', marginTop: '4px' }}
                            >
                                Use a different email
                            </button>
                        </form>
                    </>
                )}

                {step === 'reset' && (
                    <>
                        <p className={styles.subtitle}>Choose a new password for your account.</p>
                        {error && <div className={styles.error}>{error}</div>}
                        <form onSubmit={handleReset} className={styles.form}>
                            <div className={styles.formGroup}>
                                <label className={styles.label}>New Password</label>
                                <input
                                    type="password"
                                    className={styles.input}
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    required
                                    placeholder="••••••••"
                                />
                            </div>
                            <div className={styles.formGroup}>
                                <label className={styles.label}>Confirm New Password</label>
                                <input
                                    type="password"
                                    className={styles.input}
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    required
                                    placeholder="••••••••"
                                />
                            </div>
                            <button type="submit" className={styles.button} disabled={loading}>
                                {loading ? 'Updating...' : 'Reset Password'}
                            </button>
                        </form>
                    </>
                )}

                <div style={{ marginTop: '20px', fontSize: '13px', textAlign: 'center' }}>
                    <Link href="/login" style={{ color: '#2563eb', textDecoration: 'none' }}>
                        Back to Sign In
                    </Link>
                </div>
            </div>
        </div>
    );
}
