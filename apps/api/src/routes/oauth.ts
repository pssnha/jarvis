import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '@jarvis/db';
import { env } from '../config/env';
import { currentUser } from '../auth';
import { OAUTH_RETURN_COOKIE } from '../auth/constants';
import { accessibleScheduleCircleIds } from '../lib/access';

const CODE_TTL_MS = 5 * 60 * 1000; // authorization code: 5 minutes
const ACCESS_TTL_S = 60 * 60; // access token: 1 hour
const REFRESH_TTL_S = 60 * 60 * 24 * 180; // refresh token: 180 days

const sha256 = (s: string): string => crypto.createHash('sha256').update(s).digest('hex');
const randomToken = (bytes = 32): string => crypto.randomBytes(bytes).toString('hex');
const base64url = (buf: Buffer): string => buf.toString('base64url');

/** Verify a PKCE S256 challenge against the verifier. */
function pkceMatches(verifier: string, challenge: string): boolean {
  const computed = base64url(crypto.createHash('sha256').update(verifier).digest());
  // Constant-time compare.
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Read client credentials from HTTP Basic auth or the request body. */
function clientCreds(
  req: FastifyRequest,
  body: Record<string, string>,
): { clientId?: string; clientSecret?: string } {
  const header = req.headers.authorization;
  if (header?.startsWith('Basic ')) {
    const [id, secret] = Buffer.from(header.slice(6), 'base64').toString('utf8').split(':');
    return { clientId: id, clientSecret: secret };
  }
  return { clientId: body.client_id, clientSecret: body.client_secret };
}

function isAllowedRedirect(client: { redirectUris: string }, uri: string): boolean {
  return client.redirectUris
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean)
    .includes(uri);
}

function errorPage(title: string, message: string): string {
  return `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
  <h1>${title}</h1><p>${message}</p>`;
}

/**
 * Bearer guard for token-authenticated routes (e.g. the voice API). Resolves the
 * access token to its AuthUser and sets req.authUser, or replies 401.
 */
export async function bearerAuth(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return reply.code(401).send({ error: 'unauthenticated' });
  const row = await prisma.oAuthToken.findUnique({
    where: { accessTokenHash: sha256(token) },
    include: { authUser: true },
  });
  if (!row || row.expiresAt < new Date()) return reply.code(401).send({ error: 'invalid_token' });
  req.authUser = row.authUser;
  return undefined;
}

/** OAuth2 authorization-code (+ PKCE) endpoints for account linking. Public —
 *  /authorize gates on a Jarvis session, /token gates on client credentials. */
export async function registerOAuth(api: FastifyInstance): Promise<void> {
  // --- Authorization endpoint (browser) ---
  api.get('/oauth/authorize', async (req, reply) => {
    const q = req.query as Record<string, string>;
    const { client_id, redirect_uri, state, response_type, code_challenge } = q;
    const method = q.code_challenge_method ?? 'plain';

    const client = client_id
      ? await prisma.oAuthClient.findUnique({ where: { clientId: client_id } })
      : null;
    if (!client || !redirect_uri || !isAllowedRedirect(client, redirect_uri)) {
      return reply.code(400).type('text/html').send(errorPage('Invalid request', 'Unknown client or redirect URI.'));
    }
    const sepErr = redirect_uri.includes('?') ? '&' : '?';
    const stateParam = state ? `&state=${encodeURIComponent(state)}` : '';
    if (response_type !== 'code') {
      return reply.redirect(`${redirect_uri}${sepErr}error=unsupported_response_type${stateParam}`);
    }
    // PKCE is optional (this is a confidential client authenticated by secret at
    // the token endpoint). If a challenge is supplied we enforce it (S256 only).
    if (code_challenge && method !== 'S256') {
      return reply.redirect(`${redirect_uri}${sepErr}error=invalid_request${stateParam}`);
    }

    // Require a signed-in Jarvis user; if absent, bounce through Google login and
    // return here afterwards.
    const user = await currentUser(api, req);
    if (!user) {
      reply.setCookie(OAUTH_RETURN_COOKIE, req.url, {
        signed: true,
        httpOnly: true,
        sameSite: 'lax',
        secure: env.NODE_ENV === 'production',
        path: '/',
        maxAge: 600,
      });
      return reply.redirect(`${env.AUTH_BASE_URL}/api/auth/google/login`);
    }

    // Access gate: the user must belong to at least one circle to have anything to link.
    const circles = await accessibleScheduleCircleIds(user);
    if (circles.length === 0) {
      return reply
        .code(403)
        .type('text/html')
        .send(errorPage('Not in a circle', `${user.email} isn't a member of any circle, so there's nothing to link.`));
    }

    const code = randomToken();
    await prisma.oAuthAuthCode.create({
      data: {
        codeHash: sha256(code),
        clientId: client.id,
        authUserId: user.id,
        redirectUri: redirect_uri,
        codeChallenge: code_challenge ?? '', // empty = no PKCE
        codeChallengeMethod: code_challenge ? 'S256' : 'none',
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      },
    });
    const sep = redirect_uri.includes('?') ? '&' : '?';
    return reply.redirect(`${redirect_uri}${sep}code=${code}${state ? `&state=${encodeURIComponent(state)}` : ''}`);
  });

  // --- Token endpoint (server-to-server) ---
  api.post('/oauth/token', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, string>;
    const { clientId, clientSecret } = clientCreds(req, body);
    const client = clientId
      ? await prisma.oAuthClient.findUnique({ where: { clientId } })
      : null;
    if (!client || !clientSecret || sha256(clientSecret) !== client.secretHash) {
      return reply.code(401).send({ error: 'invalid_client' });
    }

    if (body.grant_type === 'authorization_code') {
      const { code, redirect_uri, code_verifier } = body;
      if (!code) return reply.code(400).send({ error: 'invalid_request' });
      const row = await prisma.oAuthAuthCode.findUnique({ where: { codeHash: sha256(code) } });
      // PKCE only enforced when a challenge was captured at /authorize.
      const pkceOk = row?.codeChallenge
        ? !!code_verifier && pkceMatches(code_verifier, row.codeChallenge)
        : true;
      if (
        !row ||
        row.clientId !== client.id ||
        row.redirectUri !== redirect_uri ||
        row.expiresAt < new Date() ||
        !pkceOk
      ) {
        if (row) await prisma.oAuthAuthCode.delete({ where: { id: row.id } }).catch(() => {});
        return reply.code(400).send({ error: 'invalid_grant' });
      }
      await prisma.oAuthAuthCode.delete({ where: { id: row.id } }); // one-time use
      return reply.send(await issueTokens(client.id, row.authUserId));
    }

    if (body.grant_type === 'refresh_token') {
      const { refresh_token } = body;
      if (!refresh_token) return reply.code(400).send({ error: 'invalid_request' });
      const row = await prisma.oAuthToken.findUnique({
        where: { refreshTokenHash: sha256(refresh_token) },
      });
      if (!row || row.clientId !== client.id) return reply.code(400).send({ error: 'invalid_grant' });
      await prisma.oAuthToken.delete({ where: { id: row.id } }); // rotate
      return reply.send(await issueTokens(client.id, row.authUserId));
    }

    return reply.code(400).send({ error: 'unsupported_grant_type' });
  });
}

/** Mint and persist an access + refresh token pair (hashed at rest). */
async function issueTokens(
  clientId: string,
  authUserId: string,
): Promise<{ access_token: string; token_type: 'Bearer'; expires_in: number; refresh_token: string }> {
  const accessToken = randomToken();
  const refreshToken = randomToken();
  await prisma.oAuthToken.create({
    data: {
      clientId,
      authUserId,
      accessTokenHash: sha256(accessToken),
      refreshTokenHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + ACCESS_TTL_S * 1000),
    },
  });
  // Best-effort cleanup of this user's expired tokens.
  await prisma.oAuthToken
    .deleteMany({ where: { authUserId, expiresAt: { lt: new Date(Date.now() - REFRESH_TTL_S * 1000) } } })
    .catch(() => {});
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TTL_S,
    refresh_token: refreshToken,
  };
}
