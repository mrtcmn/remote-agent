/**
 * Notification Inbox - slide-up modal with notification list.
 * Mirrors web NotificationInbox.tsx with mobile adaptations.
 *
 * Features:
 * - Notification list with type indicators
 * - Action buttons per notification (approve/deny, reply)
 * - Inline text reply input
 * - Mark all read
 * - Navigate to session on tap
 * - Pull-to-refresh
 */
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Modal,
  TextInput,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, fontSize, borderRadius, shadows } from '../lib/theme';
import { formatRelativeTime } from '../lib/format';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { useNotificationInbox } from '../hooks/useNotifications';
import { useNotificationStore } from '../stores/notifications';
import type { NotificationRecord } from '../types';

interface NotificationInboxProps {
  visible: boolean;
  onClose: () => void;
  onNavigateToSession: (sessionId: string) => void;
}

function NotificationTypeIcon({ type }: { type: string }) {
  switch (type) {
    case 'permission_request':
      return <Ionicons name="shield-checkmark" size={18} color={colors.statusWaiting} />;
    case 'user_input_required':
      return <Ionicons name="chatbubble-ellipses" size={18} color={colors.indigo} />;
    case 'task_complete':
      return <Ionicons name="checkmark-circle" size={18} color={colors.statusActive} />;
    case 'error':
      return <Ionicons name="alert-circle" size={18} color={colors.destructive} />;
    default:
      return <Ionicons name="notifications" size={18} color={colors.mutedForeground} />;
  }
}

function NotificationItem({
  notification,
  onPress,
  onAction,
}: {
  notification: NotificationRecord;
  onPress: () => void;
  onAction: (action: string, text?: string) => void;
}) {
  const [replyText, setReplyText] = useState('');
  const [showReply, setShowReply] = useState(false);
  const isUnread = notification.status === 'pending' || notification.status === 'sent';

  return (
    <TouchableOpacity
      style={[styles.notificationItem, isUnread && styles.unreadItem]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.notificationHeader}>
        <NotificationTypeIcon type={notification.type} />
        <View style={styles.notificationContent}>
          {notification.metadata?.projectName && (
            <Badge variant="secondary" style={styles.projectBadge}>
              {notification.metadata.projectName}
            </Badge>
          )}
          <Text style={styles.notificationTitle} numberOfLines={1}>
            {notification.title}
          </Text>
          <Text style={styles.notificationBody} numberOfLines={2}>
            {notification.body}
          </Text>
          <View style={styles.notificationMeta}>
            <Text style={styles.timeText}>
              {formatRelativeTime(notification.createdAt)}
            </Text>
            {notification.metadata?.stopReason &&
              notification.metadata.stopReason !== 'end_turn' && (
                <Badge variant="outline">
                  {String(notification.metadata.stopReason)}
                </Badge>
              )}
          </View>
        </View>
        {isUnread && <View style={styles.unreadDot} />}
      </View>

      {/* Action buttons for actionable notifications */}
      {notification.status !== 'resolved' && notification.status !== 'dismissed' && (
        <View style={styles.actions}>
          {notification.type === 'permission_request' && (
            <>
              <Button
                variant="default"
                size="sm"
                onPress={() => onAction('approve')}
              >
                Approve
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onPress={() => onAction('deny')}
              >
                Deny
              </Button>
            </>
          )}
          {notification.type === 'user_input_required' && (
            <>
              <Button
                variant="secondary"
                size="sm"
                onPress={() => setShowReply(!showReply)}
              >
                {showReply ? 'Cancel' : 'Reply'}
              </Button>
            </>
          )}
        </View>
      )}

      {/* Inline reply input */}
      {showReply && (
        <View style={styles.replyContainer}>
          <TextInput
            style={styles.replyInput}
            value={replyText}
            onChangeText={setReplyText}
            placeholder="Type your response..."
            placeholderTextColor={colors.mutedForeground}
            multiline
            autoFocus
          />
          <Button
            variant="default"
            size="sm"
            disabled={!replyText.trim()}
            onPress={() => {
              onAction('reply', replyText.trim());
              setReplyText('');
              setShowReply(false);
            }}
          >
            Send
          </Button>
        </View>
      )}
    </TouchableOpacity>
  );
}

export function NotificationInbox({
  visible,
  onClose,
  onNavigateToSession,
}: NotificationInboxProps) {
  const { notifications, isLoading, refetch, markRead, markAllRead, respond } =
    useNotificationInbox({ limit: 30 });
  const { setUnreadCount } = useNotificationStore();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const handleMarkAllRead = useCallback(async () => {
    const unreadIds = notifications
      .filter((n) => n.status === 'pending' || n.status === 'sent')
      .map((n) => n.id);
    if (unreadIds.length > 0) {
      await markAllRead(unreadIds);
      setUnreadCount(0);
    }
  }, [notifications, markAllRead]);

  const handleNotificationPress = useCallback(
    async (notification: NotificationRecord) => {
      if (notification.status === 'pending' || notification.status === 'sent') {
        await markRead(notification.id);
      }
      if (notification.sessionId) {
        onNavigateToSession(notification.sessionId);
        onClose();
      }
    },
    [markRead, onNavigateToSession, onClose]
  );

  const handleAction = useCallback(
    async (notification: NotificationRecord, action: string, text?: string) => {
      await respond({ id: notification.id, action, text });
    },
    [respond]
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Notifications</Text>
          <View style={styles.headerActions}>
            <TouchableOpacity onPress={handleMarkAllRead}>
              <Text style={styles.markAllRead}>Mark all read</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Ionicons name="close" size={24} color={colors.foreground} />
            </TouchableOpacity>
          </View>
        </View>

        {/* List */}
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <NotificationItem
              notification={item}
              onPress={() => handleNotificationPress(item)}
              onAction={(action, text) => handleAction(item, action, text)}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          contentContainerStyle={
            notifications.length === 0 ? styles.emptyContainer : undefined
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons
                name="notifications-off-outline"
                size={48}
                color={colors.mutedForeground}
              />
              <Text style={styles.emptyText}>No notifications</Text>
            </View>
          }
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Bell Icon with Badge ────────────────────────────────────────────────────

export function NotificationBell({
  onPress,
}: {
  onPress: () => void;
}) {
  const { unreadCount } = useNotificationStore();

  return (
    <TouchableOpacity onPress={onPress} style={styles.bellContainer}>
      <Ionicons name="notifications-outline" size={24} color={colors.foreground} />
      {unreadCount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: '600',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  markAllRead: {
    color: colors.primary,
    fontSize: fontSize.sm,
  },
  closeButton: {
    padding: spacing.xs,
  },
  notificationItem: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  unreadItem: {
    backgroundColor: 'rgba(99, 102, 241, 0.05)',
  },
  notificationHeader: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  notificationContent: {
    flex: 1,
    gap: 4,
  },
  projectBadge: {
    marginBottom: 2,
  },
  notificationTitle: {
    color: colors.foreground,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  notificationBody: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  notificationMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 4,
  },
  timeText: {
    color: colors.mutedForeground,
    fontSize: fontSize.xs,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.indigo,
    marginTop: 6,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    marginLeft: 30, // align with content
  },
  replyContainer: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    marginLeft: 30,
    alignItems: 'flex-end',
  },
  replyInput: {
    flex: 1,
    backgroundColor: colors.secondary,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.foreground,
    fontSize: fontSize.sm,
    maxHeight: 80,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing['4xl'],
  },
  emptyText: {
    color: colors.mutedForeground,
    fontSize: fontSize.base,
  },
  // Bell
  bellContainer: {
    position: 'relative',
    padding: spacing.xs,
  },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.destructive,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: colors.white,
    fontSize: 10,
    fontWeight: '700',
  },
});
