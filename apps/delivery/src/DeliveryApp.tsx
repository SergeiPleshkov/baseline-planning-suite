import { HOST_CONTRACT_VERSION, type RemoteAppProps } from '@baseline/host-contract';
import styles from './DeliveryApp.module.css';

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
    </section>
  );
}
