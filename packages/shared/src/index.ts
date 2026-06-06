export const APP_NAME = 'jarvis';

/** The interfaces a user can reach the service through. */
export type Channel = 'web' | 'whatsapp';

/** A normalized inbound message from any channel. */
export interface InboundMessage {
  channel: Channel;
  /** App user id (web) or WhatsApp wa_id / phone (whatsapp). */
  userId: string;
  text: string;
}

/** A reply produced by the agent. */
export interface AgentReply {
  text: string;
}

export type Role = 'user' | 'assistant';
