import {LunchMoneyClient} from '@lunch-money/lunch-money-js-v2';
import * as oauth from 'oauth4webapi';
import * as z from 'zod/mini';

const issuer = new URL('https://api-alpha.lunchmoney.dev');

/**
 * Base URL for Lunch Money API requests made with an alpha OAuth token.
 */
export const alphaApi = new URL('/v2', issuer).href;

const clientId = (
  import.meta.env.VITE_LUNCH_MONEY_ALPHA_CLIENT_ID as string | undefined
)?.trim();
const clientAuth = oauth.None();
const attemptKey = 'pounce.lunchMoneyOAuthAttempt';
const connectionKey = clientId
  ? `pounce.lunchMoneyOAuthConnection.${clientId}`
  : undefined;
const redirectUri = () => new URL('/', location.origin).href;
const authorizationAttempt = z.tuple([z.string(), z.string()]);
const budgetIdentity = z.object({
  id: z.int(),
  account_id: z.int(),
  budget_name: z.string().check(z.trim(), z.minLength(1)),
});

const storedConnection = z.object({
  accessToken: z.string().check(z.minLength(1)),
  expiresAt: z.number(),
  budgetName: z.string().check(z.minLength(1)),
});

/**
 * An authorized budget, its bearer token, and the token's expiry in Unix milliseconds.
 */
export type OAuthConnection = z.infer<typeof storedConnection>;

export class OAuthConfigurationError extends Error {
  constructor() {
    super('This Pounce deployment needs a Lunch Money client ID.');
  }
}

function configuredClient() {
  if (!clientId) {
    throw new OAuthConfigurationError();
  }

  return {client_id: clientId};
}

function readOAuthConnection(key: string) {
  const stored = localStorage.getItem(key);
  if (stored !== null) {
    return z.safeParse(storedConnection, JSON.parse(stored)).data;
  }
}

/**
 * Remembers the authorized budget across reloads on this origin for this client ID.
 */
export function saveOAuthConnection(connection: OAuthConnection) {
  if (!connectionKey) {
    throw new OAuthConfigurationError();
  }

  localStorage.setItem(connectionKey, JSON.stringify(connection));
}

/**
 * Restores an unexpired connection at startup and removes expired records.
 */
export function restoreOAuthConnection() {
  if (!connectionKey) {
    return;
  }

  try {
    const connection = readOAuthConnection(connectionKey);
    if (connection && connection.expiresAt > Date.now()) {
      return connection;
    }

    if (connection) {
      localStorage.removeItem(connectionKey);
    }
  } catch {
    // An unavailable or malformed record should never prevent Pounce from opening.
  }
}

/**
 * Removes the saved connection if it still uses this tab's token.
 */
export function clearOAuthConnection(accessToken: string) {
  if (connectionKey && readOAuthConnection(connectionKey)?.accessToken === accessToken) {
    localStorage.removeItem(connectionKey);
  }
}

async function discover() {
  const response = await oauth.discoveryRequest(issuer, {algorithm: 'oauth2'});
  const server = await oauth.processDiscoveryResponse(issuer, response);

  if (
    !server.authorization_endpoint ||
    !server.code_challenge_methods_supported?.includes('S256')
  ) {
    throw new Error('Lunch Money did not advertise authorization with S256 PKCE.');
  }

  return {...server, authorization_endpoint: server.authorization_endpoint};
}

/**
 * Redirects to Lunch Money, keeping the state and PKCE verifier in this tab.
 */
export async function startOAuth() {
  const client = configuredClient();
  const server = await discover();
  const verifier = oauth.generateRandomCodeVerifier();
  const state = oauth.generateRandomState();
  const challenge = await oauth.calculatePKCECodeChallenge(verifier);
  const authorization = new URL(server.authorization_endpoint);
  authorization.search = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: redirectUri(),
    response_type: 'code',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();

  sessionStorage.setItem(attemptKey, JSON.stringify([state, verifier]));
  location.assign(authorization);
}

/**
 * Returns an exchange promise for OAuth callbacks and scrubs their URL parameters.
 */
export function finishOAuth() {
  const callback = new URL(location.href);
  if (
    callback.pathname !== '/' ||
    (!callback.searchParams.has('code') && !callback.searchParams.has('error'))
  ) {
    return;
  }

  const cleanUrl = new URL(callback);
  for (const parameter of [
    'code',
    'state',
    'iss',
    'error',
    'error_description',
    'error_uri',
  ]) {
    cleanUrl.searchParams.delete(parameter);
  }
  history.replaceState(history.state, '', cleanUrl);

  return exchange(callback);
}

async function exchange(callback: URL): Promise<OAuthConnection> {
  const stored = sessionStorage.getItem(attemptKey);
  sessionStorage.removeItem(attemptKey);
  if (!callback.searchParams.has('iss')) {
    throw new Error('The Lunch Money callback is missing its issuer.');
  }

  const [state, verifier] = z.parse(authorizationAttempt, JSON.parse(stored ?? 'null'));
  const client = configuredClient();
  const server = await discover();
  const parameters = oauth.validateAuthResponse(server, client, callback, state);
  const response = await oauth.authorizationCodeGrantRequest(
    server,
    client,
    clientAuth,
    parameters,
    redirectUri(),
    verifier,
  );
  const {access_token: accessToken, expires_in: expiresIn} =
    await oauth.processAuthorizationCodeResponse(server, client, response);
  if (!expiresIn) {
    throw new Error('Lunch Money did not return a valid access token lifetime.');
  }

  const expiresAt = Date.now() + expiresIn * 1000;
  const api = new LunchMoneyClient({apiKey: accessToken, baseUrl: alphaApi});
  const {budget_name: budgetName} = z.parse(budgetIdentity, await api.user.getMe());
  return {accessToken, expiresAt, budgetName};
}

/**
 * Revokes an access token at Lunch Money. The caller handles local cleanup.
 */
export async function revokeOAuth(accessToken: string) {
  const client = configuredClient();
  const server = await discover();
  const response = await oauth.revocationRequest(
    server,
    client,
    clientAuth,
    accessToken,
    {
      additionalParameters: {token_type_hint: 'access_token'},
    },
  );
  await oauth.processRevocationResponse(response);
}
