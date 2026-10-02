import { useSyncExternalStore } from 'react';

const VIEWS = ['people', 'delivery', 'side-by-side'] as const;
export type View = (typeof VIEWS)[number];

const DEFAULT_VIEW: View = 'people';

export function viewFromPath(pathname: string): View {
  return VIEWS.find((view) => pathname === `/${view}`) ?? DEFAULT_VIEW;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
  };
}

export function useView(): View {
  return viewFromPath(useSyncExternalStore(subscribe, () => window.location.pathname));
}

/** Keeps the query string, so a rehearsed outage (`?break=…`) survives navigation. */
export function hrefFor(view: View): string {
  return `/${view}${window.location.search}`;
}

export function navigate(view: View): void {
  window.history.pushState(null, '', hrefFor(view));
  window.dispatchEvent(new PopStateEvent('popstate'));
}
