import { useState, useEffect, useRef } from 'react';
import './NPCChat.css';

function NPCChat({ socket, roomCode, npcId, npcName, location, onClose }) {
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [forceUpdate, setForceUpdate] = useState(0);
  const messagesEndRef = useRef(null);
  const npcIdRef = useRef(npcId);

  // Update ref when npcId changes
  useEffect(() => {
    npcIdRef.current = npcId;
  }, [npcId]);

  // Emit enterNPCChat when component mounts to get initial history
  useEffect(() => {
    console.log('NPCChat mounted, entering chat for:', npcId);
    socket.emit('enterNPCChat', { roomCode, npcId });
  }, [socket, roomCode, npcId]);

  // Set up socket event listeners - MUST stay active while component is mounted
  useEffect(() => {
    console.log('Setting up socket event listeners for', npcId);
    
    // Listen for initial conversation history
    function handleChatEntered(data) {
      console.log('EVENT RECEIVED: npcChatEntered', data);
      const { npcId: enteredNpcId, conversationHistory } = data;
      if (enteredNpcId === npcIdRef.current && conversationHistory) {
        console.log('Setting initial messages:', conversationHistory.length);
        setMessages([...conversationHistory]); // Force new array
        setForceUpdate(prev => prev + 1); // Force re-render
      }
    }

    // Listen for NPC messages
    function handleNPCMessage(data) {
      console.log('EVENT RECEIVED: npcMessageReceived', data);
      const { npcId: msgNpcId, sender, message, isNPC, timestamp } = data;
      if (msgNpcId === npcIdRef.current) {
        console.log('Adding message to state');
        setMessages(prev => {
          const newMsg = { sender, message, isNPC, timestamp: timestamp || Date.now() };
          const updated = [...prev, newMsg];
          console.log('Updated messages array:', updated);
          return updated;
        });
        setForceUpdate(prev => prev + 1); // Force re-render
      }
    }

    // Listen for typing indicator
    function handleNPCTyping(data) {
      console.log('EVENT RECEIVED: npcTyping', data);
      const { npcId: typingNpcId, isTyping: typing } = data;
      if (typingNpcId === npcIdRef.current) {
        setIsTyping(typing);
      }
    }

    // Handle Escape key to close chat
    function handleEscapeKey(e) {
      if (e.key === 'Escape') {
        onClose();
      }
    }

    console.log('Registering socket listeners...');
    socket.on('npcChatEntered', handleChatEntered);
    socket.on('npcMessageReceived', handleNPCMessage);
    socket.on('npcTyping', handleNPCTyping);
    window.addEventListener('keydown', handleEscapeKey);
    console.log('Socket listeners registered!');

    return () => {
      console.log('Cleaning up socket listeners');
      socket.off('npcChatEntered', handleChatEntered);
      socket.off('npcMessageReceived', handleNPCMessage);
      socket.off('npcTyping', handleNPCTyping);
      window.removeEventListener('keydown', handleEscapeKey);
      socket.emit('leaveNPCChat', { roomCode, npcId });
    };
  }, [socket, roomCode, npcId, onClose]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, forceUpdate]);

  // Debug: Log when messages change
  useEffect(() => {
    console.log('Messages state updated, count:', messages.length, 'messages:', messages);
  }, [messages, forceUpdate]);

  const sendMessage = () => {
    if (!inputMessage.trim()) return;

    console.log('Sending message:', inputMessage);
    
    socket.emit('sendNPCMessage', {
      roomCode,
      npcId,
      message: inputMessage
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
        onClose();
      }
    }}>
      <div className="npc-chat-container">
        <div className="npc-chat-header">
          <div className="npc-info">
            <div className="npc-name">{npcName}</div>
            <div className="npc-location">{location}</div>
          </div>
          <button className="close-btn" onClick={onClose} title="Close (ESC)">✕</button>
        </div>

        <div className="npc-chat-messages" key={forceUpdate}>
          {messages.length === 0 && (
            <div style={{ color: '#666', textAlign: 'center', padding: '20px' }}>
              No messages yet. Say hello!
            </div>
          )}
          {messages.map((msg, idx) => (
            <div 
              key={`${msg.timestamp}-${idx}`}
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
