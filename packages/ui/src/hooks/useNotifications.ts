import { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  isFirebaseConfigured,
  requestNotificationPermission,
  getNotificationPermission,
  onForegroundMessage,
} from '@/lib/firebase';
import { toast } from '@/components/ui/Toaster';

export type NotificationStatus =
  | 'unsupported'      // Browser doesn't support notifications
  | 'unconfigured'     // Firebase not configured on server
  | 'default'          // Permission not yet requested
  | 'denied'           // User denied permission
  | 'granted'          // Permission granted but not registered
  | 'registered'       // Fully registered with FCM
  | 'loading';         // Registration in progress

interface UseNotificationsReturn {
  status: NotificationStatus;
  isSupported: boolean;
  isConfigured: boolean;
  enableNotifications: () => Promise<void>;
  isEnabling: boolean;
}

function getDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS Device';
  if (/Android/.test(ua)) return 'Android Device';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Web Browser';
}

export function useNotifications(): UseNotificationsReturn {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<NotificationStatus>('loading');
  const [isEnabling, setIsEnabling] = useState(false);

  // Check initial status
  useEffect(() => {
    const checkStatus = async () => {
      // Check browser support
      if (!('Notification' in window) || !('serviceWorker' in navigator)) {
        setStatus('unsupported');
        return;
      }

      // Check Firebase configuration
      if (!isFirebaseConfigured()) {
        setStatus('unconfigured');
        return;
      }

      // Check permission status
      const permission = getNotificationPermission();
      if (permission === 'denied') {
        setStatus('denied');
        return;
      }

      if (permission === 'default') {
        setStatus('default');
        return;
      }

      // Permission granted - check if registered
      try {
        const devices = await api.getDevices();
        if (devices.length > 0) {
          setStatus('registered');
        } else {
          setStatus('granted');
        }
      } catch {
        setStatus('granted');
      }
    };

    checkStatus();
  }, []);

  // Set up foreground message handler
  useEffect(() => {
    if (status !== 'registered') return;

    const unsubscribe = onForegroundMessage((payload) => {
      // Show toast for foreground notifications
      const notification = payload as { notification?: { title?: string; body?: string } };
      if (notification.notification) {
        toast({
          title: notification.notification.title || 'Notification',
          description: notification.notification.body,
        });
      }
    });

    return unsubscribe;
  }, [status]);

  const enableNotifications = useCallback(async () => {
    setIsEnabling(true);

    try {
      // Request permission and get token
      const token = await requestNotificationPermission();
      if (!token) {
        throw new Error('Failed to get FCM token');
      }

      // Register with backend
      const deviceName = getDeviceName();
      await api.registerFCM(token, deviceName);

      // Invalidate devices query
      queryClient.invalidateQueries({ queryKey: ['devices'] });

      setStatus('registered');
      toast({ title: 'Notifications enabled', description: 'You will now receive push notifications' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to enable notifications';

      if (message.includes('permission denied') || message.includes('Permission denied')) {
        setStatus('denied');
      }

      toast({ title: 'Error', description: message, variant: 'destructive' });
      throw error;
    } finally {
      setIsEnabling(false);
    }
  }, [queryClient]);

  return {
    status,
    isSupported: status !== 'unsupported',
    isConfigured: status !== 'unconfigured',
    enableNotifications,
    isEnabling,
  };
}
