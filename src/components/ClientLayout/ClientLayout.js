'use client';

import { useState } from 'react';
import Sidebar from '@/components/Sidebar/Sidebar';
import TopBar from '@/components/TopBar/TopBar';
import { AppProvider } from '@/context/AppContext';
import { ToastProvider } from '@/components/Toast/Toast';
import { ConfirmProvider } from '@/components/ConfirmModal/ConfirmContext';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

function LayoutInner({ children }) {
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
    const toggleCollapse = () => setIsSidebarCollapsed(!isSidebarCollapsed);
    const { user, loading } = useAuth();
    const pathname = usePathname();
    const router = useRouter();

    const publicPaths = ['/login', '/register'];

    useEffect(() => {
        if (!loading && !user && !publicPaths.includes(pathname)) {
            router.push('/login');
        }
    }, [user, loading, pathname, router]);

    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', width: '100vw' }}><div className="loader"></div></div>;
    if (!user && publicPaths.includes(pathname)) return <>{children}</>;
    if (!user) return null;

    return (
        <AppProvider>
            <Sidebar isCollapsed={isSidebarCollapsed} toggleCollapse={toggleCollapse} />
            <TopBar isSidebarCollapsed={isSidebarCollapsed} toggleCollapse={toggleCollapse} />
            <main
                style={{
                    marginLeft: isSidebarCollapsed ? 'var(--sidebar-collapsed-width)' : 'var(--sidebar-width)',
                    marginTop: 'var(--topbar-height)',
                    minHeight: 'calc(100vh - var(--topbar-height))',
                    transition: 'margin-left var(--transition-base)',
                }}
            >
                {children}
            </main>
        </AppProvider>
    );
}

export default function ClientLayout({ children }) {
    return (
        <ToastProvider>
            <AuthProvider>
                <ConfirmProvider>
                    <LayoutInner>{children}</LayoutInner>
                </ConfirmProvider>
            </AuthProvider>
        </ToastProvider>
    );
}
