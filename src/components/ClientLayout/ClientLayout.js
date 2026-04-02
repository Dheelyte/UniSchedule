'use client';

import Sidebar from '@/components/Sidebar/Sidebar';
import TopBar from '@/components/TopBar/TopBar';
import { AppProvider } from '@/context/AppContext';
import { ToastProvider } from '@/components/Toast/Toast';

export default function ClientLayout({ children }) {
    return (
        <AppProvider>
            <ToastProvider>
                <Sidebar />
                <TopBar />
                <main
                    style={{
                        marginLeft: 'var(--sidebar-width)',
                        marginTop: 'var(--topbar-height)',
                        minHeight: 'calc(100vh - var(--topbar-height))',
                    }}
                >
                    {children}
                </main>
            </ToastProvider>
        </AppProvider>
    );
}
