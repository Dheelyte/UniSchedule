'use client';

import { createContext, useContext, useState, useEffect } from 'react';
import { apiClient } from '@/lib/apiClient';
import { useRouter, usePathname } from 'next/navigation';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const router = useRouter();
    const pathname = usePathname();

    useEffect(() => {
        let mounted = true;
        apiClient.get('/auth/me')
            .then(res => {
                if (mounted) {
                    setUser(res);
                    setLoading(false);
                }
            })
            .catch(() => {
                if (mounted) {
                    setUser(null);
                    setLoading(false);
                }
            });
        return () => { mounted = false; };
    }, [pathname, router]);

    const login = async (email, password) => {
        await apiClient.post('/auth/login', { email, password });
        const user = await apiClient.get('/auth/me');
        setUser(user);
        router.push('/');
    };

    const logout = async () => {
        await apiClient.post('/auth/logout', {});
        setUser(null);
        router.push('/login');
    };

    return (
        <AuthContext.Provider value={{ user, loading, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    return useContext(AuthContext);
}
