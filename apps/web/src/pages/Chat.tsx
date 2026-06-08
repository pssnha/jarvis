import { useEffect, useRef, useState } from 'react';
import { socket } from '../lib/socket';
import { listGroups } from '../lib/api';
import type { GroupSummary } from '../lib/types';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export function Chat() {
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [groupId, setGroupId] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [connected, setConnected] = useState(socket.connected);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listGroups()
      .then((gs) => {
        setGroups(gs);
        setGroupId((id) => id || gs[0]?.id || '');
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onReply = (data: { text: string }) =>
      setMessages((m) => [...m, { role: 'assistant', text: data.text }]);
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

  function send() {
    const text = input.trim();
    if (!text || !groupId) return;
    setMessages((m) => [...m, { role: 'user', text }]);
    socket.emit('chat:message', { text, groupId });
    setInput('');
  }

  if (groups.length === 0) {
    return (
      <div className="chatview">
        <p className="empty">
          No groups yet. Connect WhatsApp or add a group in the Admin tab, then chat here.
        </p>
      </div>
    );
  }

  return (
    <div className="chatview">
      <div className="chat-toolbar">
        <label className="muted">Group&nbsp;</label>
        <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>
      <div className="chat">
        {messages.length === 0 && (
          <p className="empty">Ask Jarvis anything, or e.g. “add a dentist appointment next Tuesday at 3pm”.</p>
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
          placeholder={connected ? 'Message Jarvis…' : 'connecting…'}
        />
        <button onClick={send}>Send</button>
      </div>
    </div>
  );
}
