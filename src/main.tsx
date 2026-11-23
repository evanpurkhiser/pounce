import './ui/styles.css';

import {StrictMode} from 'react';

import {NuqsAdapter} from 'nuqs/adapters/react';
import {createRoot} from 'react-dom/client';

import {App} from './app/App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NuqsAdapter>
      <App />
    </NuqsAdapter>
  </StrictMode>,
);
