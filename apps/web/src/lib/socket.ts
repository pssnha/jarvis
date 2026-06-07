import { io, type Socket } from 'socket.io-client';

// Connect lazily (after auth) and send the session cookie.
export const socket: Socket = io({ autoConnect: false, withCredentials: true });
