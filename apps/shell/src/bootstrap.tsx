import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { describeError } from './ui/errors';
import { createRemoteLoader, resolveEntries, simulatedOutages } from './infrastructure/remotes';
import { loadRuntimeConfig } from './infrastructure/runtimeConfig';
import { ShellApp } from './ShellApp';
import './global.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root element');
}
const root = createRoot(container);

void loadRuntimeConfig().then(
  (config) => {
    const outages = simulatedOutages(window.location.search);
    const loader = createRemoteLoader(
      resolveEntries(config.remotes, outages, window.location.origin),
    );
    root.render(
      <StrictMode>
        <ShellApp config={config} loader={loader} outages={outages} />
      </StrictMode>,
    );
  },
  (error: unknown) => {
    root.render(
      <p role="alert">Baseline could not read its runtime configuration: {describeError(error)}</p>,
    );
  },
);
