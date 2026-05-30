import { createSignal, createEffect, onMount, onCleanup, Show } from 'solid-js';
import { EventBus } from '../game/EventBus';
import type { ChatMessage } from "../../shared/interfaces/ChatMessage";

interface Entry extends ChatMessage {
  timeLabel: string;
}

const fmtColor = (c?: number) => c ? `#${c.toString(16).padStart(6, '0')}` : '#4af';

const Chat = () => {
  const [messages, setMessages] = createSignal<Entry[]>([]);
  const [hovered, setHovered] = createSignal(false);
  const [focused, setFocused] = createSignal(false);

  let listRef: HTMLDivElement | undefined;
  let inputRef: HTMLInputElement | undefined;
  let scrolledToBottom = true;

  const scrollToBottom = () => {
    if (listRef && scrolledToBottom) {
      listRef.scrollTop = listRef.scrollHeight;
    }
  };

  const handleScroll = () => {
    if (!listRef) return;
    const threshold = 30;
    scrolledToBottom =
      listRef.scrollTop + listRef.clientHeight >= listRef.scrollHeight - threshold;
  };

  onMount(() => {
    const handler = (msg: ChatMessage) => {
      const d = new Date(msg.timestamp);
      const timeLabel = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      setMessages((prev) => [...prev, { ...msg, timeLabel }]);
      requestAnimationFrame(scrollToBottom);
    };
    EventBus.on('chat-message', handler);

    onCleanup(() => {
      EventBus.removeListener('chat-message', handler);
    });
  });

  createEffect(() => {
    if (!hovered() && !focused()) {
      scrolledToBottom = true;
      requestAnimationFrame(scrollToBottom);
    }
  });

  const send = () => {
    const value = inputRef?.value.trim();
    if (!value) return;
    EventBus.emit('chat-send', value);
    if (inputRef) inputRef.value = '';
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      send();
    }
  };

  const opacity = () => {
    if (focused()) return 1;
    if (hovered()) return 0.8;
    return 0.3;
  };

  const showInput = () => hovered() || focused();
  const overflow = () => (hovered() || focused() ? 'auto' : 'hidden');

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '10px',
        right: '10px',
        width: '360px',
        'max-height': '320px',
        'background-color': 'rgba(0, 0, 0, 0.7)',
        color: '#e0e0e0',
        'font-family': 'monospace',
        'font-size': '14px',
        'border-radius': '6px',
        'z-index': 1000,
        'pointer-events': 'auto',
        display: 'flex',
        'flex-direction': 'column',
        transition: 'opacity 0.2s ease',
        opacity: opacity(),
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setFocused(false);
      }}
    >
      <div
        ref={listRef}
        onScroll={handleScroll}
        style={{
          'overflow-y': overflow(),
          'overflow-x': 'hidden',
          padding: '6px 8px',
          'word-break': 'break-word',
          'max-height': '260px',
          'min-height': focused() ? '0' : 'auto',
        }}
      >
        <Show when={messages().length === 0}>
          <div style={{ color: '#666' }}>No messages yet</div>
        </Show>
        <Show when={messages().length > 0}>
          {messages().map((msg) => (
            <div style={{ 'line-height': '1.4' }}>
              <span style={{ color: '#888', 'margin-right': '6px' }}>{msg.timeLabel}</span>
              <Show when={msg.type === 'player' && msg.playerId}>
                <span style={{ color: fmtColor(msg.color), 'margin-right': '6px' }}>{msg.playerId!.substring(0, 16)}</span>
              </Show>
              {msg.text}
            </div>
          ))}
        </Show>
      </div>

      <Show when={showInput()}>
        <div style={{
          padding: '4px 8px',
          'padding-top': '0',
          'border-top': '1px solid rgba(255,255,255,0.1)',
        }}>
          <input
            ref={inputRef}
            type="text"
            placeholder="Say something..."
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={{
              width: '100%',
              'box-sizing': 'border-box',
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.15)',
              'border-radius': '4px',
              color: '#e0e0e0',
              padding: '4px 8px',
              'font-family': 'monospace',
              'font-size': '14px',
              outline: 'none',
            }}
          />
        </div>
      </Show>
    </div>
  );
};

export default Chat;
