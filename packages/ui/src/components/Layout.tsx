import { useLocation } from 'react-router-dom';
import { Menu, X, LogOut } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { UpdateBanner } from '@/components/UpdateBanner';
import { NotificationInbox } from '@/components/NotificationInbox';
import { AppSidebar } from '@/components/AppSidebar';
import { ResizeHandle } from '@/components/ResizeHandle';
import { useSidebar } from '@/hooks/useSidebar';
import { cn } from '@/lib/utils';

export function Layout({ children }: { children: React.ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const { user, logout } = useAuth();
  const { width, resize, sidebarData, isLoading } = useSidebar();

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
          <aside className="md:hidden fixed inset-y-0 left-0 z-50 w-72">
            <AppSidebar data={sidebarData} isLoading={isLoading} />
          </aside>
        </>
      )}

      {/* Right side: header + content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Slim Header */}
        <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur safe-area-top">
          <div className="flex h-12 items-center px-4">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden mr-2"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>

            <div className="md:hidden flex items-center gap-2">
              <div className="h-6 w-6 rounded-md bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold text-[10px]">RA</span>
              </div>
            </div>

            <div className="ml-auto flex items-center gap-2">
              {user && (
                <>
                  <NotificationInbox />
                  <Avatar className="h-7 w-7">
                    <AvatarImage src={user.image} alt={user.name} />
                    <AvatarFallback className="text-xs">{user.name?.charAt(0).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <Button variant="ghost" size="icon" onClick={logout} className="hidden md:flex h-8 w-8">
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
    </div>
  );
}
