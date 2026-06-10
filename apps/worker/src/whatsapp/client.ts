import path from 'node:path';
import { rm } from 'node:fs/promises';
import type { WASocket, WAMessage } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';
import { allCircleIds, upsertWhatsAppGroup } from '@jarvis/agent';
import { createRedis } from '../lib/redis';
import { handleInboundMessage } from './inbound';

/**
 * Multi-session WhatsApp: one Baileys linked-device session per circle. Each
 * circle has its own auth dir (`/data/wa-auth/{circleId}`) and Redis status keys
 * (`wa:{circleId}:*`). The API publishes start/stop on the `wa:control` channel
 * when circles are created/deleted; we also reconcile against the DB on a timer.
 */

const AUTH_BASE = process.env.WA_AUTH_DIR ?? '/data/wa-auth';
const CONTROL_CHANNEL = 'wa:control';
const logger = pino({ level: 'silent' });
const redis = createRedis();

interface Session {
  sock: WASocket | null;
  selfNumber: string | null;
  starting: boolean;
}

const sessions = new Map<string, Session>();

function key(circleId: string, suffix: string): string {
  return `wa:${circleId}:${suffix}`;
}

export function isConnected(circleId: string): boolean {
  const s = sessions.get(circleId);
  return Boolean(s && s.sock && s.selfNumber);
}

/** Send a text message to a WhatsApp JID (group or user) on a circle's session. */
export async function sendGroupText(circleId: string, jid: string, text: string): Promise<void> {
  const s = sessions.get(circleId);
  if (!s?.sock) throw new Error(`WhatsApp session for circle ${circleId} not connected`);
  await s.sock.sendMessage(jid, { text });
}

/** Send a direct (1:1) message to a phone number on a circle's session. */
export async function sendDirectText(
  circleId: string,
  number: string,
  text: string,
): Promise<void> {
  const s = sessions.get(circleId);
  if (!s?.sock) throw new Error(`WhatsApp session for circle ${circleId} not connected`);
  const jid = `${number.replace(/\D/g, '')}@s.whatsapp.net`;
  await s.sock.sendMessage(jid, { text });
}

/** Boot a session for every circle, then listen for create/delete control events. */
export async function startAllSessions(): Promise<void> {
  const ids = await allCircleIds();
  for (const id of ids) void startWhatsApp(id).catch((e) => console.error(`[wa:${id}] start failed:`, e));
  void subscribeControl();
  // Safety net: reconcile sessions with the DB every 5 minutes.
  setInterval(() => void reconcile(), 5 * 60_000);
}

async function reconcile(): Promise<void> {
  try {
    const ids = await allCircleIds();
    for (const id of ids) {
      if (!sessions.has(id)) void startWhatsApp(id).catch(() => {});
    }
  } catch (err) {
    console.error('[wa] reconcile failed:', err);
  }
}

/** Subscribe to start/stop control messages published by the API. */
async function subscribeControl(): Promise<void> {
  const sub = redis.duplicate();
  await sub.subscribe(CONTROL_CHANNEL);
  sub.on('message', (_chan, raw) => {
    try {
      const msg = JSON.parse(raw) as { action: 'start' | 'stop' | 'logout'; circleId: string };
      if (!msg.circleId) return;
      if (msg.action === 'start') void startWhatsApp(msg.circleId).catch(() => {});
      else if (msg.action === 'stop') void stopSession(msg.circleId).catch(() => {});
      else if (msg.action === 'logout') void logoutSession(msg.circleId).catch(() => {});
    } catch {
      /* ignore malformed control messages */
    }
  });
}

async function stopSession(circleId: string): Promise<void> {
  const s = sessions.get(circleId);
  try {
    await s?.sock?.logout();
  } catch {
    /* ignore */
  }
  sessions.delete(circleId);
  await redis.del(key(circleId, 'status'), key(circleId, 'qr'), key(circleId, 'self'), key(circleId, 'groups'));
}

/** Unlink the device for a circle and wipe its auth so a fresh QR can be linked. */
async function logoutSession(circleId: string): Promise<void> {
  await stopSession(circleId);
  try {
    await rm(path.join(AUTH_BASE, circleId), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

/** Start (or restart) the Baileys session for one circle. */
export async function startWhatsApp(circleId: string): Promise<void> {
  let session = sessions.get(circleId);
  if (session?.starting) return;
  if (!session) {
    session = { sock: null, selfNumber: null, starting: false };
    sessions.set(circleId, session);
  }
  session.starting = true;

  // Dynamic import keeps this CJS build compatible regardless of Baileys' module format.
  const baileys = await import('@whiskeysockets/baileys');
  const makeWASocket = baileys.default;
  const { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = baileys;

  const authDir = path.join(AUTH_BASE, circleId);
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    browser: ['Jarvis', 'Chrome', '1.0'],
  });
  session.sock = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;
    const s = sessions.get(circleId);
    if (!s) return;

    if (qr) {
      const dataUrl = await QRCode.toDataURL(qr);
      await redis.set(key(circleId, 'qr'), dataUrl, 'EX', 120);
      await redis.set(key(circleId, 'status'), 'qr');
    }

    if (connection === 'connecting') {
      await redis.set(key(circleId, 'status'), 'connecting');
    } else if (connection === 'open') {
      s.selfNumber = s.sock?.user?.id?.split(':')[0] ?? null;
      await redis.del(key(circleId, 'qr'));
      await redis.set(key(circleId, 'status'), 'open');
      if (s.selfNumber) await redis.set(key(circleId, 'self'), s.selfNumber);
      void refreshGroups(circleId);
    } else if (connection === 'close') {
      s.starting = false;
      const code = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output
        ?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        s.sock = null;
        s.selfNumber = null;
        await redis.set(key(circleId, 'status'), 'logged_out');
      } else {
        await redis.set(key(circleId, 'status'), 'closed');
        setTimeout(() => void startWhatsApp(circleId), 3000); // auto-reconnect
      }
    }
  });

  sock.ev.on('messages.upsert', async (ev) => {
    if (ev.type !== 'notify') return;
    for (const msg of ev.messages as WAMessage[]) {
      try {
        await handleInboundMessage(circleId, msg, (jid, text) => sendGroupText(circleId, jid, text));
      } catch (err) {
        console.error(`[wa:${circleId}] inbound handling failed:`, err);
      }
    }
  });

  // refreshGroups is called on 'open'; also refresh when group metadata changes.
  sock.ev.on('groups.update', () => void refreshGroups(circleId));
}

async function refreshGroups(circleId: string): Promise<void> {
  const s = sessions.get(circleId);
  if (!s?.sock) return;
  try {
    const groups = await s.sock.groupFetchAllParticipating();
    const list = Object.values(groups).map((g) => ({ id: g.id, subject: g.subject }));
    await redis.set(key(circleId, 'groups'), JSON.stringify(list));
    // Every group this circle's number is in becomes one of its Jarvis groups.
    for (const g of list) {
      try {
        await upsertWhatsAppGroup(circleId, g.id, g.subject ?? '');
      } catch (err) {
        console.error(`[wa:${circleId}] group sync failed for ${g.id}:`, err);
      }
    }
  } catch (err) {
    console.error(`[wa:${circleId}] group fetch failed:`, err);
  }
}
