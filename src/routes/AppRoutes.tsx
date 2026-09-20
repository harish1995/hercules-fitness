import { Navigate, Route, Routes } from 'react-router-dom';
import { ROUTES } from '../constants/routes';
import { AppLayout } from '../layouts/AppLayout';
import { AuthLayout } from '../layouts/AuthLayout';
import { ForgotPasswordPage } from '../pages/auth/ForgotPasswordPage';
import { LoginPage } from '../pages/auth/LoginPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { AuthGate } from './AuthGate';
import { RequireAuth } from './RequireAuth';
import { RoleRoute } from './RequireRole';
import { APP_ROUTES } from './routeConfig';

export function AppRoutes() {
  return (
    <AuthGate>
      <Routes>
        {/* public */}
        <Route element={<AuthLayout />}>
          <Route path={ROUTES.login} element={<LoginPage />} />
          <Route path={ROUTES.forgotPassword} element={<ForgotPasswordPage />} />
        </Route>

        {/* protected: session required, then the app shell */}
        <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route index element={<Navigate to={ROUTES.dashboard} replace />} />
            {APP_ROUTES.map(({ path, allow, Component }) => (
              <Route
                key={path}
                path={path}
                element={
                  <RoleRoute allow={allow}>
                    <Component />
                  </RoleRoute>
                }
              />
            ))}
            {/* 404 inside the shell when signed in; signed-out visitors are redirected by RequireAuth */}
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Routes>
    </AuthGate>
  );
}
