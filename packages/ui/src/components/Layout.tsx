import { useLocation } from 'react-router-dom';
import { Menu, X, LogOut, AudioLines } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { UpdateBanner } from '@/components/UpdateBanner';
import { AppSidebar } from '@/components/AppSidebar';
import { CommandBar } from '@/components/CommandBar';
import { ResizeHandle } from '@/components/ResizeHandle';
import { useSidebar } from '@/hooks/useSidebar';
import { AssistantPanel } from '@/components/AssistantPanel';
import { cn } from '@/lib/utils';


export function Layout({ children }: { children: React.ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [operatorOpen, setOperatorOpen] = useState(false);
  const location = useLocation();
  const { user, logout } = useAuth();
  const { width, resize, sidebarData, isLoading } = useSidebar();

  const isSessionPage = location.pathname.startsWith('/sessions/');
  const isFullHeightPage = isSessionPage || location.pathname === '/kanban';

  return (
    <div className="flex h-dvh flex-col px-2 pb-2 bg-background">
      <CommandBar />
      {/* Full-width top bar: traffic lights → logo → per-page tools (portaled into #app-toolbar) */}
      <div className="shrink-0 flex items-stretch h-9 rounded-t-xl overflow-hidden border border-border border-t-0 bg-card electrobun-webkit-app-region-drag">
        {/* macOS traffic lights sit over this spacer in the desktop app */}
        <div className="hidden electron-titlebar w-[72px] shrink-0" />
        <div className="flex items-center px-2 shrink-0">
          <img src="/logo.png" alt="Remote Agent" className="size-4 rounded" />
        </div>
        <div id="app-toolbar" className="flex-1 min-w-0 flex items-stretch" />
        <button
          onClick={() => setOperatorOpen((o) => !o)}
          title="Operator (hold ⌥Space to talk)"
          className={cn(
            'hidden md:flex shrink-0 items-center gap-1 px-2.5 border-l border-border text-[10.5px] font-medium electrobun-webkit-app-region-no-drag',
            operatorOpen ? 'text-foreground bg-secondary' : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
          )}
        >
          <AudioLines className="size-[11px]" />
          Operator
        </button>
      </div>

      <div className="flex flex-1 min-h-0 gap-2">
      {/* Desktop Sidebar - grouped box on the base canvas */}
      <aside
        className="hidden md:flex shrink-0 mt-2 rounded-lg border border-border overflow-hidden"
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

      {/* Center: content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile-only header */}
        <header className="md:hidden sticky top-0 z-30 border-b bg-background/95 backdrop-blur safe-area-top">
          <div className="flex h-12 items-center px-3">
            <Button
              variant="ghost"
              size="icon"
              className="mr-1 h-10 w-10"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
            <div className="flex items-center gap-2">
              <img src="/logo.png" alt="Remote Agent" className="h-6 w-6 rounded" />
            </div>
            <div className="ml-auto flex items-center gap-1">
              {user && (
                <>
                  <Avatar className="h-7 w-7">
                    <AvatarImage src={user.image} alt={user.name} />
                    <AvatarFallback className="text-xs">{user.name?.charAt(0).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <Button variant="ghost" size="icon" onClick={logout} className="h-9 w-9">
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
        {isFullHeightPage ? (
          <main className="flex-1 flex flex-col overflow-hidden min-h-0">{isSessionPage ? children : <div className="flex-1 min-h-0 mt-2 p-4 md:p-6 flex flex-col rounded-lg border border-border bg-card">{children}</div>}</main>
        ) : (
          <main className="flex-1 overflow-y-auto mt-2 p-4 md:p-6 safe-area-bottom rounded-lg border border-border bg-card">
            <div className="max-w-6xl mx-auto">{children}</div>
          </main>
        )}
      </div>

      {/* Right rail: the voice operator */}
      <AssistantPanel open={operatorOpen} onOpenChange={setOperatorOpen} />
      </div>
    </div>
  );
}
