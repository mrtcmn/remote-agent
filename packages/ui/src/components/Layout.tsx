import { useLocation } from 'react-router-dom';
import { Menu, X, LogOut, Bell } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { UpdateBanner } from '@/components/UpdateBanner';
import { NotificationPanel } from '@/components/NotificationPanel';
import { AppSidebar } from '@/components/AppSidebar';
import { ResizeHandle } from '@/components/ResizeHandle';
import { useSidebar } from '@/hooks/useSidebar';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

export function Layout({ children }: { children: React.ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const location = useLocation();
  const { user, logout } = useAuth();
  const { width, resize, sidebarData, isLoading } = useSidebar();

  const { data: unreadData } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: api.getUnreadCount,
    refetchInterval: 30000,
  });

  const unreadCount = unreadData?.count ?? 0;

  const isSessionPage = location.pathname.startsWith('/sessions/');
  const isFullHeightPage = isSessionPage || location.pathname === '/kanban';

  return (
    <div className={cn('flex', isFullHeightPage ? 'h-dvh' : 'min-h-dvh')}>
      {/* Desktop Sidebar */}
      <aside
        className="hidden md:flex shrink-0 border-r border-sidebar-border"
        style={{ width }}
      >
        <div className="flex-1 min-w-0">
          <AppSidebar data={sidebarData} isLoading={isLoading} />
        </div>
        <ResizeHandle onResize={resize} currentWidth={width} />
      </aside>

      {/* Mobile Sidebar Overlay */}
      {mobileMenuOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 z-40 bg-black/50"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="md:hidden fixed inset-y-0 left-0 z-50 w-[85vw] max-w-[320px] shadow-xl animate-slide-in-left">
            <AppSidebar data={sidebarData} isLoading={isLoading} onClose={() => setMobileMenuOpen(false)} />
          </aside>
        </>
      )}

      {/* Middle: header + content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Slim Header */}
        <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur safe-area-top">
          <div className="flex h-12 md:h-12 items-center px-3 md:px-4">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden mr-1 h-10 w-10"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>

            <div className="md:hidden flex items-center gap-2">
              <img src="/logo.svg" alt="Remote Agent" className="h-6 w-6" />
            </div>

            <div className="ml-auto flex items-center gap-1 md:gap-2">
              {user && (
                <>
                  {/* Mobile notification bell - visible below lg breakpoint */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="lg:hidden relative h-9 w-9 md:h-8 md:w-8"
                    onClick={() => setNotificationPanelOpen(!notificationPanelOpen)}
                  >
                    <Bell className="h-4 w-4" />
                    {unreadCount > 0 && (
                      <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-medium flex items-center justify-center">
                        {unreadCount > 9 ? '9+' : unreadCount}
                      </span>
                    )}
                  </Button>
                  <Avatar className="h-7 w-7">
                    <AvatarImage src={user.image} alt={user.name} />
                    <AvatarFallback className="text-xs">{user.name?.charAt(0).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <Button variant="ghost" size="icon" onClick={logout} className="h-9 w-9 md:h-8 md:w-8">
                    <LogOut className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Update Banner */}
        <UpdateBanner />

        {/* Main Content */}
        {isSessionPage ? (
          <main className="flex-1 flex flex-col overflow-hidden min-h-0">{children}</main>
        ) : isFullHeightPage ? (
          <main className="flex-1 flex flex-col overflow-hidden min-h-0 p-4 md:p-6">{children}</main>
        ) : (
          <main className="flex-1 p-4 md:p-6 safe-area-bottom">
            <div className="max-w-6xl mx-auto">{children}</div>
          </main>
        )}
      </div>

      {/* Desktop Right Sidebar - Notification Panel */}
      <aside className="hidden lg:flex shrink-0 w-[300px] border-l border-border overflow-hidden">
        <div className="flex-1 min-w-0">
          <NotificationPanel />
        </div>
      </aside>

      {/* Mobile Notification Panel Overlay */}
      {notificationPanelOpen && (
        <>
          <div
            className="lg:hidden fixed inset-0 z-40 bg-black/50"
            onClick={() => setNotificationPanelOpen(false)}
          />
          <aside className="lg:hidden fixed inset-y-0 right-0 z-50 w-[300px] max-w-[85vw] bg-background shadow-xl animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between px-4 py-2 border-b">
              <span className="text-sm font-medium">Notifications</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setNotificationPanelOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="h-[calc(100%-44px)]">
              <NotificationPanel />
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
