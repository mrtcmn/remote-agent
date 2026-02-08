import { useEffect, useRef, useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { AppState, type AppStateStatus } from 'react-native';
import { api } from '../lib/api';
import { useNotificationStore } from '../stores/notifications';
import {
  registerForPushNotifications,
  handleNotificationResponse,
  initializeNotifications,
} from '../lib/notifications';
import type { NotificationRecord, NotificationPrefs } from '../types';

export function useNotifications() {
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [isEnabling, setIsEnabling] = useState(false);
  const queryClient = useQueryClient();
  const { setUnreadCount, incrementUnread } = useNotificationStore();

  // Response listener for action buttons / inline reply
  const responseListener = useRef<Notifications.Subscription>();
  // Foreground listener
  const foregroundListener = useRef<Notifications.Subscription>();

  // Unread count query
  const unreadQuery = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: api.getUnreadCount,
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (unreadQuery.data) {
      setUnreadCount(unreadQuery.data.count);
    }
  }, [unreadQuery.data]);

  // Set up notification listeners
  useEffect(() => {
    // Initialize channels, categories, foreground handler
    initializeNotifications();

    // Listen for notification responses (action buttons, taps, inline replies)
    responseListener.current =
      Notifications.addNotificationResponseReceivedListener(async (response) => {
        const result = await handleNotificationResponse(response);
        if (result?.navigate && result.sessionId) {
          // Navigation is handled by the root component
          // We emit a custom event or use a callback
        }
        // Refresh notifications after action
        queryClient.invalidateQueries({ queryKey: ['notifications'] });
      });

    // Listen for foreground notifications to update badge count
    foregroundListener.current =
      Notifications.addNotificationReceivedListener((notification) => {
        incrementUnread();
        // Invalidate relevant queries based on notification type
        const data = notification.request.content.data;
        const type = data?.type as string;
        const sessionId = data?.sessionId as string;

        if (type === 'task_complete') {
          queryClient.invalidateQueries({ queryKey: ['sessions'] });
        }
        if (sessionId) {
          queryClient.invalidateQueries({
            queryKey: ['session', sessionId],
          });
          queryClient.invalidateQueries({
            queryKey: ['terminals', sessionId],
          });
        }
        queryClient.invalidateQueries({
          queryKey: ['notifications', 'unread-count'],
        });
      });

    return () => {
      if (responseListener.current) {
        Notifications.removeNotificationSubscription(responseListener.current);
      }
      if (foregroundListener.current) {
        Notifications.removeNotificationSubscription(foregroundListener.current);
      }
    };
  }, []);

  // Refresh badge when app comes to foreground
  useEffect(() => {
    const handleAppState = (state: AppStateStatus) => {
      if (state === 'active') {
        queryClient.invalidateQueries({
          queryKey: ['notifications', 'unread-count'],
        });
      }
    };
    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, []);

  const enableNotifications = useCallback(async () => {
    setIsEnabling(true);
    try {
      const token = await registerForPushNotifications();
      setPushToken(token);
    } finally {
      setIsEnabling(false);
    }
  }, []);

  return {
    pushToken,
    unreadCount: unreadQuery.data?.count ?? 0,
    isEnabling,
    enableNotifications,
    refetchUnread: unreadQuery.refetch,
  };
}

// ─── Notification Inbox Hook ─────────────────────────────────────────────────

export function useNotificationInbox(params?: {
  status?: string;
  limit?: number;
}) {
  const queryClient = useQueryClient();

  const notificationsQuery = useQuery({
    queryKey: ['notifications', 'inbox', params],
    queryFn: () =>
      api.getNotifications({
        status: params?.status,
        limit: params?.limit ?? 20,
      }),
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.markNotificationRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: (ids: string[]) => api.markNotificationsRead(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const respondMutation = useMutation({
    mutationFn: ({
      id,
      action,
      text,
    }: {
      id: string;
      action: string;
      text?: string;
    }) => api.respondToNotification(id, { action, text }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  return {
    notifications: notificationsQuery.data?.notifications ?? [],
    isLoading: notificationsQuery.isLoading,
    refetch: notificationsQuery.refetch,
    markRead: markReadMutation.mutateAsync,
    markAllRead: markAllReadMutation.mutateAsync,
    respond: respondMutation.mutateAsync,
  };
}

// ─── Notification Preferences Hook ───────────────────────────────────────────

export function useNotificationPreferences() {
  const queryClient = useQueryClient();

  const prefsQuery = useQuery({
    queryKey: ['notifications', 'preferences'],
    queryFn: api.getPreferences,
  });

  const updateMutation = useMutation({
    mutationFn: (prefs: Partial<NotificationPrefs>) =>
      api.updatePreferences(prefs),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['notifications', 'preferences'],
      });
    },
  });

  const devicesQuery = useQuery({
    queryKey: ['notifications', 'devices'],
    queryFn: api.getDevices,
  });

  const testMutation = useMutation({
    mutationFn: () => api.testNotification(),
  });

  return {
    preferences: prefsQuery.data,
    devices: devicesQuery.data ?? [],
    isLoading: prefsQuery.isLoading,
    updatePreferences: updateMutation.mutateAsync,
    testNotification: testMutation.mutateAsync,
    isTesting: testMutation.isPending,
  };
}
