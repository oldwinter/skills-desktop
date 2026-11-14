import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';

// Smoke tests do not call a model, so no agent provider is configured.
const app = {
  url: 'http://127.0.0.1:5173',
  command: {
    executable: 'npm',
    args: ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173', '--strictPort'],
    reuseExisting: true,
  },
};

export default {
  tests: ['e2e/**/*.e2e.ts'],
  targets: [{ name: 'chromium', engine: web(), app }],
} satisfies E2EConfig;
