import {useEffect, useState} from 'react';

import {toast} from 'sonner';

import {liveSource} from '../data/api';
import {demoSource} from '../data/demo';
import {
  alphaApi,
  clearOAuthConnection,
  revokeOAuth,
  type OAuthConnection,
} from '../data/lunchMoneyOAuth';
import {createSession} from '../data/session';

function createConnection(id: number, authorization?: OAuthConnection) {
  const source = authorization
    ? liveSource(authorization.accessToken, alphaApi)
    : demoSource();
  return {id, authorization, session: createSession(source)};
}

function forgetOAuthConnection(accessToken: string) {
  try {
    clearOAuthConnection(accessToken);
  } catch {
    toast.warning('The browser could not clear the saved Lunch Money connection.');
  }
}

export function useLunchMoneyConnection(initialOAuth?: OAuthConnection) {
  const [connection, setConnection] = useState(() => createConnection(0, initialOAuth));
  const authorization = connection.authorization;

  useEffect(() => {
    if (!authorization) {
      return;
    }

    const timer = window.setTimeout(() => {
      forgetOAuthConnection(authorization.accessToken);
      setConnection(previous =>
        previous.authorization === authorization
          ? createConnection(previous.id + 1)
          : previous,
      );
      toast.warning('The Lunch Money authorization expired. Connect again to continue.');
    }, authorization.expiresAt - Date.now());
    return () => window.clearTimeout(timer);
  }, [authorization]);

  function disconnect() {
    if (!authorization) {
      return;
    }

    forgetOAuthConnection(authorization.accessToken);
    void revokeOAuth(authorization.accessToken).catch(() => {
      toast.warning(
        'Lunch Money could not confirm revocation. You can revoke access in Connected Apps.',
      );
    });
    setConnection(previous => createConnection(previous.id + 1));
  }

  return {
    id: connection.id,
    session: connection.session,
    budgetName: authorization?.budgetName,
    disconnect,
  };
}
