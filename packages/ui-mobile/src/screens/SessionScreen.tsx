/**
 * Session screen - Terminal view with WebView-based xterm,
 * terminal selector, and action bar.
 * Mirrors web Session.tsx adapted for mobile.
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, fontSize, borderRadius } from '../lib/theme';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { useSession, useSessionTerminals } from '../hooks/useSessions';
import { getBaseUrl } from '../lib/api';
import * as SecureStore from 'expo-secure-store';
import type { TerminalInfo, TerminalType } from '../types';

interface SessionScreenProps {
  sessionId: string;
  onBack: () => void;
}

function TerminalTab({
  terminal,
  isActive,
  onPress,
  onClose,
}: {
  terminal: TerminalInfo;
  isActive: boolean;
  onPress: () => void;
  onClose: () => void;
}) {
  const isClaude = terminal.type === 'claude';
  return (
    <TouchableOpacity
      style={[styles.terminalTab, isActive && styles.terminalTabActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Ionicons
        name={isClaude ? 'hardware-chip-outline' : 'terminal-outline'}
        size={16}
        color={isActive ? colors.primary : colors.mutedForeground}
      />
      <Text
        style={[
          styles.terminalTabText,
          isActive && styles.terminalTabTextActive,
        ]}
        numberOfLines={1}
      >
        {terminal.title || (isClaude ? 'Claude' : 'Shell')}
      </Text>
      <View
        style={[
          styles.terminalStatusDot,
          {
            backgroundColor:
              terminal.status === 'running'
                ? colors.statusActive
                : terminal.status === 'exited'
                ? colors.statusTerminated
                : colors.statusPaused,
          },
        ]}
      />
      <TouchableOpacity
        onPress={(e) => {
          e.stopPropagation?.();
          onClose();
        }}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name="close" size={14} color={colors.mutedForeground} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

/**
 * WebView-based terminal component.
 * Uses xterm.js in a WebView connected to the backend WebSocket.
 */
function TerminalView({ terminalId }: { terminalId: string }) {
  const webViewRef = useRef<WebView>(null);
  const [cookie, setCookie] = useState<string | null>(null);

  useEffect(() => {
    SecureStore.getItemAsync('auth_session_cookie').then(setCookie);
  }, []);

  const base = getBaseUrl();
  const wsBase = base.replace(/^http/, 'ws');

  // Inject xterm.js terminal into WebView
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css">
  <script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@xterm/addon-web-links@0.11.0/lib/addon-web-links.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #1e1e1e; }
    #terminal { width: 100%; height: 100%; }
    .xterm { padding: 4px; }
  </style>
</head>
<body>
  <div id="terminal"></div>
  <script>
    const term = new Terminal({
      fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        selectionBackground: '#264f78',
        black: '#1e1e1e',
        red: '#f44747',
        green: '#6a9955',
        yellow: '#d7ba7d',
        blue: '#569cd6',
        magenta: '#c586c0',
        cyan: '#4ec9b0',
        white: '#d4d4d4',
        brightBlack: '#808080',
        brightRed: '#f44747',
        brightGreen: '#6a9955',
        brightYellow: '#d7ba7d',
        brightBlue: '#569cd6',
        brightMagenta: '#c586c0',
        brightCyan: '#4ec9b0',
        brightWhite: '#e5e5e5'
      }
    });

    const fitAddon = new FitAddon.FitAddon();
    const webLinksAddon = new WebLinksAddon.WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(document.getElementById('terminal'));
    fitAddon.fit();

    const wsUrl = '${wsBase}/ws/terminal/${terminalId}${cookie ? `?token=${encodeURIComponent(cookie)}` : ''}';
    let ws = null;
    let reconnectAttempts = 0;

    function connect() {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        reconnectAttempts = 0;
        ws.send(JSON.stringify({
          type: 'resize',
          payload: { cols: term.cols, rows: term.rows }
        }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'output' && msg.data) {
            term.write(atob(msg.data));
          } else if (msg.type === 'scrollback' && msg.data) {
            term.write(atob(msg.data));
          } else if (msg.type === 'exit') {
            term.write('\\r\\n[Process exited]\\r\\n');
          }
        } catch(e) {}
      };

      ws.onclose = () => {
        if (reconnectAttempts < 5) {
          reconnectAttempts++;
          setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => ws.close();
    }

    connect();

    term.onData((data) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'input',
          data: btoa(unescape(encodeURIComponent(data)))
        }));
      }
    });

    term.onResize(({ cols, rows }) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'resize',
          payload: { cols, rows }
        }));
      }
    });

    window.addEventListener('resize', () => fitAddon.fit());
    new ResizeObserver(() => fitAddon.fit()).observe(document.getElementById('terminal'));
  </script>
</body>
</html>`;

  return (
    <WebView
      ref={webViewRef}
      source={{ html }}
      style={styles.webview}
      javaScriptEnabled
      domStorageEnabled
      originWhitelist={['*']}
      allowsInlineMediaPlayback
      scrollEnabled={false}
      bounces={false}
      overScrollMode="never"
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
    />
  );
}

export function SessionScreen({ sessionId, onBack }: SessionScreenProps) {
  const { data: session } = useSession(sessionId);
  const { terminals, createTerminal, closeTerminal } = useSessionTerminals(sessionId);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);

  // Auto-select first terminal
  useEffect(() => {
    if (terminals.length > 0 && !activeTerminalId) {
      setActiveTerminalId(terminals[0].id);
    }
  }, [terminals, activeTerminalId]);

  const handleCreateTerminal = useCallback(
    async (type: TerminalType) => {
      try {
        const terminal = await createTerminal({
          sessionId,
          type,
        });
        setActiveTerminalId(terminal.id);
      } catch {
        Alert.alert('Error', 'Failed to create terminal');
      }
    },
    [sessionId, createTerminal]
  );

  const handleCloseTerminal = useCallback(
    async (terminalId: string) => {
      Alert.alert('Close Terminal', 'Are you sure?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close',
          style: 'destructive',
          onPress: async () => {
            await closeTerminal(terminalId);
            if (activeTerminalId === terminalId) {
              const remaining = terminals.filter((t) => t.id !== terminalId);
              setActiveTerminalId(remaining[0]?.id ?? null);
            }
          },
        },
      ]);
    },
    [closeTerminal, activeTerminalId, terminals]
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {session?.projectName || 'Session'}
        </Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={() => handleCreateTerminal('claude')}
            style={styles.headerAction}
          >
            <Ionicons name="hardware-chip-outline" size={20} color={colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => handleCreateTerminal('shell')}
            style={styles.headerAction}
          >
            <Ionicons name="terminal-outline" size={20} color={colors.foreground} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Terminal tabs */}
      {terminals.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabBar}
          contentContainerStyle={styles.tabBarContent}
        >
          {terminals.map((terminal) => (
            <TerminalTab
              key={terminal.id}
              terminal={terminal}
              isActive={terminal.id === activeTerminalId}
              onPress={() => setActiveTerminalId(terminal.id)}
              onClose={() => handleCloseTerminal(terminal.id)}
            />
          ))}
        </ScrollView>
      )}

      {/* Terminal content */}
      <View style={styles.terminalContainer}>
        {activeTerminalId ? (
          <TerminalView
            key={activeTerminalId}
            terminalId={activeTerminalId}
          />
        ) : (
          <View style={styles.emptyTerminal}>
            <Ionicons
              name="terminal-outline"
              size={48}
              color={colors.mutedForeground}
            />
            <Text style={styles.emptyText}>No terminal open</Text>
            <View style={styles.emptyActions}>
              <Button
                onPress={() => handleCreateTerminal('claude')}
                size="sm"
              >
                <View style={styles.createBtnContent}>
                  <Ionicons
                    name="hardware-chip-outline"
                    size={16}
                    color={colors.primaryForeground}
                  />
                  <Text style={styles.createBtnText}>Claude Terminal</Text>
                </View>
              </Button>
              <Button
                variant="secondary"
                onPress={() => handleCreateTerminal('shell')}
                size="sm"
              >
                <View style={styles.createBtnContent}>
                  <Ionicons
                    name="terminal-outline"
                    size={16}
                    color={colors.foreground}
                  />
                  <Text style={styles.createBtnTextSecondary}>Shell</Text>
                </View>
              </Button>
            </View>
          </View>
        )}
      </View>
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
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  backButton: {
    padding: spacing.xs,
  },
  headerTitle: {
    flex: 1,
    color: colors.foreground,
    fontSize: fontSize.base,
    fontWeight: '600',
  },
  headerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  headerAction: {
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: colors.secondary,
  },
  tabBar: {
    maxHeight: 40,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tabBarContent: {
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
    alignItems: 'center',
    paddingVertical: 4,
  },
  terminalTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: borderRadius.md,
    backgroundColor: colors.secondary,
  },
  terminalTabActive: {
    backgroundColor: colors.accent,
    borderWidth: 1,
    borderColor: colors.primary + '40',
  },
  terminalTabText: {
    color: colors.mutedForeground,
    fontSize: fontSize.xs,
    maxWidth: 80,
  },
  terminalTabTextActive: {
    color: colors.foreground,
  },
  terminalStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  terminalContainer: {
    flex: 1,
  },
  webview: {
    flex: 1,
    backgroundColor: '#1e1e1e',
  },
  emptyTerminal: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  emptyText: {
    color: colors.mutedForeground,
    fontSize: fontSize.base,
  },
  emptyActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  createBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  createBtnText: {
    color: colors.primaryForeground,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  createBtnTextSecondary: {
    color: colors.foreground,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
});
