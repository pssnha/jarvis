import { io, type Socket } from 'socket.io-client';

// Same-origin connection. In dev, Vite proxies /socket.io to the API server;
// in production, nginx proxies it to the API container.
export const socket: Socket = io({ autoConnect: true });
