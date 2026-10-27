import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AuthProvider, RequireAdmin, RequireAuth } from '@/auth.jsx';
import Layout from '@/components/Layout.jsx';
import LoginPage from '@/pages/LoginPage.jsx';
import SearchPage from '@/pages/SearchPage.jsx';
import AddFilePage from '@/pages/AddFilePage.jsx';
import AdminPage from '@/pages/AdminPage.jsx';
import AccountPage from '@/pages/AccountPage.jsx';
import BoxPage from '@/pages/BoxPage.jsx';
import LabelPage from '@/pages/LabelPage.jsx';
import NotFound from '@/pages/NotFound.jsx';
import PublicSearchPage from '@/pages/PublicSearchPage.jsx';
import '@/styles.css';

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  // Public file lookup, no sign-in needed.
  { path: '/find', element: <PublicSearchPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        path: '/',
        element: <Layout />,
        children: [
          { index: true, element: <SearchPage /> },
          { path: 'files/new', element: <AddFilePage /> },
          { path: 'boxes/:boxId', element: <BoxPage /> },
          { path: 'account', element: <AccountPage /> },
          { element: <RequireAdmin />, children: [{ path: 'admin', element: <AdminPage /> }] },
          { path: '*', element: <NotFound /> },
        ],
      },
      // Labels render outside the app shell so only the label prints.
      // Anyone can print file labels; the page itself limits box labels to admins.
      { path: '/labels', element: <LabelPage /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </React.StrictMode>
);
