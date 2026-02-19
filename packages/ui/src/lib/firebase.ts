import { initializeApp, getApps } from 'firebase/app';
import { getMessaging, getToken, onMessage, isSupported, Messaging } from 'firebase/messaging';
import { env } from './env';

const firebaseConfig = {
  apiKey: env('VITE_FIREBASE_API_KEY'),
  authDomain: env('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: env('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: env('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: env('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: env('VITE_FIREBASE_APP_ID'),
};

// Check if Firebase is configured
export function isFirebaseConfigured(): boolean {
  return !!(
    firebaseConfig.apiKey &&
    firebaseConfig.projectId &&
    firebaseConfig.messagingSenderId &&
    firebaseConfig.appId
  );
}

// Initialize Firebase app (singleton)
function getFirebaseApp() {
  if (!isFirebaseConfigured()) {
    return null;
  }
  if (getApps().length === 0) {
    return initializeApp(firebaseConfig);
  }
  return getApps()[0];
}

// Get messaging instance
let messagingInstance: Messaging | null = null;

export async function getFirebaseMessaging(): Promise<Messaging | null> {
  if (!isFirebaseConfigured()) {
    console.warn('Firebase is not configured');
    return null;
  }

  const supported = await isSupported();
  if (!supported) {
    console.warn('Firebase messaging is not supported in this browser');
    return null;
  }

  if (messagingInstance) {
    return messagingInstance;
  }

  const app = getFirebaseApp();
  if (!app) {
    return null;
  }

  messagingInstance = getMessaging(app);
  return messagingInstance;
}

// Request notification permission and get FCM token
export async function requestNotificationPermission(): Promise<string | null> {
  if (!('Notification' in window)) {
    throw new Error('This browser does not support notifications');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notification permission denied');
  }

  const messaging = await getFirebaseMessaging();
  if (!messaging) {
    throw new Error('Firebase messaging not available');
  }

  // Get VAPID key from env
  const vapidKey = env('VITE_FIREBASE_VAPID_KEY');
  if (!vapidKey) {
    throw new Error('VAPID key not configured');
  }

  // Register service worker
  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');

  // Get FCM token
  const token = await getToken(messaging, {
    vapidKey,
    serviceWorkerRegistration: registration,
  });

  return token;
}

// Listen for foreground messages
export function onForegroundMessage(callback: (payload: unknown) => void): () => void {
  let unsubscribe: (() => void) | null = null;

  console.log('[Firebase] Setting up foreground message listener...');

  getFirebaseMessaging()
    .then((messaging) => {
      if (messaging) {
        console.log('[Firebase] Messaging instance ready, registering onMessage handler');
        unsubscribe = onMessage(messaging, (payload) => {
          console.log('[Firebase] Foreground message received:', {
            messageId: payload.messageId,
            from: payload.from,
            collapseKey: payload.collapseKey,
            notification: payload.notification,
            data: payload.data,
            fcmOptions: payload.fcmOptions,
          });
          callback(payload);
        });
        console.log('[Firebase] onMessage handler registered successfully');
      } else {
        console.warn('[Firebase] Messaging instance is null, cannot register onMessage handler');
      }
    })
    .catch((error) => {
      console.error('[Firebase] Failed to setup foreground message listener:', error);
    });

  return () => {
    console.log('[Firebase] Cleaning up foreground message listener');
    unsubscribe?.();
  };
}

// Get current notification permission status
export function getNotificationPermission(): NotificationPermission {
  if (!('Notification' in window)) {
    return 'denied';
  }
  return Notification.permission;
}
