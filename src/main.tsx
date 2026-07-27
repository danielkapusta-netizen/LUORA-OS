import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import App from '@/App'
import { SnapshotProvider } from '@/hooks/use-snapshot'
import { queryClient } from '@/lib/query-client'
import './index.css'

const container = document.getElementById('root')
if (!container) throw new Error('Root element missing from index.html')

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SnapshotProvider>
          <App />
        </SnapshotProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
