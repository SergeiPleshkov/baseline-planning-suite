import { Component, type ReactNode } from 'react';

interface RemoteBoundaryProps {
  readonly fallback: (error: Error) => ReactNode;
  readonly children: ReactNode;
}

interface RemoteBoundaryState {
  readonly error: Error | null;
}

export class RemoteBoundary extends Component<RemoteBoundaryProps, RemoteBoundaryState> {
  override state: RemoteBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): RemoteBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override render(): ReactNode {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children;
  }
}
