import {defineConfig} from '@playwright/test';

const externalUrl = process.env.LUNCHLINE_TEST_URL;
export default defineConfig({
  testDir: './tests',
  workers: 2,
  use: {baseURL: externalUrl ?? 'http://127.0.0.1:5179', trace: 'retain-on-failure'},
  webServer: externalUrl ? undefined : {
    command: 'npm run dev -- --port 5179 --strictPort',
    url: 'http://127.0.0.1:5179',
    reuseExistingServer: !process.env.CI,
  },
});
