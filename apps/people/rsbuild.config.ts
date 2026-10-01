import { pluginModuleFederation } from '@module-federation/rsbuild-plugin';
import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  plugins: [
    pluginReact(),
    pluginModuleFederation({
      name: 'people',
      exposes: { './App': './src/PeopleApp.tsx' },
      shared: {
        react: { singleton: true, strictVersion: true, requiredVersion: pkg.dependencies.react },
        'react-dom': {
          singleton: true,
          strictVersion: true,
          requiredVersion: pkg.dependencies['react-dom'],
        },
      },
      dts: false,
    }),
  ],
  html: { title: 'People · Baseline' },
  // Chunks resolve from wherever the manifest was served: standalone, in the shell, behind a gateway.
  output: { assetPrefix: 'auto' },
  // Development only: the shell is on another port. Deployed, everything is same-origin.
  server: { port: 3001, cors: { origin: /^http:\/\/localhost:\d+$/ } },
});
