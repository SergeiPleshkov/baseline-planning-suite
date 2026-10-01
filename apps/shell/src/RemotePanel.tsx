import type { HostContext, RemoteAppProps } from '@baseline/host-contract';
import { useEffect, useState, type ComponentType } from 'react';
import { describeError } from './errors';
import { RemoteBoundary } from './RemoteBoundary';
import type { RemoteLoader, RemoteName } from './remotes';
import styles from './RemotePanel.module.css';

type PanelState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly App: ComponentType<RemoteAppProps> }
  | { readonly status: 'failed'; readonly reason: string };

interface RemotePanelProps {
  readonly name: RemoteName;
  readonly title: string;
  readonly loader: RemoteLoader;
  readonly host: HostContext;
}

export function RemotePanel({ name, title, loader, host }: RemotePanelProps) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PanelState>({ status: 'loading' });

  useEffect(() => {
    let current = true;
    loader.load(name, { afterFailure: attempt > 0 }).then(
      (App) => {
        if (current) setState({ status: 'ready', App });
      },
      (error: unknown) => {
        if (current) setState({ status: 'failed', reason: describeError(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [loader, name, attempt]);

  const retry = () => {
    setState({ status: 'loading' });
    setAttempt((previous) => previous + 1);
  };

  const unavailable = (reason: string) => (
    <div role="alert" className={styles.unavailable}>
      <strong>{title} is unavailable.</strong>
      <p className={styles.reason}>{reason}</p>
      <p className={styles.entry}>Entry: {loader.entryOf(name)}</p>
      <button type="button" onClick={retry}>
        Retry
      </button>
    </div>
  );

  switch (state.status) {
    case 'loading':
      return <p className={styles.loading}>Loading {title}…</p>;
    case 'failed':
      return unavailable(state.reason);
    case 'ready': {
      const { App } = state;
      return (
        <RemoteBoundary key={attempt} fallback={(error) => unavailable(describeError(error))}>
          <App host={host} />
        </RemoteBoundary>
      );
    }
  }
}
