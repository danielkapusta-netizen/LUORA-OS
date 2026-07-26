import { QueryClient } from '@tanstack/react-query'

/**
 * Apps Script caches responses for five minutes, so a shorter stale time would
 * spend requests to receive identical bytes. Client cache is aligned to the
 * server's, and refetch-on-focus is off: this is a morning briefing tool, not a
 * live ticker, and flicker on tab-switch reads as instability.
 */
export const SERVER_CACHE_MS = 5 * 60 * 1000

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: SERVER_CACHE_MS,
      gcTime: 30 * 60 * 1000,
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      refetchOnWindowFocus: false,
    },
  },
})
