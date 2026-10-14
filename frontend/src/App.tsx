import type { ReactElement } from 'react';
import {
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { BrowserRouter } from 'react-router-dom';

import { AppShell } from './components/layout/AppShell';
import { AuthProvider, useAuth } from './features/auth/auth-context';
import { APIsPage } from './pages/APIsPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { MonitoringPage } from './pages/MonitoringPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { SettingsPage } from './pages/SettingsPage';

function PageLoader(): ReactElement {
  return <div className="page-state"><span className="loader" />Loading GateWatch...</div>;
}

function ProtectedLayout(): ReactElement {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <PageLoader />;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  return (
    <AppShell user={user}>
      <Outlet />
    </AppShell>
  );
}

function PublicLayout(): ReactElement {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <PageLoader />;
  }

  if (user) {
    const redirectTarget = (location.state as { from?: string } | null)?.from ?? '/dashboard';
    return <Navigate to={redirectTarget} replace />;
  }

  return <Outlet />;
}

function AppRoutes(): ReactElement {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>

      <Route element={<ProtectedLayout />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/apis" element={<APIsPage />} />
        <Route path="/monitoring" element={<MonitoringPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

function App(): ReactElement {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;