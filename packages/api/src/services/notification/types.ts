export type NotificationType =
  | 'user_input_required'
  | 'permission_request'
  | 'task_complete'
  | 'error'
  | 'session_started'
  | 'session_ended';

export interface NotificationAction {
  label: string;
  action: string;
  data?: Record<string, unknown>;
}

export interface NotificationPayload {
  sessionId: string;
  terminalId?: string;
  projectName?: string;
  type: NotificationType;
  title: string;
  body: string;
  actions?: NotificationAction[];
  metadata?: Record<string, unknown>;
  priority?: 'low' | 'normal' | 'high';
}

export interface NotificationRecord {
  id: string;
  userId: string;
  sessionId: string;
  terminalId?: string | null;
  type: NotificationType;
  title: string;
  body: string;
  metadata?: Record<string, unknown> | null;
  actions?: NotificationAction[] | null;
  priority: 'low' | 'normal' | 'high';
  status: 'pending' | 'sent' | 'read' | 'resolved' | 'dismissed';
  resolvedAction?: string | null;
  resolvedAt?: Date | null;
  expiresAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateNotificationInput {
  userId: string;
  sessionId: string;
  terminalId?: string;
  type: NotificationType;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
  actions?: NotificationAction[];
  priority?: 'low' | 'normal' | 'high';
  expiresAt?: Date;
}

export interface NotificationAdapter {
  readonly name: string;

  /**
   * Send a notification to a user
   */
  send(userId: string, payload: NotificationPayload): Promise<boolean>;

  /**
   * Check if the adapter is properly configured for a user
   */
  isConfigured(userId: string): Promise<boolean>;

  /**
   * Initialize the adapter (called on startup)
   */
  initialize?(): Promise<void>;

  /**
   * Cleanup resources (called on shutdown)
   */
  shutdown?(): Promise<void>;
}

export interface AdapterConfig {
  firebase?: {
    projectId: string;
    privateKey: string;
    clientEmail: string;
  };
  email?: {
    host: string;
    port: number;
    user: string;
    password: string;
    from: string;
  };
  telegram?: {
    botToken: string;
  };
  webhook?: {
    defaultUrl?: string;
  };
}
