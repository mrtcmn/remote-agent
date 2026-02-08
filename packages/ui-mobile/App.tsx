/**
 * Root App component.
 *
 * Navigation structure:
 * - Auth flow: Login → Server URL → Email/GitHub login
 * - Main flow: Tab navigator (Dashboard, Projects, Settings)
 *   - Stack: Dashboard → Session (push)
 *   - Stack: Projects → Session (push via create session)
 *
 * Global features:
 * - Push notification listeners (foreground, background, response)
 * - Notification inbox modal
 * - React Query provider
 * - Dark theme
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  StatusBar,
  View,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from 'react-native';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import * as SplashScreen from 'expo-splash-screen';

import { colors } from './src/lib/theme';
import { setBaseUrl, api } from './src/lib/api';
import { initializeNotifications, handleNotificationResponse } from './src/lib/notifications';
import { useAuthStore } from './src/stores/auth';
import { useNotificationStore } from './src/stores/notifications';

import { LoginScreen } from './src/screens/LoginScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { SessionScreen } from './src/screens/SessionScreen';
import { ProjectsScreen } from './src/screens/ProjectsScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { NotificationInbox, NotificationBell } from './src/components/NotificationInbox';

// Prevent splash screen from auto-hiding
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 30000,
    },
  },
});

// ─── Navigation Types ────────────────────────────────────────────────────────

type RootStackParamList = {
  Login: undefined;
  Main: undefined;
};

type MainTabParamList = {
  HomeTab: undefined;
  ProjectsTab: undefined;
  SettingsTab: undefined;
};

type HomeStackParamList = {
  Dashboard: undefined;
  Session: { sessionId: string };
};

type ProjectsStackParamList = {
  ProjectsList: undefined;
  ProjectSession: { sessionId: string };
};

const RootStack = createNativeStackNavigator<RootStackParamList>();
const MainTab = createBottomTabNavigator<MainTabParamList>();
const HomeStack = createNativeStackNavigator<HomeStackParamList>();
const ProjectsStack = createNativeStackNavigator<ProjectsStackParamList>();

// ─── Navigation Theme ────────────────────────────────────────────────────────

const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.primary,
    background: colors.background,
    card: colors.background,
    text: colors.foreground,
    border: colors.border,
    notification: colors.destructive,
  },
};

// ─── Stack Navigators ────────────────────────────────────────────────────────

function HomeStackNavigator() {
  return (
    <HomeStack.Navigator screenOptions={{ headerShown: false }}>
      <HomeStack.Screen name="Dashboard">
        {(props) => (
          <DashboardScreen
            onNavigateToSession={(sessionId) =>
              props.navigation.navigate('Session', { sessionId })
            }
          />
        )}
      </HomeStack.Screen>
      <HomeStack.Screen name="Session">
        {(props) => (
          <SessionScreen
            sessionId={props.route.params.sessionId}
            onBack={() => props.navigation.goBack()}
          />
        )}
      </HomeStack.Screen>
    </HomeStack.Navigator>
  );
}

function ProjectsStackNavigator() {
  return (
    <ProjectsStack.Navigator screenOptions={{ headerShown: false }}>
      <ProjectsStack.Screen name="ProjectsList">
        {(props) => (
          <ProjectsScreen
            onOpenProject={async (projectId) => {
              try {
                const session = await api.createSession(projectId);
                props.navigation.navigate('ProjectSession', {
                  sessionId: session.id,
                });
              } catch {
                // Error handled in component
              }
            }}
          />
        )}
      </ProjectsStack.Screen>
      <ProjectsStack.Screen name="ProjectSession">
        {(props) => (
          <SessionScreen
            sessionId={props.route.params.sessionId}
            onBack={() => props.navigation.goBack()}
          />
        )}
      </ProjectsStack.Screen>
    </ProjectsStack.Navigator>
  );
}

// ─── Main Tab Navigator ──────────────────────────────────────────────────────

function MainTabNavigator() {
  const [inboxVisible, setInboxVisible] = useState(false);
  const navigationRef = useRef<any>(null);

  return (
    <>
      <MainTab.Navigator
        screenOptions={{
          tabBarStyle: {
            backgroundColor: colors.background,
            borderTopColor: colors.border,
          },
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.mutedForeground,
          headerStyle: {
            backgroundColor: colors.background,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          } as any,
          headerTintColor: colors.foreground,
          headerRight: () => (
            <View style={styles.headerRight}>
              <NotificationBell onPress={() => setInboxVisible(true)} />
            </View>
          ),
        }}
      >
        <MainTab.Screen
          name="HomeTab"
          component={HomeStackNavigator}
          options={{
            title: 'Home',
            headerShown: false,
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="home-outline" size={size} color={color} />
            ),
          }}
        />
        <MainTab.Screen
          name="ProjectsTab"
          component={ProjectsStackNavigator}
          options={{
            title: 'Projects',
            headerShown: false,
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="folder-outline" size={size} color={color} />
            ),
          }}
        />
        <MainTab.Screen
          name="SettingsTab"
          component={SettingsScreen}
          options={{
            title: 'Settings',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="settings-outline" size={size} color={color} />
            ),
          }}
        />
      </MainTab.Navigator>

      <NotificationInbox
        visible={inboxVisible}
        onClose={() => setInboxVisible(false)}
        onNavigateToSession={(sessionId) => {
          setInboxVisible(false);
          // Navigate to session in Home tab
        }}
      />
    </>
  );
}

// ─── Root App ────────────────────────────────────────────────────────────────

function AppContent() {
  const { user, isLoading, setUser, setLoading, serverUrl, setServerUrl } =
    useAuthStore();
  const [initializing, setInitializing] = useState(true);

  // Load saved server URL and check auth on mount
  useEffect(() => {
    async function init() {
      try {
        const savedUrl = await SecureStore.getItemAsync('server_url');
        if (savedUrl) {
          setBaseUrl(savedUrl);
          setServerUrl(savedUrl);

          // Check if already authenticated
          try {
            const { user } = await api.getMe();
            if (user) {
              setUser(user);
            }
          } catch {
            // Not authenticated
          }
        }
      } finally {
        setInitializing(false);
        setLoading(false);
        SplashScreen.hideAsync();
      }
    }
    init();
  }, []);

  // Initialize notifications after auth
  useEffect(() => {
    if (user) {
      initializeNotifications();
    }
  }, [user]);

  // Handle notification response (app opened from notification)
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(
      async (response) => {
        await handleNotificationResponse(response);
      }
    );
    return () => subscription.remove();
  }, []);

  if (initializing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const handleLogin = async () => {
    try {
      const { user } = await api.getMe();
      setUser(user);
    } catch {
      // Login flow will handle errors
    }
  };

  const handleSetServerUrl = async (url: string) => {
    setBaseUrl(url);
    setServerUrl(url);
    await SecureStore.setItemAsync('server_url', url);
  };

  return (
    <RootStack.Navigator screenOptions={{ headerShown: false }}>
      {!user ? (
        <RootStack.Screen name="Login">
          {() => (
            <LoginScreen
              onLogin={handleLogin}
              onSetServerUrl={handleSetServerUrl}
              serverUrl={serverUrl}
            />
          )}
        </RootStack.Screen>
      ) : (
        <RootStack.Screen name="Main" component={MainTabNavigator} />
      )}
    </RootStack.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <NavigationContainer theme={navigationTheme}>
          <StatusBar
            barStyle="light-content"
            backgroundColor={colors.background}
          />
          <AppContent />
        </NavigationContainer>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  headerRight: {
    marginRight: 16,
  },
});
