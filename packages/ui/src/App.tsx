import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { Layout } from './components/Layout';
import { NotificationListener } from './components/NotificationListener';
import { LoginPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { SessionPage } from './pages/Session';
import { ProjectsPage } from './pages/Projects';
import { SettingsPage } from './pages/Settings';
import { KanbanPage } from './pages/Kanban';
import { Toaster } from './components/ui/Toaster';

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
                  <Route path="/sessions/:id" element={<SessionPage />} />
                  <Route path="/projects" element={<ProjectsPage />} />
                  <Route path="/kanban" element={<KanbanPage />} />
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
