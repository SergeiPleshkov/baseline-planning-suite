import { HOST_CONTRACT_VERSION, type HostContext } from '@baseline/host-contract';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import PeopleApp from './PeopleApp';
import './standalone.css';

// Standalone only: hosted, the shell renders PeopleApp through `./App` and never runs this file.
const standaloneHost: HostContext = {
  contractVersion: HOST_CONTRACT_VERSION,
  displayCurrency: { code: 'EUR', ratePerEur: 1 },
  activeUser: { id: 'standalone', displayName: 'Standalone session' },
};

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root element');
}

createRoot(container).render(
  <StrictMode>
    <PeopleApp host={standaloneHost} />
  </StrictMode>,
);
