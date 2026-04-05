'use client';

import { useState } from 'react';
import Sidebar from '@/components/Sidebar/Sidebar';
import TopBar from '@/components/TopBar/TopBar';
import { AppProvider } from '@/context/AppContext';
import { ToastProvider } from '@/components/Toast/Toast';

export default function ClientLayout({ children }) {
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
    const toggleCollapse = () => setIsSidebarCollapsed(!isSidebarCollapsed);

    return (
        <AppProvider>
            <ToastProvider>
                <Sidebar isCollapsed={isSidebarCollapsed} toggleCollapse={toggleCollapse} />
                <TopBar isSidebarCollapsed={isSidebarCollapsed} />
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
            </ToastProvider>
        </AppProvider>
    );
}
