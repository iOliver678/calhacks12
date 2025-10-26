import { useState, useEffect, useRef } from 'react';
import './NPCChat.css';

function NPCChat({ socket, roomCode, npcId, npcName, location, onClose, username }) {
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef(null);
  const npcIdRef = useRef(npcId);

  // Update ref when npcId changes
  useEffect(() => {
    npcIdRef.current = npcId;
  }, [npcId]);

  // Emit enterNPCChat when component mounts to get initial history
  useEffect(() => {
    console.log('🎬 NPCChat mounted for', npcId);
    socket.emit('enterNPCChat', { roomCode, npcId });
    return () => {
      console.log('💀 NPCChat unmounting for', npcId);
    };
  }, [socket, roomCode, npcId]);

  // Set up socket event listeners - MUST stay active while component is mounted
  useEffect(() => {
    // Listen for initial conversation history
    function handleChatEntered(data) {
      console.log('📚 Chat history received:', data);
      const { npcId: enteredNpcId, conversationHistory } = data;
      if (enteredNpcId === npcIdRef.current && conversationHistory) {
        console.log('📖 Loading', conversationHistory.length, 'history messages');
        // Add unique IDs to history messages if they don't have them
        const messagesWithIds = conversationHistory.map((msg, idx) => ({
          ...msg,
          id: msg.id || `history-${msg.timestamp}-${idx}`
        }));
        setMessages(messagesWithIds);
      }
    }

    // Listen for NPC messages
    function handleNPCMessage(data) {
      console.log('📨 Message received:', data);
      const { npcId: msgNpcId, sender, message, isNPC, timestamp } = data;
      console.log('🔍 Checking NPC match:', msgNpcId, '===', npcIdRef.current, '?', msgNpcId === npcIdRef.current);
      if (msgNpcId === npcIdRef.current) {
        const newMsg = { 
          id: `${Date.now()}-${Math.random()}`,
          sender, 
          message, 
          isNPC, 
          timestamp: timestamp || Date.now() 
        };
        console.log('✅ Adding message to state:', newMsg);
        setMessages(prev => {
          console.log('📦 Current messages before adding:', prev.length);
          // Skip if this looks like a duplicate of the last message (within 2 seconds)
          const lastMsg = prev[prev.length - 1];
          console.log('🔍 Last message:', lastMsg);
          console.log('🔍 New message:', { message, isNPC, sender });
          
          if (lastMsg && 
              lastMsg.message === message && 
              !isNPC && 
              Date.now() - lastMsg.timestamp < 2000) {
            console.log('⏭️ Skipping duplicate player message (same text, not NPC, within 2s)');
            return prev;
          }
          
          const updated = [...prev, newMsg];
          console.log('📊 Total messages after update:', updated.length);
          return updated;
        });
      } else {
        console.log('❌ Message not for this NPC, ignoring');
      }
    }

    // Listen for typing indicator
    function handleNPCTyping(data) {
      console.log('⌨️ Typing status:', data);
      const { npcId: typingNpcId, isTyping: typing } = data;
      if (typingNpcId === npcIdRef.current) {
        console.log('✏️ Setting typing to:', typing);
        setIsTyping(typing);
      }
    }

    // Handle Escape key to close chat
    function handleEscapeKey(e) {
      if (e.key === 'Escape') {
        console.log('⌨️ ESC pressed, closing chat');
        onClose();
      }
    }

    socket.on('npcChatEntered', handleChatEntered);
    socket.on('npcMessageReceived', handleNPCMessage);
    socket.on('npcTyping', handleNPCTyping);
    window.addEventListener('keydown', handleEscapeKey);

    return () => {
      socket.off('npcChatEntered', handleChatEntered);
      socket.off('npcMessageReceived', handleNPCMessage);
      socket.off('npcTyping', handleNPCTyping);
      window.removeEventListener('keydown', handleEscapeKey);
      socket.emit('leaveNPCChat', { roomCode, npcId });
    };
  }, [socket, roomCode, npcId, onClose]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Debug: Log when messages state updates
  useEffect(() => {
    console.log('🔄 Messages state changed, rendering', messages.length, 'messages');
  }, [messages]);

  const sendMessage = () => {
    if (!inputMessage.trim()) return;
    
    const messageText = inputMessage;
    console.log('📤 Sending message:', messageText);
    
    // Immediately add player's message to UI (optimistic update)
    const playerMsg = {
      id: `player-${Date.now()}-${Math.random()}`,
      sender: username,
      message: messageText,
      isNPC: false,
      timestamp: Date.now()
    };
    console.log('💬 Adding optimistic message:', playerMsg);
    setMessages(prev => [...prev, playerMsg]);
    
    socket.emit('sendNPCMessage', {
      roomCode,
      npcId,
      message: messageText
    });

    setInputMessage('');
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="npc-chat-overlay" onClick={(e) => {
      // Close if clicking on overlay (not the container)
      if (e.target.className === 'npc-chat-overlay') {
        console.log('🖱️ Clicked overlay, closing chat');
        onClose();
      }
    }}>
      <div className="npc-chat-container">
        <div className="npc-chat-header">
          <div className="npc-info">
            <div className="npc-name">{npcName}</div>
            <div className="npc-location">{location} • {messages.length} msgs</div>
          </div>
          <button className="close-btn" onClick={() => { console.log('❌ Close button clicked'); onClose(); }} title="Close (ESC)">✕</button>
        </div>

        <div className="npc-chat-messages">
          {messages.length === 0 && (
            <div style={{ color: '#666', textAlign: 'center', padding: '20px' }}>
              No messages yet. Say hello!
            </div>
          )}
          {messages.map((msg, idx) => (
            <div 
              key={msg.id || `${msg.timestamp}-${idx}`}
              className={`message ${msg.isNPC ? 'npc-message' : 'player-message'}`}
            >
              <div className="message-sender">{msg.sender}</div>
              <div className="message-content">{msg.message}</div>
            </div>
          ))}
          {isTyping && (
            <div className="message npc-message typing">
              <div className="message-sender">{npcName}</div>
              <div className="message-content">
                <span className="typing-indicator">
                  <span></span><span></span><span></span>
                </span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="npc-chat-input">
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Type your message..."
            autoFocus
          />
          <button onClick={sendMessage} disabled={!inputMessage.trim()}>
            Send
          </button>
        </div>
        
        <div className="npc-chat-hint">
          <span>ESC to close</span>
        </div>
      </div>
    </div>
  );
}

export default NPCChat;
