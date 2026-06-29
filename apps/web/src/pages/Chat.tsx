import { useCallback, useEffect, useRef, useState } from 'react';
import { socket } from '../lib/socket';
import { getCircleUsage, getCircleChat, uploadItinerary } from '../lib/api';
import type { CircleUsage, Me } from '../lib/types';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  author?: string | null;
  at?: string;
  via?: string; // web | whatsapp | telegram
}

function fmtCost(n: number): string {
  return '$' + (n >= 1 ? n.toFixed(2) : n.toFixed(4));
}

const VIA_LABEL: Record<string, string> = { web: 'Web', whatsapp: 'WhatsApp', telegram: 'Telegram' };

/** Footnote shown under a message: who · when · from where. */
function footnote(m: ChatMessage): string {
  const who = m.role === 'assistant' ? 'Jarvis' : m.author || 'You';
  const parts = [who];
  if (m.at) {
    const d = new Date(m.at);
    const today = new Date().toDateString() === d.toDateString();
    parts.push(
      today
        ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
        : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
    );
  }
  if (m.role !== 'assistant' && m.via) parts.push(VIA_LABEL[m.via] ?? m.via);
  return parts.join(' · ');
}

type ChatSurface = 'calendar' | 'vacations' | 'general';

/** The assistant pane. It acts on whatever circle + scope the center pane is
 *  showing, and is scoped to the active page (`surface`). */
export function Chat({
  circleId,
  scope,
  surface,
  me,
  onClose,
}: {
  circleId?: string | null;
  scope?: string;
  surface?: ChatSurface;
  me?: Me | null;
  onClose?: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [connected, setConnected] = useState(socket.connected);
  const [usage, setUsage] = useState<CircleUsage | null>(null);
  const [uploading, setUploading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Load the stored conversation for the active circle + scope so history
  // survives reloads and reopening the pane, and resets when you switch circles.
  useEffect(() => {
    if (!circleId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    getCircleChat(circleId, scope)
      .then((rows) => {
        if (!cancelled) setMessages(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [circleId, scope]);

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
      setMessages((m) => [...m, { role: 'assistant', text: data.text, at: new Date().toISOString() }]);
      // The assistant may have changed events/trip items — nudge the open pane.
      window.dispatchEvent(new Event('jarvis:refresh'));
    };
    const onError = (data: { message: string }) =>
      setMessages((m) => [
        ...m,
        { role: 'assistant', text: `⚠️ ${data.message}`, at: new Date().toISOString() },
      ]);

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
  // Shown in the header so it's clear which page the chat is bound to — it
  // follows the active page, and only that page's tools are available here.
  const modeLabel =
    surface === 'vacations' ? '✈️ Trips' : surface === 'calendar' ? '📅 Calendar' : '🗓️ Schedule';

  // Grow the textarea with its content, up to a cap (then it scrolls).
  function autoresize() {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  const myName = me?.name || me?.email || undefined;

  function send() {
    const text = input.trim();
    if (!text || !circleId) return;
    setMessages((m) => [
      ...m,
      { role: 'user', text, author: myName ?? 'You', at: new Date().toISOString(), via: 'web' },
    ]);
    socket.emit('chat:message', { text, circleId, scope, surface, authorName: myName });
    setInput('');
    requestAnimationFrame(autoresize); // shrink back to one line
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-uploading the same file
    if (!file || !circleId) return;
    setMessages((m) => [...m, { role: 'user', text: `📎 ${file.name}` }]);
    setUploading(true);
    uploadItinerary(circleId, file, scope)
      .then((res) => {
        setMessages((m) => [...m, { role: 'assistant', text: res.reply }]);
        window.dispatchEvent(new Event('jarvis:refresh'));
      })
      .catch((err: Error) =>
        setMessages((m) => [...m, { role: 'assistant', text: `⚠️ ${err.message}` }]),
      )
      .finally(() => setUploading(false));
  }

  return (
    <div className="chatview">
      <div className="chat-head">
        <span className="chat-title">Ask Jarvis</span>
        {circleId && <span className="chat-mode" title="The chat follows the page you're on">{modeLabel}</span>}
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
          <div key={i} className={`msg-wrap ${m.role}`}>
            <div className={`msg ${m.role}`}>{m.text}</div>
            <span className="msg-foot">{footnote(m)}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="composer">
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,image/*"
          hidden
          onChange={onPickFile}
        />
        <button
          className="composer-attach"
          onClick={() => fileRef.current?.click()}
          disabled={!circleId || uploading}
          title="Upload an itinerary (PDF or image)"
          aria-label="Upload an itinerary"
        >
          {uploading ? '…' : '📎'}
        </button>
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            autoresize();
          }}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter inserts a newline.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={!circleId ? 'No circle selected' : connected ? 'Message Jarvis… (Shift+Enter for a new line)' : 'connecting…'}
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
