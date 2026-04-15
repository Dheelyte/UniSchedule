'use client';

import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import styles from './login.module.css';
import { unilagLogoBase64 } from '@/lib/logo';


export default function LoginPage() {
    const { login } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            await login(email, password);
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
            </div>
        </div>
    );
}
