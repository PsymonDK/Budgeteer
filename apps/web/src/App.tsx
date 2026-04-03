import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { AuthProvider } from './contexts/AuthContext'
import { HouseholdProvider } from './contexts/HouseholdContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { LoginPage } from './pages/LoginPage'
import { UserDashboardPage } from './pages/UserDashboardPage'
import { HouseholdPage } from './pages/HouseholdPage'
import { DashboardPage } from './pages/DashboardPage'
import { AdminUsersPage } from './pages/admin/UsersPage'
import { HouseholdsAdminPage } from './pages/admin/HouseholdsAdminPage'
import { CategoriesPage } from './pages/CategoriesPage'
import { CategoriesAdminPage } from './pages/admin/CategoriesAdminPage'
import { CurrenciesAdminPage } from './pages/admin/CurrenciesAdminPage'
import { AutomationsAdminPage } from './pages/admin/AutomationsAdminPage'
import { ForbiddenPage } from './pages/ForbiddenPage'
import { ExpensesPage } from './pages/ExpensesPage'
import { IncomePage } from './pages/IncomePage'
import { HouseholdIncomePage } from './pages/HouseholdIncomePage'
import { BudgetYearsPage } from './pages/BudgetYearsPage'
import { ComparePage } from './pages/ComparePage'
import { SavingsPage } from './pages/SavingsPage'
import { HistoryPage } from './pages/HistoryPage'
import { ChangePasswordPage } from './pages/ChangePasswordPage'
import { ProfilePage } from './pages/ProfilePage'
import { NotFoundPage } from './pages/NotFoundPage'
import { HouseholdLayout } from './layouts/HouseholdLayout'
import { GlobalLayout } from './layouts/GlobalLayout'
import { AdminLayout } from './layouts/AdminLayout'

const queryClient = new QueryClient()

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <HouseholdProvider>
          <Toaster theme="dark" richColors position="top-right" />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/households/:id"
              element={
                <ProtectedRoute>
                  <HouseholdLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<DashboardPage />} />
              <Route path="income" element={<HouseholdIncomePage />} />
              <Route path="savings" element={<SavingsPage />} />
              <Route path="expenses" element={<ExpensesPage />} />
              <Route path="categories" element={<CategoriesPage />} />
              <Route path="budget-years" element={<BudgetYearsPage />} />
              <Route path="history" element={<HistoryPage />} />
              <Route path="compare" element={<ComparePage />} />
              <Route path="settings" element={<HouseholdPage />} />
            </Route>
            {/* Admin routes — shared AdminLayout */}
            <Route
              path="/admin"
              element={
                <ProtectedRoute requireAdmin>
                  <AdminLayout />
                </ProtectedRoute>
              }
            >
              <Route path="users" element={<AdminUsersPage />} />
              <Route path="households" element={<HouseholdsAdminPage />} />
              <Route path="currencies" element={<CurrenciesAdminPage />} />
              <Route path="categories" element={<CategoriesAdminPage />} />
              <Route path="automations" element={<AutomationsAdminPage />} />
            </Route>

            {/* Standalone personal routes — shared GlobalLayout */}
            <Route
              element={
                <ProtectedRoute>
                  <GlobalLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<UserDashboardPage />} />
              <Route path="/income" element={<IncomePage />} />
              <Route path="/change-password" element={<ChangePasswordPage />} />
              <Route path="/profile" element={<ProfilePage />} />
            </Route>

            <Route path="/403" element={<ForbiddenPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
          </HouseholdProvider>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}

export default App
