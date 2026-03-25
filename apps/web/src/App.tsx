import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './contexts/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { LoginPage } from './pages/LoginPage'
import { HouseholdsPage } from './pages/HouseholdsPage'
import { HouseholdPage } from './pages/HouseholdPage'
import { DashboardPage } from './pages/DashboardPage'
import { AdminUsersPage } from './pages/admin/UsersPage'
import { HouseholdsAdminPage } from './pages/admin/HouseholdsAdminPage'
import { CategoriesPage } from './pages/CategoriesPage'
import { CategoriesAdminPage } from './pages/admin/CategoriesAdminPage'
import { ExpensesPage } from './pages/ExpensesPage'
import { IncomePage } from './pages/IncomePage'
import { HouseholdIncomePage } from './pages/HouseholdIncomePage'
import { BudgetYearsPage } from './pages/BudgetYearsPage'
import { ComparePage } from './pages/ComparePage'
import { SavingsPage } from './pages/SavingsPage'
import { HistoryPage } from './pages/HistoryPage'
import { ChangePasswordPage } from './pages/ChangePasswordPage'

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
                  <DashboardPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/households/:id/settings"
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
            <Route
              path="/households/:id/expenses"
              element={
                <ProtectedRoute>
                  <ExpensesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/income"
              element={
                <ProtectedRoute>
                  <IncomePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/households/:id/income"
              element={
                <ProtectedRoute>
                  <HouseholdIncomePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/households/:id/budget-years"
              element={
                <ProtectedRoute>
                  <BudgetYearsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/households/:id/compare"
              element={
                <ProtectedRoute>
                  <ComparePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/households/:id/history"
              element={
                <ProtectedRoute>
                  <HistoryPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/households/:id/savings"
              element={
                <ProtectedRoute>
                  <SavingsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/change-password"
              element={
                <ProtectedRoute>
                  <ChangePasswordPage />
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
