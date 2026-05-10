import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { RefreshCw, RotateCcw } from 'lucide-react'
import './ErrorBoundary.css'

type ErrorBoundaryProps = {
  children: ReactNode
}

type ErrorBoundaryState = {
  error: Error | null
  errorId: string
  hasError: boolean
}

const initialState: ErrorBoundaryState = {
  error: null,
  errorId: '',
  hasError: false,
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = initialState

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      error,
      errorId: createErrorId(),
      hasError: true,
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Essence UI crashed.', {
      error,
      errorInfo,
    })
  }

  reset = () => {
    this.setState(initialState)
  }

  reload = () => {
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    return (
      <main className="app-error-screen" role="alert">
        <section className="app-error-panel" aria-labelledby="app-error-title">
          <p className="app-error-panel__eyebrow">Essence recovered the page</p>
          <h1 id="app-error-title">Something interrupted the workspace.</h1>
          <p className="app-error-panel__copy">
            Your browser session is still here. Try reopening the workspace, or reload the app if the same view keeps
            failing.
          </p>

          {this.state.error?.message ? (
            <p className="app-error-panel__detail">
              <span>Error</span>
              {this.state.error.message}
            </p>
          ) : null}

          <div className="app-error-panel__actions">
            <button type="button" className="app-error-panel__primary" onClick={this.reset}>
              <RotateCcw size={18} aria-hidden="true" />
              Try again
            </button>
            <button type="button" className="app-error-panel__secondary" onClick={this.reload}>
              <RefreshCw size={18} aria-hidden="true" />
              Reload app
            </button>
          </div>

          <p className="app-error-panel__meta">Reference {this.state.errorId}</p>
        </section>
      </main>
    )
  }
}

function createErrorId() {
  return `ERR-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`
}
