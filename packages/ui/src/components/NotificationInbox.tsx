import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, ExternalLink, CheckCircle2 } from 'lucide-react';
import { api, NotificationRecord, type NotificationOption, type NotificationAction } from '@/lib/api';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';

export function NotificationInbox() {
  const [isOpen, setIsOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: unreadData } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: api.getUnreadCount,
    refetchInterval: 30000,
  });

  const { data: notificationsData, isLoading } = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => api.getNotifications({ status: 'pending,sent,read', limit: 20 }),
    enabled: isOpen,
  });

  const markReadMutation = useMutation({
    mutationFn: (ids: string[]) => api.markNotificationsRead(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const unreadCount = unreadData?.count ?? 0;
  const notifications = notificationsData?.notifications ?? [];

  const handleMarkAllRead = () => {
    const unreadIds = notifications
      .filter(n => n.status === 'pending' || n.status === 'sent')
      .map(n => n.id);
    if (unreadIds.length > 0) {
      markReadMutation.mutate(unreadIds);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-md hover:bg-muted"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto rounded-md border bg-popover shadow-lg z-50">
            <div className="flex items-center justify-between p-3 border-b">
              <h3 className="font-semibold">Notifications</h3>
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Mark all read
                </button>
              )}
            </div>

            {isLoading ? (
              <div className="p-4 text-center text-muted-foreground">Loading...</div>
            ) : notifications.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground">No notifications</div>
            ) : (
              <ul>
                {notifications.map((notification) => (
                  <NotificationItem
                    key={notification.id}
                    notification={notification}
                    onClose={() => setIsOpen(false)}
                  />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function buildInboxChoices(notification: NotificationRecord): { id: string; label: string }[] | null {
  const options = notification.metadata?.options as NotificationOption[] | undefined;
  const actions = notification.actions as NotificationAction[] | undefined;

  if (options && options.length > 0) {
    return options.map((opt) => ({ id: opt.value, label: opt.label }));
  }
  if (actions && actions.length > 0) {
    return actions.map((act) => ({ id: act.action, label: act.label }));
  }
  return null;
}

function NotificationItem({
  notification,
  onClose,
}: {
  notification: NotificationRecord;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const isUnread = notification.status === 'pending' || notification.status === 'sent';
  const isResolved = notification.status === 'resolved';
  const choices = buildInboxChoices(notification);

  const markReadMutation = useMutation({
    mutationFn: () => api.markNotificationRead(notification.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const respondMutation = useMutation({
    mutationFn: (action: string) => api.respondToNotification(notification.id, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const handleClick = () => {
    if (isUnread) {
      markReadMutation.mutate();
    }
    const path = notification.terminalId
      ? `/sessions/${notification.sessionId}/${notification.terminalId}`
      : `/sessions/${notification.sessionId}`;
    window.location.href = path;
    onClose();
  };

  const projectName = notification.metadata?.projectName;
  const stopReason = notification.metadata?.stopReason;

  return (
    <li
      className={`p-3 border-b last:border-b-0 cursor-pointer hover:bg-muted ${
        isUnread ? 'bg-muted/50' : ''
      }`}
      onClick={handleClick}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {projectName && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                {projectName}
              </span>
            )}
            <span className="font-medium text-sm truncate">{notification.title}</span>
            {isUnread && (
              <span className="h-2 w-2 rounded-full bg-blue-500 flex-shrink-0" />
            )}
          </div>
          <p className="text-sm text-muted-foreground line-clamp-2">{notification.body}</p>
          {choices && choices.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {choices.map((c, i) => (
                <button
                  key={c.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    respondMutation.mutate(c.id);
                  }}
                  disabled={isResolved && notification.resolvedAction !== c.id}
                  className={cn(
                    'px-2 py-0.5 rounded text-xs font-medium border transition-all max-w-[140px] truncate',
                    isResolved && notification.resolvedAction === c.id
                      ? 'bg-foreground text-background border-foreground'
                      : isResolved
                      ? 'opacity-30 cursor-not-allowed border-border/40 text-muted-foreground'
                      : i === 0
                      ? 'bg-foreground text-background border-foreground hover:opacity-90'
                      : 'border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60'
                  )}
                >
                  {isResolved && notification.resolvedAction === c.id ? (
                    <span className="inline-flex items-center gap-1">
                      <CheckCircle2 className="size-2.5 shrink-0" />
                      <span className="truncate">{c.label}</span>
                    </span>
                  ) : (
                    c.label
                  )}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
            </span>
            {stopReason && stopReason !== 'end_turn' && (
              <span className="text-xs px-1 py-0.5 rounded bg-yellow-500/20 text-yellow-600">
                {stopReason}
              </span>
            )}
          </div>
        </div>
        <ExternalLink className="h-4 w-4 text-muted-foreground flex-shrink-0" />
      </div>
    </li>
  );
}
