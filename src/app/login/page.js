'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { apiClient } from '@/lib/apiClient';
import { DEFAULT_REALM, FALLBACK_REALMS } from '@/lib/realm';
import styles from './login.module.css';
import { unilagLogoBase64 } from '@/lib/logo';


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
        <div className={styles.container}>
            <div className={styles.card}>
                <div className={styles.logo} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                    <img src={unilagLogoBase64} alt="UNILAG Logo" width="100" height="100" style={{ borderRadius: '4px', objectFit: 'contain' }} />
                </div>
                <h1 className={styles.title}>University of Lagos</h1>
                <p className={styles.subtitle} style={{ fontSize: '1rem', fontWeight: 'bold', letterSpacing: '1px' }}>Timetable Manager</p>
                <span className={styles.realmBadge}>{realmName} Login</span>

                {error && <div className={styles.error}>{error}</div>}

                <form onSubmit={handleSubmit} className={styles.form}>
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
                    <div className={styles.formGroup}>
                        <label className={styles.label}>Password</label>
                        <input
                            type="password"
                            className={styles.input}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            placeholder="••••••••"
                        />
                    </div>
                    <button type="submit" className={styles.button} disabled={loading}>
                        {loading ? 'Authenticating...' : 'Sign In'}
                    </button>
                </form>
                <div style={{ marginTop: '20px', fontSize: '13px', textAlign: 'center' }}>
                    <Link href="/forgot-password" style={{ color: '#2563eb', textDecoration: 'none' }}>
                        Forgot your password?
                    </Link>
                </div>
            </div>
        </div>
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
