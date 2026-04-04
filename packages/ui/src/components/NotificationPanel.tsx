import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Bell,
  AlertCircle,
  MessageSquare,
  CheckCircle2,
  Zap,
  Clock,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { api, type NotificationRecord, type NotificationOption, type NotificationAction } from '@/lib/api';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

type Tab = 'all' | 'review' | 'finished' | 'errors';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PALETTE = ['#3b82f6', '#f59e0b', '#10b981', '#a78bfa', '#f472b6', '#fb923c', '#34d399'];
function badgeColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function getNotificationIcon(type: string) {
  switch (type) {
    case 'error':
      return { icon: AlertCircle, color: '#f87171' };
    case 'input_required':
      return { icon: MessageSquare, color: '#f97316' };
    case 'task_complete':
      return { icon: CheckCircle2, color: '#10b981' };
    case 'status_change':
      return { icon: Zap, color: '#60a5fa' };
    default:
      return { icon: Clock, color: '#9ca3af' };
  }
}

// ─── Primitives ──────────────────────────────────────────────────────────────

function UnreadDot() {
  return (
    <span className="relative flex size-2 shrink-0 mt-[3px]">
      <motion.span
        className="absolute inset-0 rounded-full bg-emerald-400"
        animate={{ scale: [1, 1.8, 1], opacity: [0.7, 0, 0.7] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
      />
      <span className="relative rounded-full h-full w-full bg-emerald-500" />
    </span>
  );
}

function AgentAvatar({ type }: { type: string }) {
  const { icon: Icon, color } = getNotificationIcon(type);
  return (
    <span
      className="size-7 rounded-lg flex items-center justify-center shrink-0"
      style={{ backgroundColor: color + '22', border: `1px solid ${color}33` }}
    >
      <Icon className="size-3.5" style={{ color }} />
    </span>
  );
}

function ProjectBadge({ name }: { name: string }) {
  const color = badgeColor(name);
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold leading-none"
      style={{ backgroundColor: color + '22', border: `1px solid ${color}33`, color }}
    >
      {name}
    </span>
  );
}

// ─── Choice Buttons ─────────────────────────────────────────────────────────

function getChoiceVariant(index: number, total: number): 'primary' | 'secondary' | 'danger' {
  if (index === 0) return 'primary';
  if (index === total - 1 && total > 2) {
    // Check if last option looks like a cancel/abort/deny action
    return 'secondary';
  }
  return 'secondary';
}

function ChoiceButtons({
  choices,
  resolved,
  onResolve,
}: {
  choices: { id: string; label: string; variant: 'primary' | 'secondary' | 'danger' }[];
  resolved?: string | null;
  onResolve: (id: string, label: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {choices.map((c) => (
        <motion.button
          key={c.id}
          whileTap={{ scale: 0.95 }}
          transition={{ duration: 0.15 }}
          onClick={(e) => { e.stopPropagation(); onResolve(c.id, c.label); }}
          disabled={!!resolved && resolved !== c.id}
          className={cn(
            'px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-150 border max-w-[160px] truncate',
            resolved === c.id
              ? 'bg-foreground text-background border-foreground'
              : resolved
              ? 'opacity-30 cursor-not-allowed border-border/40 text-muted-foreground'
              : c.variant === 'primary'
              ? 'border-foreground text-foreground hover:bg-foreground hover:text-background'
              : c.variant === 'danger'
              ? 'border-red-500/40 text-red-500 hover:bg-red-500/10'
              : 'border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60'
          )}
        >
          {resolved === c.id ? (
            <span className="inline-flex items-center gap-1 min-w-0">
              <CheckCircle2 className="size-2.5 shrink-0" />
              <span className="truncate">{c.label}</span>
            </span>
          ) : (
            <span className="truncate">{c.label}</span>
          )}
        </motion.button>
      ))}
    </div>
  );
}

function buildChoices(notification: NotificationRecord): { id: string; label: string; variant: 'primary' | 'secondary' | 'danger' }[] | null {
  // Prefer metadata.options (from classifier), fall back to actions
  const options = notification.metadata?.options as NotificationOption[] | undefined;
  const actions = notification.actions as NotificationAction[] | undefined;

  if (options && options.length > 0) {
    return options.map((opt, i) => ({
      id: opt.value,
      label: opt.label,
      variant: opt.isDefault ? 'primary' : getChoiceVariant(i, options.length),
    }));
  }

  if (actions && actions.length > 0) {
    return actions.map((act, i) => ({
      id: act.action,
      label: act.label,
      variant: getChoiceVariant(i, actions.length),
    }));
  }

  return null;
}

// ─── Notification Row ────────────────────────────────────────────────────────

function NotifRow({
  notification,
  onMarkRead,
  onNavigate,
  onResolve,
}: {
  notification: NotificationRecord;
  onMarkRead: (id: string) => void;
  onNavigate: (notification: NotificationRecord) => void;
  onResolve: (notificationId: string, action: string, label: string) => void;
}) {
  const isUnread = notification.status === 'pending' || notification.status === 'sent';
  const isResolved = notification.status === 'resolved';
  const projectName = notification.metadata?.projectName;
  const stopReason = notification.metadata?.stopReason;
  const choices = buildChoices(notification);
  const hasChoices = choices && choices.length > 0;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease: 'easeOut' } }}
      exit={{ opacity: 0, y: -6, transition: { duration: 0.15, ease: 'easeIn' } }}
      whileTap={isUnread ? { scale: 0.995 } : undefined}
      onClick={() => {
        if (isUnread) onMarkRead(notification.id);
        onNavigate(notification);
      }}
      className={cn(
        'px-4 py-3 space-y-2.5 transition-colors duration-150 cursor-pointer',
        isUnread ? 'bg-secondary/20 hover:bg-secondary/30' : 'hover:bg-secondary/10'
      )}
    >
      <div className="flex items-start gap-2.5">
        {/* Unread dot column */}
        <div className="w-3 shrink-0 flex justify-center pt-[3px]">
          <AnimatePresence>
            {isUnread && (
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <UnreadDot />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <AgentAvatar type={notification.type} />

        <div className="flex-1 min-w-0">
          <p className="text-xs leading-snug flex flex-wrap items-center gap-x-1 gap-y-0.5">
            <span className="font-semibold text-foreground">{notification.title}</span>
            {projectName && <ProjectBadge name={projectName} />}
          </p>
          <p className="text-[10px] text-muted-foreground/50 mt-0.5 font-mono">
            {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
            {stopReason && stopReason !== 'end_turn' && (
              <>
                <span className="mx-1.5 opacity-40">·</span>
                {stopReason}
              </>
            )}
          </p>
        </div>
      </div>

      {(notification.body || hasChoices) && (
        <div className="ml-[22px] space-y-2">
          {notification.body && (
            <p className="text-xs text-muted-foreground leading-relaxed border-l-2 border-border pl-3 line-clamp-3">
              {notification.body}
            </p>
          )}
          {hasChoices && (
            <ChoiceButtons
              choices={choices}
              resolved={isResolved ? notification.resolvedAction : null}
              onResolve={(action, label) => onResolve(notification.id, action, label)}
            />
          )}
        </div>
      )}
    </motion.div>
  );
}

// ─── Tabs ────────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'all', label: 'All', icon: Bell },
  { id: 'review', label: 'Review needed', icon: MessageSquare },
  { id: 'finished', label: 'Finished', icon: CheckCircle2 },
  { id: 'errors', label: 'Errors', icon: AlertCircle },
];

function filterNotifications(notifications: NotificationRecord[], tab: Tab): NotificationRecord[] {
  switch (tab) {
    case 'review':
      return notifications.filter(
        (n) => n.type === 'user_input_required' || n.type === 'permission_request'
      );
    case 'finished':
      return notifications.filter((n) => n.type === 'task_complete');
    case 'errors':
      return notifications.filter((n) => n.type === 'error');
    default:
      return notifications;
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function NotificationPanel() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('all');

  const { data: unreadData } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: api.getUnreadCount,
    refetchInterval: 30000,
  });

  const { data: notificationsData, isLoading, refetch: refetchList } = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => api.getNotifications({ status: 'pending,sent,read', limit: 30 }),
  });

  // When unread count changes, debounce-refetch the list after 3s
  const prevCountRef = useRef(unreadData?.count);
  useEffect(() => {
    const current = unreadData?.count;
    if (current !== undefined && prevCountRef.current !== undefined && current !== prevCountRef.current) {
      const timer = setTimeout(() => refetchList(), 3000);
      prevCountRef.current = current;
      return () => clearTimeout(timer);
    }
    prevCountRef.current = current;
  }, [unreadData?.count, refetchList]);

  const markReadMutation = useMutation({
    mutationFn: (ids: string[]) => api.markNotificationsRead(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const markSingleReadMutation = useMutation({
    mutationFn: (id: string) => api.markNotificationRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const respondMutation = useMutation({
    mutationFn: ({ id, action, label }: { id: string; action: string; label: string }) =>
      api.respondToNotification(id, action, label),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const unreadCount = unreadData?.count ?? 0;
  const allNotifications = notificationsData?.notifications ?? [];
  const notifications = filterNotifications(allNotifications, activeTab);

  const handleMarkAllRead = () => {
    const unreadIds = allNotifications
      .filter((n) => n.status === 'pending' || n.status === 'sent')
      .map((n) => n.id);
    if (unreadIds.length > 0) {
      markReadMutation.mutate(unreadIds);
    }
  };

  const handleNavigate = (notification: NotificationRecord) => {
    const path = notification.terminalId
      ? `/sessions/${notification.sessionId}/${notification.terminalId}`
      : `/sessions/${notification.sessionId}`;
    navigate(path);
  };

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-9 shrink-0">
        <div className="flex items-center gap-2">
          <Bell className="size-3.5 text-muted-foreground/60" />
          <span className="text-sm font-semibold text-foreground tracking-tight">Notifications</span>
        </div>
        <AnimatePresence mode="popLayout">
          {unreadCount > 0 && (
            <motion.span
              key={unreadCount}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              className="flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-orange-500 text-white text-[9px] font-bold px-1 tabular-nums"
            >
              {unreadCount}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <div className="h-px bg-border shrink-0" />

      {/* Tabs */}
      <div className="flex items-center gap-1 px-3 py-2 shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors',
              activeTab === tab.id
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
            )}
          >
            {activeTab === tab.id && (
              <motion.span
                layoutId="notif-tab-pill"
                className="absolute inset-0 rounded-md bg-secondary"
                transition={{ type: 'spring', stiffness: 400, damping: 35 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5">
              <tab.icon className="size-3" />
              {tab.label}
            </span>
          </button>
        ))}
      </div>

      <div className="h-px bg-border shrink-0" />

      {/* Feed */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            Loading...
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <Bell className="h-8 w-8 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">No notifications</p>
            <p className="text-xs text-muted-foreground/60 mt-1">You're all caught up</p>
          </div>
        ) : (
          <AnimatePresence initial={false} mode="popLayout">
            {notifications.map((notification, i) => (
              <div key={notification.id}>
                {i > 0 && <div className="h-px bg-border/50" />}
                <NotifRow
                  notification={notification}
                  onMarkRead={(id) => markSingleReadMutation.mutate(id)}
                  onNavigate={handleNavigate}
                  onResolve={(id, action, label) => respondMutation.mutate({ id, action, label })}
                />
              </div>
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* Footer */}
      <div className="h-px bg-border shrink-0" />
      <div className="flex items-center justify-between px-4 py-2.5 shrink-0">
        <button
          onClick={handleMarkAllRead}
          disabled={unreadCount === 0}
          className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors font-mono disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Mark all as read
        </button>
        <span className="text-[11px] text-muted-foreground/30 font-mono">
          {notifications.length} notifications
        </span>
      </div>
    </div>
  );
}
