import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { AuthProvider, RequireAuth, RequireManager } from '@/auth.jsx';
import { OfficeProvider } from '@/office.jsx';
import Layout from '@/components/Layout.jsx';
import LoginPage from '@/pages/LoginPage.jsx';
import SearchPage from '@/pages/SearchPage.jsx';
import SettingsPage from '@/pages/SettingsPage.jsx';
import LettersPage from '@/pages/LettersPage.jsx';
import LetterPage from '@/pages/LetterPage.jsx';
import AccountPage from '@/pages/AccountPage.jsx';
import BoxPage from '@/pages/BoxPage.jsx';
import LabelPage from '@/pages/LabelPage.jsx';
import NotFound from '@/pages/NotFound.jsx';
import PublicSearchPage from '@/pages/PublicSearchPage.jsx';
import '@/styles.css';

const router = createBrowserRouter([
  // There's no separate sign-in page any more: old /login links go home, which asks signed-out visitors to sign in.
  { path: '/login', element: <Navigate to="/" replace /> },
  // Public file lookup, no sign-in needed.
  { path: '/find', element: <PublicSearchPage /> },
  {
    element: <RequireAuth fallback={<LoginPage />} />,
    children: [
      {
        path: '/',
        element: <Layout />,
        children: [
          { index: true, element: <SearchPage /> },
          // Registering a file is now part of the Files page.
          { path: 'files/new', element: <Navigate to="/" replace /> },
          { path: 'boxes/:boxId', element: <BoxPage /> },
          { path: 'account', element: <AccountPage /> },
          { path: 'letters', element: <LettersPage /> },
          { path: 'letters/:letterId', element: <LetterPage /> },
          // Admin was renamed Settings; old links still work.
          { path: 'admin', element: <Navigate to="/settings" replace /> },
          { element: <RequireManager />, children: [{ path: 'settings/:section?', element: <SettingsPage /> }] },
          { path: '*', element: <NotFound /> },
        ],
      },
      // Labels render outside the app shell so only the label prints.
      // Anyone can print file labels; the page itself limits box labels to admins and office admins.
      { path: '/labels', element: <LabelPage /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <OfficeProvider>
        <RouterProvider router={router} />
      </OfficeProvider>
    </AuthProvider>
  </React.StrictMode>
);
