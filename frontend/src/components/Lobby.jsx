import { useState } from 'react';
import { io } from 'socket.io-client';
import './Lobby.css';

const socket = io('http://localhost:3001');

function Lobby({ onJoinGame }) {
  const [username, setUsername] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState('');
  const [mode, setMode] = useState('menu'); // 'menu', 'create', 'join'

  const handleCreateRoom = () => {
    if (!username.trim()) {
      setError('Please enter a username');
      return;
    }

    socket.emit('createRoom', { username });
    
    socket.once('roomCreated', ({ roomCode }) => {
      onJoinGame(roomCode, username, true);
    });

    socket.once('error', ({ message }) => {
      setError(message);
    });
  };

  const handleJoinRoom = () => {
    if (!username.trim()) {
      setError('Please enter a username');
      return;
    }

    if (!roomCode.trim()) {
      setError('Please enter a room code');
      return;
    }

    socket.emit('joinRoom', { roomCode: roomCode.toUpperCase(), username });
    
    socket.once('roomJoined', ({ roomCode }) => {
      onJoinGame(roomCode, username, false);
    });

    socket.once('error', ({ message }) => {
      setError(message);
    });
  };

  return (
    <div className="lobby">
      <div className="lobby-container">
        <h1>Multiplayer Game</h1>
        
        {mode === 'menu' && (
          <div className="menu">
            <button className="btn btn-primary" onClick={() => setMode('create')}>
              Create Room
            </button>
            <button className="btn btn-secondary" onClick={() => setMode('join')}>
              Join Room
            </button>
          </div>
        )}

        {mode === 'create' && (
          <div className="form">
            <input
              type="text"
              placeholder="Enter your username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleCreateRoom()}
            />
            {error && <p className="error">{error}</p>}
            <button className="btn btn-primary" onClick={handleCreateRoom}>
              Create Room
            </button>
            <button className="btn btn-back" onClick={() => { setMode('menu'); setError(''); }}>
              Back
            </button>
          </div>
        )}

        {mode === 'join' && (
          <div className="form">
            <input
              type="text"
              placeholder="Enter your username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <input
              type="text"
              placeholder="Enter room code"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              onKeyPress={(e) => e.key === 'Enter' && handleJoinRoom()}
              maxLength={6}
            />
            {error && <p className="error">{error}</p>}
            <button className="btn btn-primary" onClick={handleJoinRoom}>
              Join Room
            </button>
            <button className="btn btn-back" onClick={() => { setMode('menu'); setError(''); }}>
              Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default Lobby;
export { socket };
