import { motion } from 'framer-motion'
import { Route, Routes, useLocation } from 'react-router-dom'

import { AppShell } from '@/app/app-shell'
import { ActionCentrePage } from '@/pages/action-centre'
import { BusinessReviewPage } from '@/pages/business-review'
import { OverviewPage } from '@/pages/overview'
import { PricingPage } from '@/pages/pricing'
import { ProductsPage } from '@/pages/products'
import { SettingsPage } from '@/pages/settings'
import { TransactionsPage } from '@/pages/transactions'
import { TrendsPage } from '@/pages/trends'
import { springSnappy } from '@/lib/motion'

/**
 * Page transitions are a short cross-fade with a few pixels of lift. Anything
 * longer makes navigation feel slower than it is. Keyed on pathname so the
 * animation re-runs per navigation.
 */
function PageTransition({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  return (
    <motion.div
      key={location.pathname}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springSnappy}
    >
      {children}
    </motion.div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route
          index
          element={
            <PageTransition>
              <OverviewPage />
            </PageTransition>
          }
        />
        <Route
          path="action-centre"
          element={
            <PageTransition>
              <ActionCentrePage />
            </PageTransition>
          }
        />
        <Route
          path="business-review"
          element={
            <PageTransition>
              <BusinessReviewPage />
            </PageTransition>
          }
        />
        <Route
          path="products"
          element={
            <PageTransition>
              <ProductsPage />
            </PageTransition>
          }
        />
        <Route
          path="pricing"
          element={
            <PageTransition>
              <PricingPage />
            </PageTransition>
          }
        />
        <Route
          path="trends"
          element={
            <PageTransition>
              <TrendsPage />
            </PageTransition>
          }
        />
        <Route
          path="transactions"
          element={
            <PageTransition>
              <TransactionsPage />
            </PageTransition>
          }
        />
        <Route
          path="settings"
          element={
            <PageTransition>
              <SettingsPage />
            </PageTransition>
          }
        />
        <Route
          path="*"
          element={
            <PageTransition>
              <OverviewPage />
            </PageTransition>
          }
        />
      </Route>
    </Routes>
  )
}
