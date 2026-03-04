import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  AlertCircle,
  MessageSquare,
  CheckCircle2,
  Zap,
  Clock,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { api, NotificationRecord } from '@/lib/api';
import { cn } from '@/lib/utils';

function getNotificationTypeIcon(type: string) {
  switch (type) {
    case 'error':
      return <AlertCircle className="h-4 w-4 text-red-500" />;
    case 'input_required':
      return <MessageSquare className="h-4 w-4 text-orange-500" />;
    case 'task_complete':
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case 'status_change':
      return <Zap className="h-4 w-4 text-blue-500" />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

export function NotificationPanel() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: unreadData } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: api.getUnreadCount,
    refetchInterval: 30000,
  });

  const { data: notificationsData, isLoading } = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => api.getNotifications({ status: 'pending,sent,read', limit: 20 }),
  });

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

  const unreadCount = unreadData?.count ?? 0;
  const notifications = notificationsData?.notifications ?? [];

  const handleMarkAllRead = () => {
    const unreadIds = notifications
      .filter((n) => n.status === 'pending' || n.status === 'sent')
      .map((n) => n.id);
    if (unreadIds.length > 0) {
      markReadMutation.mutate(unreadIds);
    }
  };

  const handleNotificationClick = (notification: NotificationRecord) => {
    const isUnread =
      notification.status === 'pending' || notification.status === 'sent';
    if (isUnread) {
      markSingleReadMutation.mutate(notification.id);
    }
    const terminalParam = notification.terminalId
      ? `?terminalId=${notification.terminalId}`
      : '';
    navigate(`/sessions/${notification.sessionId}${terminalParam}`);
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Notifications</h2>
          {unreadCount > 0 && (
            <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-medium">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            disabled={markReadMutation.isPending}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Mark all read
          </button>
        )}
      </div>

      {/* Notification List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            Loading...
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <Bell className="h-8 w-8 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">No notifications</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              You&apos;re all caught up
            </p>
          </div>
        ) : (
          <ul className="relative">
            {notifications.map((notification, index) => {
              const isUnread =
                notification.status === 'pending' ||
                notification.status === 'sent';
              const isLast = index === notifications.length - 1;
              const projectName = notification.metadata?.projectName;
              const stopReason = notification.metadata?.stopReason;

              return (
                <li
                  key={notification.id}
                  className={cn(
                    'relative flex gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-muted/50',
                    isUnread && 'bg-primary/[0.03]'
                  )}
                  onClick={() => handleNotificationClick(notification)}
                >
                  {/* Timeline connector */}
                  <div className="relative flex flex-col items-center shrink-0 w-5">
                    {/* Dot */}
                    <div
                      className={cn(
                        'relative z-10 mt-1 h-2.5 w-2.5 rounded-full border-2',
                        isUnread
                          ? 'bg-blue-500 border-blue-500'
                          : 'bg-muted-foreground/30 border-muted-foreground/30'
                      )}
                    />
                    {/* Vertical line */}
                    {!isLast && (
                      <div className="absolute top-4 bottom-0 w-px bg-border -mb-3" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2">
                      {/* Type icon */}
                      <div className="shrink-0 mt-0.5">
                        {getNotificationTypeIcon(notification.type)}
                      </div>

                      <div className="flex-1 min-w-0">
                        {/* Title row */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className={cn(
                              'text-sm truncate',
                              isUnread ? 'font-semibold' : 'font-medium'
                            )}
                          >
                            {notification.title}
                          </span>
                          {projectName && (
                            <span className="inline-flex text-[10px] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary font-medium shrink-0">
                              {projectName}
                            </span>
                          )}
                        </div>

                        {/* Body */}
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                          {notification.body}
                        </p>

                        {/* Footer: time + stop reason */}
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[11px] text-muted-foreground/70">
                            {formatDistanceToNow(
                              new Date(notification.createdAt),
                              { addSuffix: true }
                            )}
                          </span>
                          {stopReason && stopReason !== 'end_turn' && (
                            <span className="text-[10px] px-1 py-0.5 rounded bg-yellow-500/20 text-yellow-600 font-medium">
                              {stopReason}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
