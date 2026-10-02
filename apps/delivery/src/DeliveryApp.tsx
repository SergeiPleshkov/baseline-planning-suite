import { HOST_CONTRACT_VERSION, type RemoteAppProps } from '@baseline/host-contract';
import styles from './DeliveryApp.module.css';
import { DeliveryScreen } from './ui/DeliveryScreen';
import { useDeliveryRuntime } from './ui/useDeliveryStore';

function Content() {
  const { runtime, restart } = useDeliveryRuntime();
  if (runtime.status === 'starting') return <p role="status">Starting…</p>;
  if (runtime.status === 'failed') {
    return (
      <div role="alert">
        <p>{runtime.message}</p>
        <button type="button" onClick={restart}>
          Retry
        </button>
      </div>
    );
  }
  return <DeliveryScreen store={runtime.store} />;
}

export default function DeliveryApp({ host }: RemoteAppProps) {
  if (host.contractVersion !== HOST_CONTRACT_VERSION) {
    return (
      <p role="alert" className={styles.app}>
        Delivery supports host contract v{HOST_CONTRACT_VERSION}; this host speaks v
        {host.contractVersion}.
      </p>
    );
  }

  return (
    <section className={styles.app} aria-labelledby="delivery-title">
      <header className={styles.header}>
        <h1 id="delivery-title" className={styles.title}>
          Delivery
        </h1>
        <p className={styles.context}>
          Editing as {host.activeUser.displayName} · amounts in {host.displayCurrency.code}
        </p>
      </header>
      <Content />
    </section>
  );
}
