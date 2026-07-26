import { AnimatePresence, motion } from 'framer-motion'
import { Route, Routes, useLocation } from 'react-router-dom'

import { AppShell } from '@/app/app-shell'
import { OverviewPage } from '@/pages/overview'
import {
  ActionCentrePage,
  BusinessReviewPage,
  ProductsPage,
  SettingsPage,
  TransactionsPage,
  TrendsPage,
} from '@/pages/placeholders'

/**
 * Page transitions are a short cross-fade with a few pixels of lift. Anything
 * longer makes navigation feel slower than it is.
 */
function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  )
}

export default function App() {
  const location = useLocation()

  return (
    <Routes location={location}>
      <Route element={<AppShell />}>
        <Route
          index
          element={
            <AnimatePresence mode="wait">
              <PageTransition key="overview">
                <OverviewPage />
              </PageTransition>
            </AnimatePresence>
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
