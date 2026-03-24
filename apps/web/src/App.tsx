import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './contexts/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { LoginPage } from './pages/LoginPage'
import { HouseholdsPage } from './pages/HouseholdsPage'
import { HouseholdPage } from './pages/HouseholdPage'
import { AdminUsersPage } from './pages/admin/UsersPage'
import { HouseholdsAdminPage } from './pages/admin/HouseholdsAdminPage'
import { CategoriesPage } from './pages/CategoriesPage'
import { CategoriesAdminPage } from './pages/admin/CategoriesAdminPage'

const queryClient = new QueryClient()

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <HouseholdsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/households/:id"
              element={
                <ProtectedRoute>
                  <HouseholdPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/users"
              element={
                <ProtectedRoute requireAdmin>
                  <AdminUsersPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/households"
              element={
                <ProtectedRoute requireAdmin>
                  <HouseholdsAdminPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/households/:id/categories"
              element={
                <ProtectedRoute>
                  <CategoriesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/categories"
              element={
                <ProtectedRoute requireAdmin>
                  <CategoriesAdminPage />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}

export default App
