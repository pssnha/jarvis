import type { WASocket, WAMessage } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';
import { createRedis } from '../lib/redis';
import { handleInboundGroupMessage } from './inbound';

const AUTH_DIR = process.env.WA_AUTH_DIR ?? '/data/wa-auth';
const logger = pino({ level: 'silent' });
const redis = createRedis();

let sock: WASocket | null = null;
let selfNumber: string | null = null;
let starting = false;

export function isConnected(): boolean {
  return sock !== null && selfNumber !== null;
}

/** Send a text message to a WhatsApp JID (group or user). */
export async function sendGroupText(jid: string, text: string): Promise<void> {
  if (!sock) throw new Error('WhatsApp client not connected');
  await sock.sendMessage(jid, { text });
}

/** Start (or restart) the Baileys linked-device client. */
export async function startWhatsApp(): Promise<void> {
  if (starting) return;
  starting = true;

  // Dynamic import keeps this CJS build compatible regardless of Baileys' module format.
  const baileys = await import('@whiskeysockets/baileys');
  const makeWASocket = baileys.default;
  const { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = baileys;

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    browser: ['Jarvis', 'Chrome', '1.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;

    if (qr) {
      const dataUrl = await QRCode.toDataURL(qr);
      await redis.set('wa:qr', dataUrl, 'EX', 120);
      await redis.set('wa:status', 'qr');
    }

    if (connection === 'connecting') {
      await redis.set('wa:status', 'connecting');
    } else if (connection === 'open') {
      selfNumber = sock?.user?.id?.split(':')[0] ?? null;
      await redis.del('wa:qr');
      await redis.set('wa:status', 'open');
      if (selfNumber) await redis.set('wa:self', selfNumber);
      void refreshGroups();
    } else if (connection === 'close') {
      starting = false;
      const code = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output
        ?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        sock = null;
        selfNumber = null;
        await redis.set('wa:status', 'logged_out');
      } else {
        await redis.set('wa:status', 'closed');
        setTimeout(() => void startWhatsApp(), 3000); // auto-reconnect
      }
    }
  });

  sock.ev.on('messages.upsert', async (ev) => {
    if (ev.type !== 'notify') return;
    for (const msg of ev.messages as WAMessage[]) {
      try {
        await handleInboundGroupMessage(msg, sendGroupText, selfNumber);
      } catch (err) {
        console.error('[wa] inbound handling failed:', err);
      }
    }
  });

  // refreshGroups is called on 'open'; also refresh when group metadata changes.
  sock.ev.on('groups.update', () => void refreshGroups());
}

async function refreshGroups(): Promise<void> {
  if (!sock) return;
  try {
    const groups = await sock.groupFetchAllParticipating();
    const list = Object.values(groups).map((g) => ({ id: g.id, subject: g.subject }));
    await redis.set('wa:groups', JSON.stringify(list));
  } catch (err) {
    console.error('[wa] group fetch failed:', err);
  }
}
