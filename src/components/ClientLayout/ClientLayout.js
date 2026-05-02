"use client";

import { useState, useEffect } from "react";
import Sidebar from "@/components/Sidebar/Sidebar";
import TopBar from "@/components/TopBar/TopBar";
import { AppProvider } from "@/context/AppContext";
import { ToastProvider } from "@/components/Toast/Toast";
import { ConfirmProvider } from "@/components/ConfirmModal/ConfirmContext";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { usePathname, useRouter } from "next/navigation";
import styles from "./ClientLayout.module.css";

const MOBILE_QUERY = "(max-width: 768px)";

function LayoutInner({ children }) {
	const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
	const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
	const { user, loading } = useAuth();
	const pathname = usePathname();
	const router = useRouter();

	const publicPaths = ["/login", "/register", "/forgot-password"];

	useEffect(() => {
		if (!loading && !user && !publicPaths.includes(pathname)) {
			router.push("/login");
		}
	}, [user, loading, pathname, router]);

	// ESC closes drawer
	useEffect(() => {
		if (!isMobileMenuOpen) return;
		const onKey = (e) => {
			if (e.key === "Escape") setIsMobileMenuOpen(false);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [isMobileMenuOpen]);

	// Lock body scroll while drawer is open
	useEffect(() => {
		if (isMobileMenuOpen) {
			const prev = document.body.style.overflow;
			document.body.style.overflow = "hidden";
			return () => {
				document.body.style.overflow = prev;
			};
		}
	}, [isMobileMenuOpen]);

	const handleToggle = () => {
		const isMobile =
			typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches;
		if (isMobile) {
			setIsMobileMenuOpen((v) => !v);
		} else {
			setIsSidebarCollapsed((v) => !v);
		}
	};

	if (loading)
		return (
			<div
				style={{
					display: "flex",
					justifyContent: "center",
					alignItems: "center",
					height: "100vh",
					width: "100vw",
				}}>
				<div className="loader"></div>
			</div>
		);
	if (!user && publicPaths.includes(pathname)) return <>{children}</>;
	if (!user) return null;

	const mainClass = isSidebarCollapsed
		? `${styles.main} ${styles.mainCollapsed}`
		: styles.main;

	return (
		<AppProvider>
			<Sidebar
				isCollapsed={isSidebarCollapsed}
				isMobileOpen={isMobileMenuOpen}
				onMobileClose={() => setIsMobileMenuOpen(false)}
				toggleCollapse={handleToggle}
			/>
			<TopBar
				isMobileOpen={isMobileMenuOpen}
				isSidebarCollapsed={isSidebarCollapsed}
				toggleCollapse={handleToggle}
			/>
			{isMobileMenuOpen && (
				<div
					className={styles.backdrop}
					onClick={() => setIsMobileMenuOpen(false)}
					aria-hidden
				/>
			)}
			<main className={mainClass}>{children}</main>
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
