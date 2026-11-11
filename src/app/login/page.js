'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { apiClient } from '@/lib/apiClient';
import { DEFAULT_REALM, FALLBACK_REALMS } from '@/lib/realm';
import AuthPanel, { authStyles as styles } from '@/components/Public/AuthPanel';


function LoginForm() {
    const { login } = useAuth();
    const searchParams = useSearchParams();
    // The portal being signed in to. A realm that isn't live yet is still
    // reachable here, so its staff can set up before launch.
    const realmKey = searchParams.get('realm') || DEFAULT_REALM;
    const [realms, setRealms] = useState(FALLBACK_REALMS);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        let mounted = true;
        apiClient.get('/realms')
            .then((res) => { if (mounted && Array.isArray(res) && res.length > 0) setRealms(res); })
            .catch(() => {});
        return () => { mounted = false; };
    }, []);

    const realmName = realms.find((r) => r.key === realmKey)?.name || realmKey;

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            await login(email, password, realmKey);
        } catch (err) {
            setError(err.message || 'Login failed. Please check your credentials.');
            setLoading(false);
        }
    };

    return (
        <AuthPanel
            slot={`${realmName} · staff sign in`}
            title={<>Sign in to <mark>UniSchedule.</mark></>}
            intro="For timetable officers and staff of the University of Lagos. Students don't need an account to download a timetable."
            after={
                <p className={styles.aside}>
                    Wrong programme? <Link href="/realms">Choose another</Link>.
                </p>
            }
        >
            <h2 className={styles.panelTitle}>{realmName}</h2>

            {error && <div className={styles.error} role="alert">{error}</div>}

            <form onSubmit={handleSubmit} className={styles.form}>
                <div className={styles.field}>
                    <label className={styles.label} htmlFor="login-email">Email address</label>
                    <input
                        id="login-email"
                        type="email"
                        className={styles.input}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        autoComplete="email"
                        placeholder="e.g. admin@unilag.edu.ng"
                    />
                </div>
                <div className={styles.field}>
                    <label className={styles.label} htmlFor="login-password">Password</label>
                    <input
                        id="login-password"
                        type="password"
                        className={styles.input}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        autoComplete="current-password"
                        placeholder="••••••••"
                    />
                </div>
                <button type="submit" className={styles.button} disabled={loading}>
                    {loading ? 'Signing in…' : 'Sign in'}
                </button>
            </form>
            <div className={styles.links}>
                <Link href="/forgot-password">Forgot your password?</Link>
            </div>
        </AuthPanel>
    );
}

// useSearchParams needs a Suspense boundary on a prerendered page.
export default function LoginPage() {
    return (
        <Suspense fallback={null}>
            <LoginForm />
        </Suspense>
    );
}
