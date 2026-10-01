import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { describeError } from './errors';
import { createRemoteLoader, resolveEntries, simulatedOutages } from './remotes';
import { loadRuntimeConfig } from './runtimeConfig';
import { Shell } from './Shell';
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
        <Shell config={config} loader={loader} outages={outages} />
      </StrictMode>,
    );
  },
  (error: unknown) => {
    root.render(
      <p role="alert">Baseline could not read its runtime configuration: {describeError(error)}</p>,
    );
  },
);
