/**
 * Expo Notifications setup for Android.
 *
 * Handles:
 * - Android notification channels (permissions, input_required, task_complete, errors)
 * - Notification categories with actions (approve/deny, reply with text input)
 * - Foreground notification presentation
 * - Background notification task
 * - FCM token registration with backend
 */
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { api } from './api';

// ─── Constants ───────────────────────────────────────────────────────────────

export const BACKGROUND_NOTIFICATION_TASK = 'BACKGROUND_NOTIFICATION_TASK';

export const ANDROID_CHANNELS = {
  permissions: {
    id: 'permissions',
    name: 'Permission Requests',
    description: 'When Claude needs permission to perform an action',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#6366f1',
    sound: 'default',
  },
  input_required: {
    id: 'input_required',
    name: 'Input Required',
    description: 'When Claude needs your input or response',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#6366f1',
    sound: 'default',
  },
  task_complete: {
    id: 'task_complete',
    name: 'Task Complete',
    description: 'When a task finishes successfully',
    importance: Notifications.AndroidImportance.LOW,
    lightColor: '#22c55e',
  },
  errors: {
    id: 'errors',
    name: 'Errors',
    description: 'When an error occurs',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 500],
    lightColor: '#ef4444',
    sound: 'default',
  },
  default: {
    id: 'default',
    name: 'General',
    description: 'General notifications',
    importance: Notifications.AndroidImportance.DEFAULT,
    lightColor: '#6366f1',
  },
} as const;

// Map notification types to channels
export function getChannelId(type: string): string {
  switch (type) {
    case 'permission_request':
      return 'permissions';
    case 'user_input_required':
      return 'input_required';
    case 'task_complete':
      return 'task_complete';
    case 'error':
      return 'errors';
    default:
      return 'default';
  }
}

// ─── Notification Categories (Action Buttons + Inline Reply) ─────────────────

/**
 * Sets up notification categories with platform-specific action buttons.
 *
 * Categories:
 * - permission_request: Approve / Deny buttons
 * - user_input_required: Open / Reply (with text input)
 * - task_complete: View button
 * - error: View Error button
 */
export async function setupNotificationCategories() {
  await Notifications.setNotificationCategoryAsync('permission_request', [
    {
      identifier: 'approve',
      buttonTitle: 'Approve',
      options: {
        opensAppToForeground: false,
      },
    },
    {
      identifier: 'deny',
      buttonTitle: 'Deny',
      options: {
        opensAppToForeground: false,
        isDestructive: true,
      },
    },
  ]);

  await Notifications.setNotificationCategoryAsync('user_input_required', [
    {
      identifier: 'open',
      buttonTitle: 'Open',
      options: {
        opensAppToForeground: true,
      },
    },
    {
      identifier: 'reply',
      buttonTitle: 'Reply',
      textInput: {
        submitButtonTitle: 'Send',
        placeholder: 'Type your response...',
      },
      options: {
        opensAppToForeground: false,
      },
    },
  ]);

  await Notifications.setNotificationCategoryAsync('task_complete', [
    {
      identifier: 'view',
      buttonTitle: 'View',
      options: {
        opensAppToForeground: true,
      },
    },
  ]);

  await Notifications.setNotificationCategoryAsync('error', [
    {
      identifier: 'view_error',
      buttonTitle: 'View Error',
      options: {
        opensAppToForeground: true,
      },
    },
  ]);
}

// ─── Android Channels ────────────────────────────────────────────────────────

export async function setupAndroidChannels() {
  if (Platform.OS !== 'android') return;

  for (const channel of Object.values(ANDROID_CHANNELS)) {
    await Notifications.setNotificationChannelAsync(channel.id, {
      name: channel.name,
      description: channel.description,
      importance: channel.importance,
      vibrationPattern: 'vibrationPattern' in channel ? channel.vibrationPattern as number[] : undefined,
      lightColor: channel.lightColor,
      sound: 'sound' in channel ? (channel.sound as string) : undefined,
      enableLights: true,
      enableVibrate: channel.importance >= Notifications.AndroidImportance.DEFAULT,
    });
  }
}

// ─── Foreground Behavior ─────────────────────────────────────────────────────

export function setupForegroundHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const data = notification.request.content.data;
      const type = data?.type as string;
      const priority = data?.priority as string;

      // Always show high-priority notifications even in foreground
      const shouldShow =
        priority === 'high' ||
        type === 'permission_request' ||
        type === 'user_input_required';

      return {
        shouldShowAlert: shouldShow,
        shouldPlaySound: shouldShow,
        shouldSetBadge: true,
        priority: shouldShow
          ? Notifications.AndroidNotificationPriority.HIGH
          : Notifications.AndroidNotificationPriority.DEFAULT,
      };
    },
  });
}

// ─── Background Task ─────────────────────────────────────────────────────────

TaskManager.defineTask(BACKGROUND_NOTIFICATION_TASK, async ({ data, error }) => {
  if (error) {
    console.error('Background notification task error:', error);
    return;
  }

  // The notification data from FCM is passed here when app is killed
  // expo-notifications handles most of this automatically, but we can
  // add custom processing here if needed
  const notificationData = data as {
    notification?: {
      data?: Record<string, string>;
    };
  };

  if (notificationData?.notification?.data) {
    const { notificationId, action } = notificationData.notification.data;
    if (notificationId && action) {
      try {
        await api.respondToNotification(notificationId, { action });
      } catch (e) {
        console.error('Failed to respond to notification in background:', e);
      }
    }
  }
});

// ─── Token Registration ──────────────────────────────────────────────────────

export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    console.warn('Push notifications require a physical device');
    return null;
  }

  const { status: existingStatus } =
    await Notifications.getPermissionsAsync();

  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    return null;
  }

  // Get the Expo push token (works with FCM on Android)
  const tokenData = await Notifications.getExpoPushTokenAsync({
    projectId: undefined, // Will use the EAS project ID from app.json
  });

  const token = tokenData.data;
  const platform = Platform.OS === 'android' ? 'android' : 'ios';
  const deviceName = `${Device.brand ?? 'Unknown'} ${Device.modelName ?? 'Device'}`;

  // Register token with backend
  await api.registerFCM(token, deviceName, platform);

  return token;
}

export async function unregisterPushToken(token: string) {
  try {
    await api.unregisterFCM(token);
  } catch (e) {
    console.error('Failed to unregister push token:', e);
  }
}

// ─── Notification Response Handler ───────────────────────────────────────────

/**
 * Handle user responses to notification actions.
 * Called when user taps an action button or submits an inline reply.
 */
export async function handleNotificationResponse(
  response: Notifications.NotificationResponse
) {
  const { actionIdentifier, userText } = response;
  const data = response.notification.request.content.data;
  const notificationId = data?.notificationId as string;
  const sessionId = data?.sessionId as string;
  const type = data?.type as string;

  // User tapped the notification body (not an action button)
  if (actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {
    // Navigate to session - handled by the navigation listener
    return { navigate: true, sessionId };
  }

  // Handle action button responses
  if (notificationId) {
    try {
      switch (actionIdentifier) {
        case 'approve':
          await api.respondToNotification(notificationId, { action: 'approve' });
          break;

        case 'deny':
          await api.respondToNotification(notificationId, { action: 'deny' });
          break;

        case 'reply':
          if (userText) {
            await api.respondToNotification(notificationId, {
              action: 'reply',
              text: userText,
            });
          }
          break;

        case 'view':
        case 'view_error':
          return { navigate: true, sessionId };

        default:
          await api.respondToNotification(notificationId, {
            action: actionIdentifier,
          });
      }
    } catch (e) {
      console.error('Failed to handle notification response:', e);
    }
  }

  return { navigate: false };
}

// ─── Full Initialization ─────────────────────────────────────────────────────

export async function initializeNotifications() {
  // Set up Android notification channels
  await setupAndroidChannels();

  // Set up notification categories with action buttons
  await setupNotificationCategories();

  // Configure foreground notification behavior
  setupForegroundHandler();

  // Register background task
  if (Platform.OS === 'android') {
    await Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK);
  }
}
