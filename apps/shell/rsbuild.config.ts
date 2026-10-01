import { pluginModuleFederation } from '@module-federation/rsbuild-plugin';
import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  plugins: [
    pluginReact(),
    pluginModuleFederation({
      name: 'shell',
      // Registered at runtime from /config.json, never baked into the bundle.
      remotes: {},
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
  html: { title: 'Baseline' },
  server: { port: 3000, historyApiFallback: true },
});
