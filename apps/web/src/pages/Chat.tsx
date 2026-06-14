import { useCallback, useEffect, useRef, useState } from 'react';
import { socket } from '../lib/socket';
import { getCircleUsage } from '../lib/api';
import type { CircleUsage } from '../lib/types';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

function fmtCost(n: number): string {
  return '$' + (n >= 1 ? n.toFixed(2) : n.toFixed(4));
}

type ChatSurface = 'calendar' | 'vacations' | 'general';

/** The assistant pane. It acts on whatever circle + scope the center pane is
 *  showing, and is scoped to the active page (`surface`). */
export function Chat({
  circleId,
  scope,
  surface,
  onClose,
}: {
  circleId?: string | null;
  scope?: string;
  surface?: ChatSurface;
  onClose?: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [connected, setConnected] = useState(socket.connected);
  const [usage, setUsage] = useState<CircleUsage | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Current spend vs caps; refreshed on circle switch and after each reply
  // (the assistant fires jarvis:refresh, by which point spend has risen).
  const refreshUsage = useCallback(() => {
    if (!circleId) return setUsage(null);
    getCircleUsage(circleId)
      .then(setUsage)
      .catch(() => {});
  }, [circleId]);

  useEffect(() => {
    refreshUsage();
    window.addEventListener('jarvis:refresh', refreshUsage);
    return () => window.removeEventListener('jarvis:refresh', refreshUsage);
  }, [refreshUsage]);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onReply = (data: { text: string }) => {
      setMessages((m) => [...m, { role: 'assistant', text: data.text }]);
      // The assistant may have changed events/trip items — nudge the open pane.
      window.dispatchEvent(new Event('jarvis:refresh'));
    };
    const onError = (data: { message: string }) =>
      setMessages((m) => [...m, { role: 'assistant', text: `⚠️ ${data.message}` }]);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('chat:reply', onReply);
    socket.on('chat:error', onError);
    socket.connect();
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('chat:reply', onReply);
      socket.off('chat:error', onError);
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const where =
    surface === 'vacations' ? 'this trip' : surface === 'calendar' ? 'the calendar' : 'the schedule';

  function send() {
    const text = input.trim();
    if (!text || !circleId) return;
    setMessages((m) => [...m, { role: 'user', text }]);
    socket.emit('chat:message', { text, circleId, scope, surface });
    setInput('');
  }

  return (
    <div className="chatview">
      <div className="chat-head">
        <span className="chat-title">Ask Jarvis</span>
        {onClose && (
          <button className="chat-close" onClick={onClose} aria-label="Close assistant">
            ✕
          </button>
        )}
      </div>
      <div className="chat">
        {messages.length === 0 && (
          <p className="empty">
            {circleId
              ? `Ask about ${where}, or make a change — e.g. “add a dentist appointment next Tuesday at 3pm”.`
              : 'Open a circle on the Calendar or Vacations page to start.'}
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.text}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="composer">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
          placeholder={!circleId ? 'No circle selected' : connected ? 'Message Jarvis…' : 'connecting…'}
          disabled={!circleId}
        />
        <button onClick={send} disabled={!circleId}>
          Send
        </button>
      </div>
      {circleId && usage && (
        <div className={`chat-usage${usage.blocked ? ' over' : ''}`}>
          Today {fmtCost(usage.dailyUsd)} / {fmtCost(usage.dailyLimit)} · Month{' '}
          {fmtCost(usage.monthlyUsd)} / {fmtCost(usage.monthlyLimit)}
        </div>
      )}
    </div>
  );
}
