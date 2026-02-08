/**
 * Settings screen - Version, PIN, Notifications, SSH Keys.
 * Mirrors web Settings.tsx adapted for mobile with notification focus.
 */
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  Alert,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, fontSize, borderRadius, shadows } from '../lib/theme';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { useAuth } from '../hooks/useAuth';
import { useNotifications, useNotificationPreferences } from '../hooks/useNotifications';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export function SettingsScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.pageTitle}>Settings</Text>
      <VersionSection />
      <PinSection />
      <NotificationSection />
      <SSHKeysSection />
    </ScrollView>
  );
}

// ─── Version Section ─────────────────────────────────────────────────────────

function VersionSection() {
  const { data: version, isLoading, refetch } = useQuery({
    queryKey: ['version'],
    queryFn: () => api.getVersion(),
    staleTime: 4 * 60 * 60 * 1000,
  });

  const forceCheck = useMutation({
    mutationFn: () => api.getVersion(true),
    onSuccess: () => refetch(),
  });

  return (
    <Card style={styles.section}>
      <CardHeader>
        <View style={styles.sectionHeaderRow}>
          <Ionicons name="information-circle-outline" size={20} color={colors.primary} />
          <CardTitle>Version</CardTitle>
        </View>
      </CardHeader>
      <CardContent>
        <View style={styles.versionInfo}>
          <Text style={styles.label}>Current</Text>
          <Text style={styles.value}>{version?.current ?? '...'}</Text>
        </View>
        {version?.latest && (
          <View style={styles.versionInfo}>
            <Text style={styles.label}>Latest</Text>
            <View style={styles.row}>
              <Text style={styles.value}>{version.latest}</Text>
              {version.updateAvailable && (
                <Badge variant="warning">Update Available</Badge>
              )}
            </View>
          </View>
        )}
        <Button
          variant="outline"
          size="sm"
          onPress={() => forceCheck.mutate()}
          loading={forceCheck.isPending}
          style={styles.sectionButton}
        >
          Check Now
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── PIN Section ─────────────────────────────────────────────────────────────

function PinSection() {
  const { setPin } = useAuth();
  const [pin, setPinValue] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (pin.length < 4 || pin.length > 8) {
      Alert.alert('Error', 'PIN must be 4-8 digits');
      return;
    }
    if (pin !== confirmPin) {
      Alert.alert('Error', 'PINs do not match');
      return;
    }
    setSaving(true);
    try {
      await setPin(pin);
      Alert.alert('Success', 'PIN set');
      setPinValue('');
      setConfirmPin('');
    } catch {
      Alert.alert('Error', 'Failed to set PIN');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card style={styles.section}>
      <CardHeader>
        <View style={styles.sectionHeaderRow}>
          <Ionicons name="lock-closed-outline" size={20} color={colors.primary} />
          <CardTitle>Security PIN</CardTitle>
        </View>
        <CardDescription>
          Required for sensitive operations like deleting projects
        </CardDescription>
      </CardHeader>
      <CardContent>
        <View style={styles.form}>
          <Input
            label="PIN"
            placeholder="Enter 4-8 digit PIN"
            value={pin}
            onChangeText={setPinValue}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={8}
          />
          <Input
            label="Confirm PIN"
            placeholder="Re-enter PIN"
            value={confirmPin}
            onChangeText={setConfirmPin}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={8}
          />
          <Button
            onPress={handleSave}
            loading={saving}
            disabled={!pin || !confirmPin}
            size="sm"
          >
            Set PIN
          </Button>
        </View>
      </CardContent>
    </Card>
  );
}

// ─── Notification Section (Primary feature) ─────────────────────────────────

function NotificationSection() {
  const { pushToken, enableNotifications, isEnabling } = useNotifications();
  const {
    preferences,
    devices,
    isLoading,
    updatePreferences,
    testNotification,
    isTesting,
  } = useNotificationPreferences();

  const handleToggle = useCallback(
    async (key: 'notifyOnInput' | 'notifyOnError' | 'notifyOnComplete', value: boolean) => {
      try {
        await updatePreferences({ [key]: value });
      } catch {
        Alert.alert('Error', 'Failed to update preferences');
      }
    },
    [updatePreferences]
  );

  const handleTest = useCallback(async () => {
    try {
      await testNotification();
      Alert.alert('Success', 'Test notification sent');
    } catch {
      Alert.alert('Error', 'Failed to send test notification');
    }
  }, [testNotification]);

  return (
    <Card style={styles.section}>
      <CardHeader>
        <View style={styles.sectionHeaderRow}>
          <Ionicons name="notifications-outline" size={20} color={colors.primary} />
          <CardTitle>Notifications</CardTitle>
        </View>
        <CardDescription>
          Get push notifications when Claude needs your attention
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Registration Status */}
        {!pushToken ? (
          <View style={styles.notifStatus}>
            <View style={styles.statusRow}>
              <Ionicons name="alert-circle" size={18} color={colors.statusWaiting} />
              <Text style={styles.statusText}>
                Push notifications not enabled
              </Text>
            </View>
            <Button
              onPress={enableNotifications}
              loading={isEnabling}
              size="sm"
              style={styles.sectionButton}
            >
              Enable Notifications
            </Button>
          </View>
        ) : (
          <View style={styles.notifStatus}>
            <View style={styles.statusRow}>
              <Ionicons name="checkmark-circle" size={18} color={colors.statusActive} />
              <Text style={styles.statusText}>
                Push notifications enabled
              </Text>
            </View>
          </View>
        )}

        {/* Preferences */}
        {preferences && (
          <View style={styles.preferencesContainer}>
            <Text style={styles.preferencesTitle}>Notification Types</Text>

            <View style={styles.preferenceRow}>
              <View style={styles.preferenceInfo}>
                <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.indigo} />
                <View>
                  <Text style={styles.preferenceLabel}>Input Required</Text>
                  <Text style={styles.preferenceDesc}>
                    When Claude needs your response
                  </Text>
                </View>
              </View>
              <Switch
                value={preferences.notifyOnInput}
                onValueChange={(v) => handleToggle('notifyOnInput', v)}
                trackColor={{ false: colors.border, true: colors.primary + '80' }}
                thumbColor={preferences.notifyOnInput ? colors.primary : colors.mutedForeground}
              />
            </View>

            <View style={styles.preferenceRow}>
              <View style={styles.preferenceInfo}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.destructive} />
                <View>
                  <Text style={styles.preferenceLabel}>Errors</Text>
                  <Text style={styles.preferenceDesc}>
                    When an error occurs
                  </Text>
                </View>
              </View>
              <Switch
                value={preferences.notifyOnError}
                onValueChange={(v) => handleToggle('notifyOnError', v)}
                trackColor={{ false: colors.border, true: colors.primary + '80' }}
                thumbColor={preferences.notifyOnError ? colors.primary : colors.mutedForeground}
              />
            </View>

            <View style={styles.preferenceRow}>
              <View style={styles.preferenceInfo}>
                <Ionicons name="checkmark-circle-outline" size={18} color={colors.statusActive} />
                <View>
                  <Text style={styles.preferenceLabel}>Task Complete</Text>
                  <Text style={styles.preferenceDesc}>
                    When a task finishes
                  </Text>
                </View>
              </View>
              <Switch
                value={preferences.notifyOnComplete}
                onValueChange={(v) => handleToggle('notifyOnComplete', v)}
                trackColor={{ false: colors.border, true: colors.primary + '80' }}
                thumbColor={preferences.notifyOnComplete ? colors.primary : colors.mutedForeground}
              />
            </View>
          </View>
        )}

        {/* Registered Devices */}
        {devices.length > 0 && (
          <View style={styles.devicesContainer}>
            <Text style={styles.preferencesTitle}>Registered Devices</Text>
            {devices.map((device) => (
              <View key={device.id} style={styles.deviceRow}>
                <Ionicons
                  name={
                    device.platform === 'android'
                      ? 'phone-portrait-outline'
                      : device.platform === 'ios'
                      ? 'phone-portrait-outline'
                      : 'desktop-outline'
                  }
                  size={18}
                  color={colors.mutedForeground}
                />
                <View style={styles.deviceInfo}>
                  <Text style={styles.deviceName}>
                    {device.deviceName || 'Unknown Device'}
                  </Text>
                  <Badge variant="outline">{device.platform}</Badge>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Test */}
        <Button
          variant="outline"
          size="sm"
          onPress={handleTest}
          loading={isTesting}
          disabled={!pushToken}
          style={styles.sectionButton}
        >
          Send Test Notification
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── SSH Keys Section ────────────────────────────────────────────────────────

function SSHKeysSection() {
  const queryClient = useQueryClient();
  const { data: keys, isLoading } = useQuery({
    queryKey: ['ssh-keys'],
    queryFn: api.getSSHKeys,
  });

  const [showAdd, setShowAdd] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [privateKey, setPrivateKey] = useState('');

  const addMutation = useMutation({
    mutationFn: () => api.addSSHKey({ name: keyName, privateKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ssh-keys'] });
      setShowAdd(false);
      setKeyName('');
      setPrivateKey('');
      Alert.alert('Success', 'SSH key added');
    },
    onError: () => Alert.alert('Error', 'Failed to add SSH key'),
  });

  return (
    <Card style={styles.section}>
      <CardHeader>
        <View style={styles.sectionHeaderRow}>
          <Ionicons name="key-outline" size={20} color={colors.primary} />
          <CardTitle>SSH Keys</CardTitle>
        </View>
        <CardDescription>
          Manage SSH keys for git operations
        </CardDescription>
      </CardHeader>
      <CardContent>
        {keys && keys.length > 0 ? (
          <View style={styles.keyList}>
            {keys.map((key) => (
              <View key={key.id} style={styles.keyRow}>
                <Ionicons name="key" size={16} color={colors.mutedForeground} />
                <View style={styles.keyInfo}>
                  <Text style={styles.keyName}>{key.name || 'Unnamed'}</Text>
                  <Text style={styles.keyPreview} numberOfLines={1}>
                    {key.publicKey.slice(0, 40)}...
                  </Text>
                </View>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.emptyText}>No SSH keys configured</Text>
        )}

        {showAdd ? (
          <View style={styles.form}>
            <Input
              label="Key Name"
              placeholder="e.g., GitHub Key"
              value={keyName}
              onChangeText={setKeyName}
            />
            <Input
              label="Private Key"
              placeholder="Paste your private key..."
              value={privateKey}
              onChangeText={setPrivateKey}
              multiline
              numberOfLines={4}
              style={styles.textArea}
            />
            <View style={styles.formActions}>
              <Button
                variant="outline"
                size="sm"
                onPress={() => setShowAdd(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onPress={() => addMutation.mutate()}
                loading={addMutation.isPending}
                disabled={!privateKey}
              >
                Add Key
              </Button>
            </View>
          </View>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onPress={() => setShowAdd(true)}
            style={styles.sectionButton}
          >
            Add SSH Key
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing['4xl'],
    gap: spacing.lg,
  },
  pageTitle: {
    color: colors.foreground,
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  section: {
    marginBottom: 0,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sectionButton: {
    marginTop: spacing.md,
    alignSelf: 'flex-start',
  },
  // Version
  versionInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  label: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
  },
  value: {
    color: colors.foreground,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  // Form
  form: {
    gap: spacing.md,
    marginTop: spacing.md,
  },
  formActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  // Notifications
  notifStatus: {
    gap: spacing.sm,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusText: {
    color: colors.foreground,
    fontSize: fontSize.sm,
  },
  preferencesContainer: {
    marginTop: spacing.lg,
    gap: spacing.md,
  },
  preferencesTitle: {
    color: colors.foreground,
    fontSize: fontSize.sm,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  preferenceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  preferenceInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
  },
  preferenceLabel: {
    color: colors.foreground,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  preferenceDesc: {
    color: colors.mutedForeground,
    fontSize: fontSize.xs,
  },
  devicesContainer: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  deviceInfo: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  deviceName: {
    color: colors.foreground,
    fontSize: fontSize.sm,
  },
  // SSH Keys
  keyList: {
    gap: spacing.sm,
  },
  keyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  keyInfo: {
    flex: 1,
  },
  keyName: {
    color: colors.foreground,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  keyPreview: {
    color: colors.mutedForeground,
    fontSize: fontSize.xs,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  emptyText: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
  },
});
