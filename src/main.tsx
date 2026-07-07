import { StrictMode, Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'

import { queryClient } from '@/lib/queryClient'
import { router } from '@/router'
import './index.css'
// KaTeX styles power math rendering in chat and notebook answers.
// Imported once globally so the rendered formulas have the right
// fonts + spacing across every markdown surface.
import 'katex/dist/katex.min.css'

if (typeof window !== 'undefined') {
  // Use a slight delay to ensure we run after Vite and React DevTools have printed their initial logs
  setTimeout(() => {
    console.clear()
    
    // Silence casual logging but keep console.error active for bug reporting
    console.log = () => {}
    console.info = () => {}
    console.debug = () => {}
    console.warn = () => {}
  }, 1000)
}

/**
 * Simple class-based ErrorBoundary that catches unhandled render errors and
 * displays a fallback UI with a reload button. Prevents the entire app from
 * white-screening on unexpected runtime exceptions.
 */
class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            {this.state.error?.message ?? 'An unexpected error occurred.'}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)
