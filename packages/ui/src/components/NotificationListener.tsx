import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  isFirebaseConfigured,
  getNotificationPermission,
  onForegroundMessage,
} from '@/lib/firebase';
import { toast } from '@/components/ui/Toaster';

/**
 * Global notification listener component.
 * Mount this at the app root level to receive foreground notifications on any page.
 */
export function NotificationListener() {
  const queryClient = useQueryClient();
  const [isReady, setIsReady] = useState(false);

  // Check if we should set up the listener
  useEffect(() => {
    const checkReady = async () => {
      console.log('[NotificationListener] Checking if notifications are ready...');

      // Check browser support
      if (!('Notification' in window) || !('serviceWorker' in navigator)) {
        console.log('[NotificationListener] Browser does not support notifications');
        return;
      }

      // Check Firebase configuration
      if (!isFirebaseConfigured()) {
        console.log('[NotificationListener] Firebase not configured');
        return;
      }

      // Check permission status
      const permission = getNotificationPermission();
      console.log('[NotificationListener] Permission status:', permission);
      if (permission !== 'granted') {
        console.log('[NotificationListener] Permission not granted, skipping listener setup');
        return;
      }

      // Check if registered with backend
      try {
        const devices = await api.getDevices();
        console.log('[NotificationListener] Registered devices:', devices.length);
        if (devices.length > 0) {
          setIsReady(true);
        }
      } catch (error) {
        console.log('[NotificationListener] Failed to check devices:', error);
      }
    };

    checkReady();
  }, []);

  // Set up foreground message handler
  useEffect(() => {
    if (!isReady) {
      console.log('[NotificationListener] Not ready, skipping listener setup');
      return;
    }

    console.log('[NotificationListener] Setting up foreground message listener');
    const unsubscribe = onForegroundMessage((payload) => {
      console.log('[NotificationListener] Received foreground message:', payload);

      const notification = payload as {
        notification?: { title?: string; body?: string };
        data?: Record<string, string>;
      };

      console.log('[NotificationListener] Notification:', notification.notification);
      console.log('[NotificationListener] Data:', notification.data);

      // Show toast
      if (notification.notification) {
        toast({
          title: notification.notification.title || 'Notification',
          description: notification.notification.body,
        });
      }

      // Invalidate relevant queries based on notification type
      if (notification.data?.type === 'task_complete') {
        queryClient.invalidateQueries({ queryKey: ['sessions'] });
      }
      if (notification.data?.sessionId) {
        queryClient.invalidateQueries({
          queryKey: ['session', notification.data.sessionId],
        });
      }
    });

    return () => {
      console.log('[NotificationListener] Cleaning up foreground message listener');
      unsubscribe();
    };
  }, [isReady, queryClient]);

  // This component doesn't render anything
  return null;
}
