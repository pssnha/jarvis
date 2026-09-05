-- OAuth client for the Jarvis iOS app (Siri App Intents + in-app voice).
-- Run once in prod: scp this file, then `docker compose exec -T mysql mysql ... < oauth-client-ios.sql`.
-- clientId is public; the secret is embedded in the app (a family TestFlight build, not a
-- public store app) and the flow also requires PKCE. Replace the placeholder secret and
-- paste the same value into the app's OAuth config.
INSERT INTO OAuthClient (id, clientId, secretHash, name, redirectUris, createdAt)
VALUES (
  UUID(),
  'jarvis-ios',
  SHA2('PUT-A-STRONG-SECRET-HERE', 256),
  'Jarvis iOS',
  'jarvis://oauth/callback',
  NOW(3)
);
