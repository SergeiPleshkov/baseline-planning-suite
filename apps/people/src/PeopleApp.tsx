import { HOST_CONTRACT_VERSION, type RemoteAppProps } from '@baseline/host-contract';
import styles from './PeopleApp.module.css';

export default function PeopleApp({ host }: RemoteAppProps) {
  if (host.contractVersion !== HOST_CONTRACT_VERSION) {
    return (
      <p role="alert" className={styles.app}>
        People supports host contract v{HOST_CONTRACT_VERSION}; this host speaks v
        {host.contractVersion}.
      </p>
    );
  }

  return (
    <section className={styles.app} aria-labelledby="people-title">
      <header className={styles.header}>
        <h1 id="people-title" className={styles.title}>
          People
        </h1>
        <p className={styles.context}>
          Editing as {host.activeUser.displayName} · amounts in {host.displayCurrency.code}
        </p>
      </header>
    </section>
  );
}
