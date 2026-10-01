import { Navigate, createBrowserRouter } from 'react-router';
import { RedirectIfAuthenticated, RequireAuth } from '../features/auth/components/RouteGuards.js';
import { ForgotPasswordPage } from '../features/auth/pages/ForgotPasswordPage.js';
import { LoginPage } from '../features/auth/pages/LoginPage.js';
import { SignupPage } from '../features/auth/pages/SignupPage.js';
import { VerifyOtpPage } from '../features/auth/pages/VerifyOtpPage.js';
import { BillingPage } from '../features/billing/pages/BillingPage.js';
import { InvoicePage } from '../features/billing/pages/InvoicePage.js';
import { CallsPage } from '../features/calls/pages/CallsPage.js';
import { InboxLayout } from '../features/chat/pages/InboxLayout.js';
import { GrievancePage } from '../features/legal/GrievancePage.js';
import { LegalPage } from '../features/legal/LegalPage.js';
import guidelines from '../content/guidelines.md?raw';
import privacy from '../content/privacy.md?raw';
import terms from '../content/terms.md?raw';
import { PublicNumberPage } from '../features/public/pages/PublicNumberPage.js';
import { RequestsPage } from '../features/requests/pages/RequestsPage.js';
import { AddNumberPage } from '../features/numbers/pages/AddNumberPage.js';
import { MyNumbersPage } from '../features/numbers/pages/MyNumbersPage.js';
import { NumberDetailPage } from '../features/numbers/pages/NumberDetailPage.js';
import { ProfilePage } from '../features/settings/pages/ProfilePage.js';
import { SettingsPage } from '../features/settings/pages/SettingsPage.js';
import { AppShell } from './layouts/AppShell.js';

export const router = createBrowserRouter([
  {
    path: '/login',
    children: [
      { index: true, element: <RedirectIfAuthenticated><LoginPage /></RedirectIfAuthenticated> },
      { path: 'verify', element: <RedirectIfAuthenticated><VerifyOtpPage /></RedirectIfAuthenticated> },
    ],
  },
  {
    path: '/signup',
    children: [
      { index: true, element: <RedirectIfAuthenticated><SignupPage /></RedirectIfAuthenticated> },
      { path: 'verify', element: <RedirectIfAuthenticated><VerifyOtpPage /></RedirectIfAuthenticated> },
    ],
  },
  { path: '/forgot-password', element: <RedirectIfAuthenticated><ForgotPasswordPage /></RedirectIfAuthenticated> },
  { path: '/terms', element: <LegalPage source={terms} /> },
  { path: '/privacy', element: <LegalPage source={privacy} /> },
  { path: '/guidelines', element: <LegalPage source={guidelines} /> },
  { path: '/grievance', element: <GrievancePage /> },
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="/numbers" replace /> },
      { path: 'inbox/requests', element: <RequestsPage /> },
      { path: 'inbox', element: <InboxLayout /> },
      { path: 'inbox/:conversationId', element: <InboxLayout /> },
      { path: 'inbox/:conversationId/settings', element: <InboxLayout /> },
      { path: 'numbers', element: <MyNumbersPage /> },
      { path: 'numbers/new', element: <AddNumberPage /> },
      { path: 'numbers/:id', element: <NumberDetailPage /> },
      { path: 'calls', element: <CallsPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'settings/profile', element: <ProfilePage /> },
      { path: 'settings/billing', element: <BillingPage /> },
      { path: 'settings/billing/invoices/:id', element: <InvoicePage /> },
    ],
  },
  // Public receiver entry: hellogram.app/A482719K (static routes above always win).
  { path: '/:code', element: <PublicNumberPage /> },
  { path: '*', element: <Navigate to="/numbers" replace /> },
]);
