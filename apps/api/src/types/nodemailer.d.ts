// Minimal ambient types for the slice of nodemailer we use (the package ships
// no bundled .d.ts and we don't depend on @types/nodemailer).
declare module 'nodemailer' {
  export interface SendMailOptions {
    from?: string;
    to?: string;
    subject?: string;
    text?: string;
    html?: string;
  }
  export interface Transporter {
    sendMail(options: SendMailOptions): Promise<{ messageId: string }>;
  }
  export interface TransportOptions {
    host?: string;
    port?: number;
    secure?: boolean;
    auth?: { user: string; pass: string };
  }
  export function createTransport(options: TransportOptions): Transporter;
  const _default: { createTransport: typeof createTransport };
  export default _default;
}
