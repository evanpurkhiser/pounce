import './ui/styles.css';

import {StrictMode} from 'react';

import {NuqsAdapter} from 'nuqs/adapters/react';
import {createRoot} from 'react-dom/client';

import {App} from './app/App';
import {initializeLunchMoneyConnection} from './app/initializeLunchMoneyConnection';

const root = createRoot(document.getElementById('root')!);

void initializeLunchMoneyConnection(() => {
  root.render(<p role="status">Connecting to Lunch Money…</p>);
}).then(initialOAuth => {
  root.render(
    <StrictMode>
      <NuqsAdapter>
        <App initialOAuth={initialOAuth} />
      </NuqsAdapter>
    </StrictMode>,
  );
});
