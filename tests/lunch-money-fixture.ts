export const issuer = 'https://api-alpha.lunchmoney.dev';
export const clientId = process.env.POUNCE_TEST_URL
  ? process.env.VITE_LUNCH_MONEY_ALPHA_CLIENT_ID?.trim()
  : 'pounce-test-client';
export const connectionKey = `pounce.lunchMoneyOAuthConnection.${clientId}`;
export const discoveryDocument = {
  issuer,
  authorization_endpoint: `${issuer}/oauth/authorize`,
  token_endpoint: `${issuer}/oauth/token`,
  revocation_endpoint: `${issuer}/oauth/revoke`,
  code_challenge_methods_supported: ['S256'],
  authorization_response_iss_parameter_supported: true,
};
