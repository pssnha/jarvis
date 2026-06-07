import { useEffect, useRef, useState } from 'react';
import { socket } from '../lib/socket';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [connected, setConnected] = useState(socket.connected);
  const endRef = useRef<HTMLDivElement>(null);

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
    if (!text) return;
    setMessages((m) => [...m, { role: 'user', text }]);
    socket.emit('chat:message', { text });
    setInput('');
  }

  return (
    <div className="chatview">
      <div className="chat">
        {messages.length === 0 && (
          <p className="empty">
            Say hello to Jarvis… try “add a dentist appointment next Tuesday at 3pm”.
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
          placeholder={connected ? 'Message Jarvis…' : 'connecting…'}
        />
        <button onClick={send}>Send</button>
      </div>
    </div>
  );
}
