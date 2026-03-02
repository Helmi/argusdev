import {ReactNode, useEffect, useCallback} from 'react';
import {Header} from './Header';
import {Footer} from './Footer';
import {Sidebar} from './Sidebar';
import {ContextSidebar} from '@/components/ContextSidebar';
import {TdReviewBanner} from '@/components/TdReviewBanner';
import {cn} from '@/lib/utils';
import {useAppStore} from '@/lib/store';
import {useIsMobile} from '@/hooks/useIsMobile';

interface LayoutProps {
	children: ReactNode;
}

export function Layout({children}: LayoutProps) {
	const {
		sidebarOpen,
		sidebarCollapsed,
		contextSidebarSessionId,
		toggleSidebar,
		selectedSessions,
	} = useAppStore();
	const isMobile = useIsMobile();

	// Auto-open sidebar on mobile when no sessions are selected
	useEffect(() => {
		if (isMobile && selectedSessions.length === 0 && !sidebarOpen) {
			toggleSidebar();
		}
	}, [isMobile, selectedSessions.length, sidebarOpen, toggleSidebar]);

	// Close sidebar on Escape key (mobile)
	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			if (e.key === 'Escape' && isMobile && sidebarOpen) {
				toggleSidebar();
			}
		},
		[isMobile, sidebarOpen, toggleSidebar],
	);

	useEffect(() => {
		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [handleKeyDown]);

	// Lock body scroll when mobile sidebar is open
	useEffect(() => {
		if (isMobile && sidebarOpen) {
			document.body.style.overflow = 'hidden';
			return () => {
				document.body.style.overflow = '';
			};
		}
	}, [isMobile, sidebarOpen]);

	return (
		<div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
			<Header />
			<TdReviewBanner />
			<div className="relative flex min-w-0 flex-1 overflow-hidden">
				{/* Mobile backdrop */}
				{isMobile && sidebarOpen && (
					<div
						className="fixed inset-0 top-9 bottom-7 z-40 bg-black/50 animate-in fade-in-0 duration-200"
						onClick={toggleSidebar}
						aria-hidden="true"
					/>
				)}

				{/* Sidebar - fixed overlay on mobile, static on desktop */}
				<div
					className={cn(
						'shrink-0 z-50 h-full',
						isMobile &&
							'fixed top-9 bottom-7 left-0 transition-transform duration-200 ease-out',
						isMobile && !sidebarOpen && '-translate-x-full',
						isMobile && sidebarOpen && 'translate-x-0',
					)}
					role={isMobile ? 'dialog' : undefined}
					aria-modal={isMobile && sidebarOpen ? 'true' : undefined}
					aria-label={isMobile ? 'Navigation sidebar' : undefined}
				>
					<Sidebar />
				</div>

				<main
					className={cn(
						'min-h-0 min-w-0 flex-1 overflow-hidden transition-all duration-200',
						sidebarOpen && !sidebarCollapsed && 'md:ml-0',
					)}
				>
					{children}
				</main>
				{contextSidebarSessionId && <ContextSidebar />}
			</div>
			<Footer />
		</div>
	);
}
