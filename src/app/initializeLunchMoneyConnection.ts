import {AuthorizationResponseError} from 'oauth4webapi';
import {toast} from 'sonner';

import {
  finishOAuth,
  restoreOAuthConnection,
  saveOAuthConnection,
} from '../data/lunchMoneyOAuth';

export async function initializeLunchMoneyConnection(onAuthorizing: () => void) {
  const callback = finishOAuth();
  if (!callback) {
    return restoreOAuthConnection();
  }

  onAuthorizing();
  const connected = await callback.catch((error: unknown) => {
    if (error instanceof AuthorizationResponseError && error.error === 'access_denied') {
      toast.info('Lunch Money authorization was canceled.');
    } else {
      toast.error(
        'Could not finish the Lunch Money authorization. Start again from Connect Lunch Money.',
      );
    }
  });

  if (!connected) {
    return restoreOAuthConnection();
  }

  try {
    saveOAuthConnection(connected);
  } catch {
    toast.warning('The browser could not save the Lunch Money connection.');
  }

  return connected;
}
