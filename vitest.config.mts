import { defineConfig, ViteUserConfig } from 'vitest/config';
import tsconfig from './tsconfig.json';
import path from 'path';

// Create an alias object from the paths in tsconfig.json
const pathAlias = Object.fromEntries(
  // For Each Path in tsconfig.json
  Object.entries(tsconfig.compilerOptions.paths).map(([key, [value]]) => [
    // Remove the "/*" from the key and resolve the path
    key.replace('/*', ''),
    // Remove the "/*" from the value Resolve the relative path
    path.resolve(__dirname, value.replace('/*', '')),
  ])
);

const dependencyAlias = {
  '@map-colonies/shapefile-reader': path.resolve(__dirname, 'node_modules/@map-colonies/shapefile-reader/dist/index.js'),
  '@map-colonies/3d-shared': path.resolve(__dirname, 'node_modules/@map-colonies/3d-shared/dist/index.js'),
};

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          setupFiles: ['./tests/configurations/initJestOpenapi.setup.ts', './tests/configurations/vite.setup.ts'],
          include: ['tests/unit/**/*.spec.ts'],
          environment: 'node',
        },
        resolve: {
          alias: { ...pathAlias, ...dependencyAlias },
        },
      },
      {
        test: {
          name: 'integration',
          setupFiles: ['./tests/configurations/initJestOpenapi.setup.ts', './tests/configurations/vite.setup.ts'],
          include: ['tests/integration/**/*.spec.ts'],
          environment: 'node',
        },
        resolve: {
          alias: { ...pathAlias, ...dependencyAlias },
        },
      },
    ],
    coverage: {
      enabled: true,
      reporter: ['text', 'html', 'json', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['**/vendor/**', 'node_modules/**'],
      reportOnFailure: true,
      thresholds: {
        global: {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
      },
    },
  },
});
