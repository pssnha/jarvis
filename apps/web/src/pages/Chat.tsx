import { useEffect, useRef, useState } from 'react';
import { socket } from '../lib/socket';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

type ChatSurface = 'calendar' | 'vacations' | 'general';

/** The assistant pane. It acts on whatever group the center pane is showing
 *  (`groupId`) and is scoped to the active page (`surface`). */
export function Chat({
  groupId,
  surface,
  onClose,
}: {
  groupId?: string | null;
  surface?: ChatSurface;
  onClose?: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [connected, setConnected] = useState(socket.connected);
  const endRef = useRef<HTMLDivElement>(null);

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

  const where = surface === 'vacations' ? 'this trip' : surface === 'calendar' ? 'the calendar' : 'the schedule';

  function send() {
    const text = input.trim();
    if (!text || !groupId) return;
    setMessages((m) => [...m, { role: 'user', text }]);
    socket.emit('chat:message', { text, groupId, surface });
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
            {groupId
              ? `Ask about ${where}, or make a change — e.g. “add a dentist appointment next Tuesday at 3pm”.`
              : 'Open a group on the Calendar or Vacations page to start.'}
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
          placeholder={!groupId ? 'No group selected' : connected ? 'Message Jarvis…' : 'connecting…'}
          disabled={!groupId}
        />
        <button onClick={send} disabled={!groupId}>
          Send
        </button>
      </div>
    </div>
  );
}
