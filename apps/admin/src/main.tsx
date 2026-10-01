import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource/jetbrains-mono/400.css';
import './styles.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter, Navigate } from 'react-router';
import { Layout } from './Layout.js';
import { AuditPage } from './pages/AuditPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { GrievancesPage } from './pages/GrievancesPage.js';
import { LegalPage } from './pages/LegalPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { LookupPage } from './pages/LookupPage.js';
import { ReportsPage } from './pages/ReportsPage.js';

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <Layout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'reports', element: <ReportsPage /> },
      { path: 'lookup', element: <LookupPage /> },
      { path: 'grievances', element: <GrievancesPage /> },
      { path: 'legal', element: <LegalPage /> },
      { path: 'audit', element: <AuditPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);

const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 10_000 } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
