import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("UI error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary panel-card">
          <h2 className="section-title">Something went wrong</h2>
          <p className="muted">
            The page hit an unexpected error. Try refreshing. If you just uploaded a CAS, your file is still saved on
            this device — open Profile → Uploaded CAS after refresh.
          </p>
          <p className="error-boundary-detail">{this.state.error.message}</p>
          <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
            Refresh page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
