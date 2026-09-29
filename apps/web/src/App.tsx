import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { AuthProvider } from './contexts/AuthContext'
import { HouseholdProvider } from './contexts/HouseholdContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { PageLoader } from './components/LoadingSpinner'
import { LoginPage } from './pages/LoginPage'
import { ForbiddenPage } from './pages/ForbiddenPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { HouseholdLayout } from './layouts/HouseholdLayout'
import { GlobalLayout } from './layouts/GlobalLayout'
import { AdminLayout } from './layouts/AdminLayout'

// Route pages load on demand (one chunk each) so the initial bundle only holds
// the shell: layouts, auth, login and the error pages.
function lazyNamed<M, K extends keyof M>(load: () => Promise<M>, name: K) {
  return lazy(() => load().then((m) => ({ default: m[name] as ComponentType })))
}

const UserDashboardPage = lazyNamed(() => import('./pages/user-dashboard/UserDashboardPage'), 'UserDashboardPage')
const HouseholdPage = lazyNamed(() => import('./pages/household/HouseholdPage'), 'HouseholdPage')
const TrashPage = lazyNamed(() => import('./pages/trash/TrashPage'), 'TrashPage')
const DashboardPage = lazyNamed(() => import('./pages/dashboard/DashboardPage'), 'DashboardPage')
const AdminUsersPage = lazyNamed(() => import('./pages/admin/UsersPage'), 'AdminUsersPage')
const HouseholdsAdminPage = lazyNamed(() => import('./pages/admin/HouseholdsAdminPage'), 'HouseholdsAdminPage')
const CategoriesPage = lazyNamed(() => import('./pages/CategoriesPage'), 'CategoriesPage')
const CategoriesAdminPage = lazyNamed(() => import('./pages/admin/CategoriesAdminPage'), 'CategoriesAdminPage')
const CurrenciesAdminPage = lazyNamed(() => import('./pages/admin/CurrenciesAdminPage'), 'CurrenciesAdminPage')
const AutomationsAdminPage = lazyNamed(() => import('./pages/admin/AutomationsAdminPage'), 'AutomationsAdminPage')
const ReceiptTrainingAdminPage = lazyNamed(() => import('./pages/admin/ReceiptTrainingAdminPage'), 'ReceiptTrainingAdminPage')
const ExpensesPage = lazyNamed(() => import('./pages/expenses/ExpensesPage'), 'ExpensesPage')
const IncomePage = lazyNamed(() => import('./pages/income/IncomePage'), 'IncomePage')
const HouseholdIncomePage = lazyNamed(() => import('./pages/HouseholdIncomePage'), 'HouseholdIncomePage')
const BudgetYearsPage = lazyNamed(() => import('./pages/budget-years/BudgetYearsPage'), 'BudgetYearsPage')
const ComparePage = lazyNamed(() => import('./pages/ComparePage'), 'ComparePage')
const SavingsPage = lazyNamed(() => import('./pages/savings/SavingsPage'), 'SavingsPage')
const NewReceiptPage = lazyNamed(() => import('./pages/receipts/NewReceiptPage'), 'NewReceiptPage')
const ReceiptsPage = lazyNamed(() => import('./pages/receipts/ReceiptsPage'), 'ReceiptsPage')
const HistoryPage = lazyNamed(() => import('./pages/HistoryPage'), 'HistoryPage')
const ChangePasswordPage = lazyNamed(() => import('./pages/ChangePasswordPage'), 'ChangePasswordPage')
const ProfilePage = lazyNamed(() => import('./pages/profile/ProfilePage'), 'ProfilePage')

/** Suspense boundary per route, inside the layout, so the header/sidebar stay put while a page chunk loads. */
function page(element: ReactNode) {
  return <Suspense fallback={<PageLoader />}>{element}</Suspense>
}

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
              <Route index element={page(<DashboardPage />)} />
              <Route path="income" element={page(<HouseholdIncomePage />)} />
              <Route path="savings" element={page(<SavingsPage />)} />
              <Route path="expenses" element={page(<ExpensesPage />)} />
              <Route path="receipts/new" element={page(<NewReceiptPage />)} />
              <Route path="receipts" element={page(<ReceiptsPage />)} />
              <Route path="categories" element={page(<CategoriesPage />)} />
              <Route path="budget-years" element={page(<BudgetYearsPage />)} />
              <Route path="history" element={page(<HistoryPage />)} />
              <Route path="compare" element={page(<ComparePage />)} />
              <Route path="settings" element={page(<HouseholdPage />)} />
              <Route path="trash" element={page(<TrashPage />)} />
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
              <Route path="users" element={page(<AdminUsersPage />)} />
              <Route path="households" element={page(<HouseholdsAdminPage />)} />
              <Route path="currencies" element={page(<CurrenciesAdminPage />)} />
              <Route path="categories" element={page(<CategoriesAdminPage />)} />
              <Route path="receipt-training" element={page(<ReceiptTrainingAdminPage />)} />
              <Route path="automations" element={page(<AutomationsAdminPage />)} />
            </Route>

            {/* Standalone personal routes — shared GlobalLayout */}
            <Route
              element={
                <ProtectedRoute>
                  <GlobalLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/" element={page(<UserDashboardPage />)} />
              <Route path="/income" element={page(<IncomePage />)} />
              <Route path="/change-password" element={page(<ChangePasswordPage />)} />
              <Route path="/profile" element={page(<ProfilePage />)} />
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
