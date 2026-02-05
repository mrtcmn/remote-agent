// Firebase messaging service worker
// This handles background push notifications

importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');

// Firebase config will be passed via the messaging.getToken() call
// but we need to initialize with minimal config for the SW to work
firebase.initializeApp({
  apiKey: 'placeholder',
  projectId: 'placeholder',
  messagingSenderId: 'placeholder',
  appId: 'placeholder',
});

const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  console.log('[SW] Received background message:', payload);

  const notificationTitle = payload.notification?.title || 'Remote Agent';
  const notificationOptions = {
    body: payload.notification?.body || 'You have a new notification',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.data?.tag || 'remote-agent',
    data: payload.data,
    requireInteraction: payload.data?.requireInteraction === 'true',
    actions: payload.data?.actions ? JSON.parse(payload.data.actions) : [],
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  const { action, notification } = event;
  const data = notification.data || {};
  const { sessionId, notificationId } = data;

  notification.close();

  // Handle action button clicks
  if (action && action !== 'default' && notificationId) {
    event.waitUntil(
      fetch(`/api/notifications/${notificationId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action }),
      }).catch(err => console.error('Failed to send action response:', err))
    );
  }

  // Open or focus the app
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Try to find an existing window with the session
      for (const client of clientList) {
        if (client.url.includes(`/sessions/${sessionId}`) && 'focus' in client) {
          return client.focus();
        }
      }
      // Try to find any app window
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client && sessionId) {
            return client.navigate(`/sessions/${sessionId}`);
          }
          return;
        }
      }
      // Open new window
      if (sessionId) {
        return clients.openWindow(`/sessions/${sessionId}`);
      }
      return clients.openWindow('/');
    })
  );
});
