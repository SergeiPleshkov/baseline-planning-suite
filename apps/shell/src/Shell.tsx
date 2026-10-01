import type { MouseEvent, ReactNode } from 'react';
import { hrefFor, navigate, useView, type View } from './navigation';
import { RemotePanel } from './RemotePanel';
import type { RemoteLoader, RemoteName } from './remotes';
import type { RuntimeConfig } from './runtimeConfig';
import styles from './Shell.module.css';
import { useHostContext } from './useHostContext';

interface ShellProps {
  readonly config: RuntimeConfig;
  readonly loader: RemoteLoader;
  readonly outages: ReadonlySet<RemoteName>;
}

export function Shell({ config, loader, outages }: ShellProps) {
  const view = useView();
  const { host, selectCurrency, selectUser } = useHostContext(config);

  return (
    <div className={styles.shell}>
      <header className={styles.bar}>
        <span className={styles.brand}>Baseline</span>
        <nav aria-label="Applications" className={styles.nav}>
          <NavLink view="people" current={view}>
            People
          </NavLink>
          <NavLink view="delivery" current={view}>
            Delivery
          </NavLink>
          <NavLink view="side-by-side" current={view}>
            Side by side
          </NavLink>
        </nav>
        <label className={styles.field}>
          Currency
          <select
            value={host.displayCurrency.code}
            onChange={(event) => {
              selectCurrency(event.target.value);
            }}
          >
            {config.currencies.map((currency) => (
              <option key={currency.code} value={currency.code}>
                {currency.code}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          User
          <select
            value={host.activeUser.id}
            onChange={(event) => {
              selectUser(event.target.value);
            }}
          >
            {config.users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.displayName}
              </option>
            ))}
          </select>
        </label>
        <Diagnostics view={view} outages={outages} />
      </header>
      <main className={view === 'side-by-side' ? styles.sideBySide : styles.single}>
        {view !== 'delivery' && (
          <RemotePanel key="people" name="people" title="People" loader={loader} host={host} />
        )}
        {view !== 'people' && (
          <RemotePanel
            key="delivery"
            name="delivery"
            title="Delivery"
            loader={loader}
            host={host}
          />
        )}
      </main>
    </div>
  );
}

function NavLink({
  view,
  current,
  children,
}: {
  readonly view: View;
  readonly current: View;
  readonly children: ReactNode;
}) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    if (event.button !== 0 || modified) return;
    event.preventDefault();
    navigate(view);
  };
  return (
    <a href={hrefFor(view)} aria-current={view === current ? 'page' : undefined} onClick={onClick}>
      {children}
    </a>
  );
}

function Diagnostics({
  view,
  outages,
}: {
  readonly view: View;
  readonly outages: ReadonlySet<RemoteName>;
}) {
  return (
    <details className={styles.diagnostics}>
      <summary>
        Diagnostics
        {outages.size > 0 && (
          <span className={styles.outage}> · simulating outage: {[...outages].join(', ')}</span>
        )}
      </summary>
      <ul>
        <li>
          <a href={`/${view}?break=people`}>Break People</a>
        </li>
        <li>
          <a href={`/${view}?break=delivery`}>Break Delivery</a>
        </li>
        <li>
          <a href={`/${view}`}>Restore all remotes</a>
        </li>
      </ul>
    </details>
  );
}
