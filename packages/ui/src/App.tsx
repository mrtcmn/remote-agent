import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { sessionPath } from './lib/session-route';
import { useAuth } from './hooks/useAuth';
import { Layout } from './components/Layout';
import { NotificationListener } from './components/NotificationListener';
import { LoginPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { SessionPage } from './pages/Session';
import { ProjectsPage } from './pages/Projects';
import { SettingsPage } from './pages/Settings';
import { KanbanPage } from './pages/Kanban';
import { SkillsPage } from './pages/Skills';
import { McpServersPage } from './pages/McpServers';
import { Toaster } from './components/ui/Toaster';
import { useAppTheme } from './hooks/useAppTheme';
import { isElectron } from './lib/electron';
import { useApiConfig } from './lib/api-config';
import { SetupScreen } from './components/SetupScreen';

/**
 * Redirect legacy bare session URLs (/sessions/:id) to the machine-scoped form,
 * defaulting to the local machine. Keeps old bookmarks working.
 */
function LegacySessionRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={sessionPath('self', id!)} replace />;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  useAppTheme();

  const { isConfigured, isLoading: isConfigLoading } = useApiConfig();

  // Electron: show setup screen if API URL not configured
  if (isElectron() && isConfigLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (isElectron() && !isConfigured) {
    return <SetupScreen />;
  }

  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <NotificationListener />
              <Layout>
                <Routes>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/sessions/:machineId/:id" element={<SessionPage />} />
                  <Route path="/sessions/:machineId/:id/:terminalId" element={<SessionPage />} />
                  {/* Legacy bare session URLs → default to the local machine */}
                  <Route path="/sessions/:id" element={<LegacySessionRedirect />} />
                  <Route path="/projects" element={<ProjectsPage />} />
                  <Route path="/kanban" element={<KanbanPage />} />
                  <Route path="/skills" element={<SkillsPage />} />
                  <Route path="/mcp-servers" element={<McpServersPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                </Routes>
              </Layout>
            </ProtectedRoute>
          }
        />
      </Routes>
      <Toaster />
    </>
  );
}
