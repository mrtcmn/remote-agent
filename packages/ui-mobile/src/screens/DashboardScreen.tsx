/**
 * Dashboard screen - Lists all sessions with status indicators.
 * Mirrors web Dashboard.tsx: active/recent separation, status colors, create/terminate.
 */
import React, { useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, fontSize, borderRadius, shadows } from '../lib/theme';
import { formatRelativeTime } from '../lib/format';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { useSessions } from '../hooks/useSessions';
import type { Session, SessionStatus } from '../types';

interface DashboardScreenProps {
  onNavigateToSession: (sessionId: string) => void;
}

function getStatusColor(status: SessionStatus): string {
  switch (status) {
    case 'active':
    case 'running':
      return colors.statusActive;
    case 'waiting_input':
      return colors.statusWaiting;
    case 'paused':
      return colors.statusPaused;
    case 'terminated':
      return colors.statusTerminated;
    default:
      return colors.mutedForeground;
  }
}

function getStatusLabel(status: SessionStatus): string {
  switch (status) {
    case 'active':
    case 'running':
      return 'Active';
    case 'waiting_input':
      return 'Waiting';
    case 'paused':
      return 'Paused';
    case 'terminated':
      return 'Ended';
    default:
      return status;
  }
}

function SessionCard({
  session,
  onPress,
  onTerminate,
}: {
  session: Session;
  onPress: () => void;
  onTerminate: () => void;
}) {
  const statusColor = getStatusColor(session.status);
  const isActive = session.status !== 'terminated';

  return (
    <TouchableOpacity
      style={styles.sessionCard}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.sessionHeader}>
        <View style={styles.sessionInfo}>
          <View style={styles.sessionTitleRow}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={styles.sessionName} numberOfLines={1}>
              {session.projectName || `Session`}
            </Text>
          </View>
          <Badge
            variant={isActive ? 'success' : 'secondary'}
            style={{ backgroundColor: statusColor + '20' }}
          >
            <Text style={{ color: statusColor, fontSize: 11, fontWeight: '500' }}>
              {getStatusLabel(session.status)}
            </Text>
          </Badge>
        </View>

        {isActive && (
          <TouchableOpacity
            onPress={(e) => {
              e.stopPropagation?.();
              onTerminate();
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="stop-circle-outline" size={22} color={colors.destructive} />
          </TouchableOpacity>
        )}
      </View>

      {session.lastMessage && (
        <Text style={styles.lastMessage} numberOfLines={2}>
          {session.lastMessage}
        </Text>
      )}

      <Text style={styles.timeText}>
        {session.lastActivityAt
          ? formatRelativeTime(session.lastActivityAt)
          : formatRelativeTime(session.createdAt)}
      </Text>
    </TouchableOpacity>
  );
}

export function DashboardScreen({ onNavigateToSession }: DashboardScreenProps) {
  const {
    sessions,
    isLoading,
    refetch,
    createSession,
    isCreating,
    terminateSession,
  } = useSessions();

  const { activeSessions, recentSessions } = useMemo(() => {
    const active = sessions.filter((s) => s.status !== 'terminated');
    const recent = sessions.filter((s) => s.status === 'terminated');
    return { activeSessions: active, recentSessions: recent.slice(0, 10) };
  }, [sessions]);

  const handleTerminate = useCallback(
    (session: Session) => {
      Alert.alert(
        'Terminate Session',
        `Are you sure you want to terminate "${session.projectName || 'this session'}"?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Terminate',
            style: 'destructive',
            onPress: () => terminateSession(session.id),
          },
        ]
      );
    },
    [terminateSession]
  );

  const handleCreate = useCallback(async () => {
    try {
      const session = await createSession();
      onNavigateToSession(session.id);
    } catch (e) {
      Alert.alert('Error', 'Failed to create session');
    }
  }, [createSession, onNavigateToSession]);

  const renderSection = (title: string, data: Session[]) => {
    if (data.length === 0) return null;
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {data.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            onPress={() => onNavigateToSession(session.id)}
            onTerminate={() => handleTerminate(session)}
          />
        ))}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Sessions</Text>
        <Button
          size="sm"
          onPress={handleCreate}
          loading={isCreating}
        >
          <View style={styles.createButton}>
            <Ionicons name="add" size={18} color={colors.primaryForeground} />
            <Text style={styles.createText}>New</Text>
          </View>
        </Button>
      </View>

      <FlatList
        data={[]}
        renderItem={() => null}
        ListHeaderComponent={
          <>
            {renderSection('Active', activeSessions)}
            {renderSection('Recent', recentSessions)}
            {sessions.length === 0 && !isLoading && (
              <View style={styles.emptyState}>
                <Ionicons name="terminal-outline" size={48} color={colors.mutedForeground} />
                <Text style={styles.emptyTitle}>No sessions yet</Text>
                <Text style={styles.emptyText}>
                  Create a new session to start working with Claude
                </Text>
                <Button onPress={handleCreate} loading={isCreating}>
                  Create Session
                </Button>
              </View>
            )}
          </>
        }
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={refetch}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        contentContainerStyle={styles.listContent}
      />
    </View>
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
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  createText: {
    color: colors.primaryForeground,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  listContent: {
    paddingBottom: spacing['4xl'],
  },
  section: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.sm,
  },
  sectionTitle: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  sessionCard: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.sm,
  },
  sessionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  sessionInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sessionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  sessionName: {
    color: colors.foreground,
    fontSize: fontSize.base,
    fontWeight: '600',
    flex: 1,
  },
  lastMessage: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  timeText: {
    color: colors.mutedForeground,
    fontSize: fontSize.xs,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing['4xl'],
    paddingHorizontal: spacing['2xl'],
    gap: spacing.md,
  },
  emptyTitle: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: '600',
  },
  emptyText: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
});
