/**
 * Login screen - Email/password + GitHub OAuth.
 * Mirrors web Login.tsx adapted for React Native.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/Card';
import { colors, spacing, fontSize } from '../lib/theme';
import { getBaseUrl, saveAuthCookie } from '../lib/api';

interface LoginScreenProps {
  onLogin: () => void;
  onSetServerUrl: (url: string) => void;
  serverUrl: string;
}

export function LoginScreen({ onLogin, onSetServerUrl, serverUrl }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [serverInput, setServerInput] = useState(serverUrl);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showServer, setShowServer] = useState(!serverUrl);

  const handleServerSave = () => {
    const url = serverInput.trim().replace(/\/$/, '');
    if (!url) {
      setError('Server URL is required');
      return;
    }
    onSetServerUrl(url);
    setShowServer(false);
    setError('');
  };

  const handleEmailLogin = async () => {
    if (!email || !password) {
      setError('Email and password are required');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch(`${getBaseUrl()}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        throw new Error('Invalid credentials');
      }

      // Extract and save session cookie
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) {
        await saveAuthCookie(setCookie);
      }

      onLogin();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGitHubLogin = async () => {
    setLoading(true);
    setError('');

    try {
      const callbackUrl = `${getBaseUrl()}/api/auth/callback/github`;
      const authUrl = `${getBaseUrl()}/api/auth/sign-in/social?provider=github&callbackURL=${encodeURIComponent(callbackUrl)}`;

      const result = await WebBrowser.openAuthSessionAsync(
        authUrl,
        'remote-agent://auth/callback'
      );

      if (result.type === 'success' && result.url) {
        // Extract session cookie from callback URL or stored cookies
        const url = new URL(result.url);
        const token = url.searchParams.get('token');
        if (token) {
          await saveAuthCookie(token);
        }
        onLogin();
      }
    } catch (e) {
      setError('GitHub login failed');
    } finally {
      setLoading(false);
    }
  };

  if (showServer) {
    return (
      <View style={styles.container}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.content}
        >
          <View style={styles.logoContainer}>
            <Ionicons name="terminal" size={48} color={colors.primary} />
            <Text style={styles.title}>Remote Agent</Text>
            <Text style={styles.subtitle}>Connect to your server</Text>
          </View>

          <Card>
            <CardHeader>
              <CardTitle>Server URL</CardTitle>
              <CardDescription>
                Enter the URL of your Remote Agent server
              </CardDescription>
            </CardHeader>
            <CardContent>
              <View style={styles.form}>
                <Input
                  placeholder="https://your-server.example.com"
                  value={serverInput}
                  onChangeText={setServerInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <Button onPress={handleServerSave}>Connect</Button>
              </View>
            </CardContent>
          </Card>
        </KeyboardAvoidingView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.content}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.logoContainer}>
            <Ionicons name="terminal" size={48} color={colors.primary} />
            <Text style={styles.title}>Remote Agent</Text>
            <Text style={styles.subtitle}>Sign in to continue</Text>
            <Text style={styles.serverText}>
              {serverUrl}{' '}
              <Text
                style={styles.changeServer}
                onPress={() => setShowServer(true)}
              >
                Change
              </Text>
            </Text>
          </View>

          <Card>
            <CardContent style={styles.cardContent}>
              <View style={styles.form}>
                {/* GitHub OAuth */}
                <Button
                  variant="outline"
                  onPress={handleGitHubLogin}
                  loading={loading}
                >
                  <View style={styles.githubButton}>
                    <Ionicons name="logo-github" size={20} color={colors.foreground} />
                    <Text style={styles.githubText}>Continue with GitHub</Text>
                  </View>
                </Button>

                <View style={styles.divider}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>or</Text>
                  <View style={styles.dividerLine} />
                </View>

                {/* Email / Password */}
                <Input
                  label="Email"
                  placeholder="you@example.com"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                />

                <Input
                  label="Password"
                  placeholder="Enter password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  textContentType="password"
                />

                {error ? <Text style={styles.error}>{error}</Text> : null}

                <Button onPress={handleEmailLogin} loading={loading}>
                  Sign In
                </Button>
              </View>
            </CardContent>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing['3xl'],
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: spacing['3xl'],
    gap: spacing.sm,
  },
  title: {
    color: colors.foreground,
    fontSize: fontSize['2xl'],
    fontWeight: '700',
  },
  subtitle: {
    color: colors.mutedForeground,
    fontSize: fontSize.base,
  },
  serverText: {
    color: colors.mutedForeground,
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
  },
  changeServer: {
    color: colors.primary,
    textDecorationLine: 'underline',
  },
  cardContent: {
    paddingTop: spacing.lg,
  },
  form: {
    gap: spacing.lg,
  },
  githubButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  githubText: {
    color: colors.foreground,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
  },
  error: {
    color: colors.destructive,
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
});
