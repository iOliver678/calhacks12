import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import fetch from 'node-fetch';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ["http://localhost:5173", "http://localhost:5174"],
    methods: ["GET", "POST"]
  }
});

// JLLM API Configuration
const JLLM_API_ENDPOINT = "https://janitorai.com/hackathon/completions";
const JLLM_API_KEY = "calhacks2047";

// Store game rooms
const rooms = new Map();

// NPC Definitions
const NPCs = {
  hardwareClerk: {
    id: 'hardwareClerk',
    name: 'Hardware Store Clerk',
    location: 'Hardware Store',
    systemPrompt: `You are a friendly but slightly paranoid hardware store clerk. You have a shovel in stock, but you're suspicious of people who want to buy it late at night. You gossip with the police officer sometimes. You remember conversations and get more suspicious if people's stories don't match. You can be convinced to sell the shovel if given a good reason. Keep responses under 100 words.`,
    inventory: ['shovel'],
    conversationHistory: [],
    pendingMessages: [], // Buffer for batching messages
    responseTimer: null  // Timer for delayed responses
  },
  policeOfficer: {
    id: 'policeOfficer',
    name: 'Police Officer',
    location: 'Police Station',
    systemPrompt: `You are a strict but somewhat gullible police officer at the station. You have helicopter keys but would NEVER give them to civilians under normal circumstances. However, you can be tricked with a convincing emergency story. You know the hardware store clerk and border guard. You've heard rumors about a bank robbery today. You remember all conversations. Keep responses under 100 words.`,
    inventory: ['helicopterKeys'],
    conversationHistory: [],
    pendingMessages: [],
    responseTimer: null
  },
  borderGuard: {
    id: 'borderGuard',
    name: 'Border Guard',
    location: 'Border Checkpoint',
    systemPrompt: `You are a stern border guard who takes your job VERY seriously. You've been alerted about a bank robbery and are on high alert. You check papers carefully and won't let anyone through without proper documentation or an extremely convincing story. You communicate with the police station. You remember everyone you talk to. Keep responses under 100 words.`,
    inventory: [],
    conversationHistory: [],
    pendingMessages: [],
    responseTimer: null
  },
  exitGuard: {
    id: 'exitGuard',
    name: 'Exit Guard',
    location: 'Exit Checkpoint',
    systemPrompt: `You are a border guard at the exit checkpoint. You take security very seriously and have been warned about the bank robbery. You won't let anyone through without a borderPass or a very convincing story. You are in contact with the main border patrol. Keep responses under 100 words.`,
    inventory: [],
    conversationHistory: [],
    pendingMessages: [],
    responseTimer: null
  }
};

// Load collision data
let collisionBoundaries = [];
try {
  const collisionsPath = join(__dirname, '..', 'frontend', 'public', 'data', 'collisions.js');
  const collisionsText = readFileSync(collisionsPath, 'utf-8');
  const collisionsMatch = collisionsText.match(/\[([\s\S]*)\]/);
  if (collisionsMatch) {
    const collisions = eval('[' + collisionsMatch[1] + ']');
    const collisionsMap = [];
    for (let i = 0; i < collisions.length; i += 120) {
      collisionsMap.push(collisions.slice(i, i + 120));
    }

    const paddingTiles = 10;
    const offsetX = 10;
    const offsetY = 10;

    collisionsMap.forEach((row, i) => {
      row.forEach((symbol, j) => {
        if (symbol === 1479 || symbol === 1475) {
          collisionBoundaries.push({
            x: (j - paddingTiles + offsetX) * 48,
            y: (i - paddingTiles + offsetY) * 48,
            width: 48,
            height: 48
          });
        }
      });
    });
  }
  console.log(`✅ Loaded ${collisionBoundaries.length} collision boundaries for police AI`);
} catch (err) {
  console.log('⚠️ Could not load collisions for police AI:', err.message);
}

// Check if position collides with boundaries
function checkPoliceCollision(x, y) {
  const margin = 60; // Police sprite size
  for (const boundary of collisionBoundaries) {
    if (
      x + margin > boundary.x &&
      x < boundary.x + boundary.width &&
      y + margin > boundary.y &&
      y < boundary.y + boundary.height
    ) {
      return true; // Collision detected
    }
  }
  return false; // No collision
}

// Generate random room code
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Spawn 3 police officers to chase players
function spawnPolice(room, roomCode, io) {
  const spawnPoint = { x: 2880, y: 2840 }; // Police station spawn
  
  room.police = [
    {
      id: 'police_0',
      position: { x: spawnPoint.x, y: spawnPoint.y },
      speed: 16, // Cascading speeds!
      sprite: { row: 4, frame: 0 },
      moving: true,
      lastPositions: [], // Track recent positions to detect being stuck
      stuckCounter: 0,
      lastDistanceToPlayer: Infinity,
      notAdvancingCounter: 0
    },
    {
      id: 'police_1',
      position: { x: spawnPoint.x, y: spawnPoint.y + 200 },
      speed: 17,
      sprite: { row: 4, frame: 0 },
      moving: true,
      lastPositions: [],
      stuckCounter: 0,
      lastDistanceToPlayer: Infinity,
      notAdvancingCounter: 0
    },
    {
      id: 'police_2',
      position: { x: spawnPoint.x, y: spawnPoint.y + 400 },
      speed: 18,
      sprite: { row: 4, frame: 0 },
      moving: true,
      lastPositions: [],
      stuckCounter: 0
    }
  ];

  console.log(`🚨 [POLICE] Spawned ${room.police.length} officers at (2180, 2840)`);
  room.police.forEach(cop => {
    console.log(`   👮 ${cop.id} at (${cop.position.x}, ${cop.position.y})`);
  });
  
  // Start police movement AI
  startPoliceAI(room, roomCode, io);
}

// Police AI - move toward closest player
function startPoliceAI(room, roomCode, io) {
  console.log(`🚨 [POLICE AI] Starting AI loop for room ${roomCode}`);
  let tickCount = 0;
  
  const policeInterval = setInterval(() => {
    const roomData = rooms.get(roomCode);
    tickCount++;
    
    // Stop if room doesn't exist or chase ended
    if (!roomData || !roomData.isBeingChased) {
      console.log(`🚨 [POLICE AI] Stopping - room gone or chase ended`);
      clearInterval(policeInterval);
      return;
    }

    // Stop if game is over
    if (roomData.gameWon || roomData.gameLost) {
      console.log(`🚨 [POLICE AI] Stopping - game over`);
      clearInterval(policeInterval);
      return;
    }
    
    // Log every 50 ticks (5 seconds)
    if (tickCount % 50 === 1) {
      console.log(`🚨 [POLICE AI] Tick ${tickCount} - ${roomData.police.length} police active`);
    }

    // Move each police toward closest player
    roomData.police.forEach(cop => {
      let closestPlayer = null;
      let closestDistance = Infinity;

      // Find closest player
      Object.values(roomData.players).forEach(player => {
        const distance = Math.sqrt(
          Math.pow(player.position.x - cop.position.x, 2) +
          Math.pow(player.position.y - cop.position.y, 2)
        );

        if (distance < closestDistance) {
          closestDistance = distance;
          closestPlayer = player;
        }
      });

      if (closestPlayer) {
        // Track position to detect being stuck
        const oldPos = { x: cop.position.x, y: cop.position.y };
        
        // Move toward closest player
        const dx = closestPlayer.position.x - cop.position.x;
        const dy = closestPlayer.position.y - cop.position.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // CHECK IF WE'RE MAKING PROGRESS
        const progressThreshold = cop.speed * 0.5; // Should advance at least half speed
        if (cop.lastDistanceToPlayer !== Infinity) {
          const distanceReduction = cop.lastDistanceToPlayer - distance;
          
          if (distanceReduction < progressThreshold) {
            // Not making good progress!
            cop.notAdvancingCounter++;
            if (cop.notAdvancingCounter === 3) {
              console.log(`⚠️ ${cop.id} not advancing (counter: ${cop.notAdvancingCounter}) - forcing alternative path!`);
            }
          } else {
            // Making good progress, reset counter
            if (cop.notAdvancingCounter > 0) {
              console.log(`✅ ${cop.id} making progress again! (was stuck for ${cop.notAdvancingCounter} ticks)`);
            }
            cop.notAdvancingCounter = Math.max(0, cop.notAdvancingCounter - 1);
          }
        }
        
        cop.lastDistanceToPlayer = distance;

        if (distance > 0) {
          // Calculate new position
          const newX = cop.position.x + (dx / distance) * cop.speed;
          const newY = cop.position.y + (dy / distance) * cop.speed;

          // ADVANCED PATHFINDING
          let moved = false;
          
          // If not advancing for 3+ ticks, FORCE alternative path immediately
          const forceAlternative = cop.notAdvancingCounter >= 3;
          
          if (!forceAlternative) {
            // 1. Try direct diagonal movement
            if (!checkPoliceCollision(newX, newY)) {
              cop.position.x = newX;
              cop.position.y = newY;
              moved = true;
            }
            // 2. Try dominant direction
            else if (Math.abs(dx) > Math.abs(dy)) {
              if (!checkPoliceCollision(newX, cop.position.y)) {
                cop.position.x = newX;
                moved = true;
              } else if (!checkPoliceCollision(cop.position.x, newY)) {
                cop.position.y = newY;
                moved = true;
              }
            } else {
              if (!checkPoliceCollision(cop.position.x, newY)) {
                cop.position.y = newY;
                moved = true;
              } else if (!checkPoliceCollision(newX, cop.position.y)) {
                cop.position.x = newX;
                moved = true;
              }
            }
          }
          
          // 3. Try 8-directional search (diagonals + cardinals)
          // Use wider radius if we're stuck
          if (!moved || forceAlternative) {
            const searchRadius = forceAlternative ? cop.speed * 4 : cop.speed * 2;
            const searchMoves = [
              // Cardinals
              { x: cop.position.x + searchRadius, y: cop.position.y },
              { x: cop.position.x - searchRadius, y: cop.position.y },
              { x: cop.position.x, y: cop.position.y + searchRadius },
              { x: cop.position.x, y: cop.position.y - searchRadius },
              // Diagonals
              { x: cop.position.x + searchRadius, y: cop.position.y + searchRadius },
              { x: cop.position.x - searchRadius, y: cop.position.y + searchRadius },
              { x: cop.position.x + searchRadius, y: cop.position.y - searchRadius },
              { x: cop.position.x - searchRadius, y: cop.position.y - searchRadius }
            ];
            
            let bestMove = null;
            let bestDistance = Infinity;
            
            for (const move of searchMoves) {
              if (!checkPoliceCollision(move.x, move.y)) {
                const dist = Math.sqrt(
                  Math.pow(closestPlayer.position.x - move.x, 2) +
                  Math.pow(closestPlayer.position.y - move.y, 2)
                );
                if (dist < bestDistance) {
                  bestDistance = dist;
                  bestMove = move;
                }
              }
            }
            
            if (bestMove) {
              cop.position.x = bestMove.x;
              cop.position.y = bestMove.y;
              moved = true;
            }
          }
          
          // 4. If STILL stuck, try aggressive random exploration
          if (!moved) {
            cop.stuckCounter++;
            
            // Activate exploration faster if not advancing
            const explorationThreshold = cop.notAdvancingCounter >= 5 ? 2 : 5;
            
            if (cop.stuckCounter > explorationThreshold) {
              // Explore randomly to get unstuck - very wide radius
              const exploreRadius = cop.speed * 5;
              const randomMoves = [];
              
              // Try 16 directions for better coverage
              for (let i = 0; i < 16; i++) {
                const angle = (Math.PI * 2 * i) / 16;
                randomMoves.push({
                  x: cop.position.x + Math.cos(angle) * exploreRadius,
                  y: cop.position.y + Math.sin(angle) * exploreRadius
                });
                // Also try half-radius for finer navigation
                randomMoves.push({
                  x: cop.position.x + Math.cos(angle) * (exploreRadius / 2),
                  y: cop.position.y + Math.sin(angle) * (exploreRadius / 2)
                });
              }
              
              // Shuffle and try random moves
              randomMoves.sort(() => Math.random() - 0.5);
              
              for (const move of randomMoves) {
                if (!checkPoliceCollision(move.x, move.y)) {
                  cop.position.x = move.x;
                  cop.position.y = move.y;
                  moved = true;
                  cop.stuckCounter = 0; // Reset stuck counter
                  cop.notAdvancingCounter = Math.max(0, cop.notAdvancingCounter - 2); // Reward finding path
                  console.log(`👮 ${cop.id} found alternative route via exploration!`);
                  break;
                }
              }
            }
          } else {
            // Successfully moved, reset stuck counter
            cop.stuckCounter = 0;
          }

          // Update sprite direction
          const actualDx = cop.position.x - oldPos.x;
          const actualDy = cop.position.y - oldPos.y;
          
          if (Math.abs(actualDx) > Math.abs(actualDy) && Math.abs(actualDx) > 0.1) {
            cop.sprite.row = actualDx > 0 ? 6 : 5;
          } else if (Math.abs(actualDy) > 0.1) {
            cop.sprite.row = actualDy > 0 ? 4 : 7;
          }

          // Animate sprite
          cop.sprite.frame = (cop.sprite.frame + 1) % 4;
        }

        // Check if caught (within 30 pixels - basically collision)
        if (distance < 30) {
          console.log(`🚨 [POLICE] ${cop.id} CAUGHT PLAYER! Distance: ${Math.round(distance)}px`);
          console.log(`   👮 Cop at (${Math.round(cop.position.x)}, ${Math.round(cop.position.y)})`);
          console.log(`   🏃 Player at (${Math.round(closestPlayer.position.x)}, ${Math.round(closestPlayer.position.y)})`);
          roomData.gameLost = true;
          roomData.arrested = true;
          clearInterval(policeInterval);
          io.to(roomCode).emit('gameOver', { won: false, reason: 'caught' });
          return;
        }
      }
    });

    // Broadcast police positions
    io.to(roomCode).emit('policeUpdate', { police: roomData.police });
  }, 100); // Update 10 times per second
}

// Chat with JLLM API
async function chatWithNPC(npcId, messages, roomCode) {
  const room = rooms.get(roomCode);
  if (!room || !room.npcs[npcId]) return null;

  const npc = room.npcs[npcId];
  
  // Build full conversation with system prompt
  const fullMessages = [
    { role: 'system', content: npc.systemPrompt },
    ...npc.conversationHistory,
    ...messages
  ];

  try {
    const response = await fetch(JLLM_API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${JLLM_API_KEY}`
      },
      body: JSON.stringify({
        model: 'jllm',
        messages: fullMessages,
        temperature: 0.8,
        max_tokens: 200,
        stream: true
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // Handle streaming response
    let fullResponse = '';
    const reader = response.body;
    
    for await (const chunk of reader) {
      const text = new TextDecoder().decode(chunk);
      const lines = text.split('\n');
      
      for (const line of lines) {
        if (line.trim() === '') continue;
        if (line.startsWith('data: ')) {
          const data_str = line.substring(6); // Remove 'data: ' prefix
          if (data_str === '[DONE]') break;
          
          try {
            const data = JSON.parse(data_str);
            if (data.choices && data.choices.length > 0) {
              const delta = data.choices[0].delta || {};
              const content = delta.content || '';
              if (content) {
                fullResponse += content;
              }
            }
          } catch (e) {
            // Skip invalid JSON lines
            continue;
          }
        }
      }
    }

    if (!fullResponse) {
      return 'I... uh... what?';
    }

    // Update NPC conversation history
    npc.conversationHistory.push(...messages);
    npc.conversationHistory.push({
      role: 'assistant',
      content: fullResponse
    });

    // Keep conversation history manageable (last 20 messages)
    if (npc.conversationHistory.length > 20) {
      npc.conversationHistory = npc.conversationHistory.slice(-20);
    }

    return fullResponse;
  } catch (error) {
    console.error('JLLM API Error:', error);
    return 'Sorry, I seem to be having trouble understanding you right now.';
  }
}

// Process pending NPC messages and generate response
async function processNPCResponse(roomCode, npcId) {
  console.log(`[processNPCResponse] Starting for ${npcId} in room ${roomCode}`);
  const room = rooms.get(roomCode);
  if (!room || !room.npcs[npcId]) {
    console.log('[processNPCResponse] Room or NPC not found');
    return;
  }

  const npc = room.npcs[npcId];
  const npcRoomId = `${roomCode}-npc-${npcId}`;

  // Clear the timer
  if (npc.responseTimer) {
    clearTimeout(npc.responseTimer);
    npc.responseTimer = null;
  }

  // If no pending messages, nothing to do
  if (npc.pendingMessages.length === 0) {
    console.log('[processNPCResponse] No pending messages');
    return;
  }

  // Get all pending messages
  const messagesToProcess = [...npc.pendingMessages];
  npc.pendingMessages = [];

  console.log(`[processNPCResponse] Processing ${messagesToProcess.length} messages`);
  
  // Send "typing" indicator
  console.log(`[processNPCResponse] Sending typing indicator to ${npcRoomId}`);
  io.to(npcRoomId).emit('npcTyping', { npcId, isTyping: true });

  // Get NPC response
  const npcResponse = await chatWithNPC(npcId, messagesToProcess, roomCode);

  console.log(`[processNPCResponse] Got response from chatWithNPC:`, npcResponse);

  if (npcResponse) {
    console.log(`[processNPCResponse] Broadcasting NPC response to ${npcRoomId}`);
    // Broadcast NPC response to all players in this NPC chat
    io.to(npcRoomId).emit('npcMessageReceived', {
      npcId,
      sender: room.npcs[npcId].name,
      message: npcResponse,
      isNPC: true,
      timestamp: Date.now()
    });
    console.log('[processNPCResponse] NPC response broadcast complete');

    // Check for item transfers based on keywords
    if (npcId === 'hardwareClerk' && npcResponse.toLowerCase().includes('here') && 
        npcResponse.toLowerCase().includes('shovel')) {
      if (!room.sharedInventory.includes('shovel')) {
        room.sharedInventory.push('shovel');
        io.to(roomCode).emit('itemReceived', { item: 'shovel', from: 'Hardware Store Clerk' });
      }
    }

    if (npcId === 'policeOfficer' && npcResponse.toLowerCase().includes('key') && 
        (npcResponse.toLowerCase().includes('take') || npcResponse.toLowerCase().includes('here'))) {
      if (!room.sharedInventory.includes('helicopterKeys')) {
        room.sharedInventory.push('helicopterKeys');
        io.to(roomCode).emit('itemReceived', { item: 'helicopterKeys', from: 'Police Officer' });
      }
    }

    if (npcId === 'borderGuard' && 
        (npcResponse.toLowerCase().includes('go ahead') || 
         npcResponse.toLowerCase().includes('pass through') ||
         npcResponse.toLowerCase().includes('cleared') ||
         npcResponse.toLowerCase().includes('approved'))) {
      if (!room.sharedInventory.includes('borderPass')) {
        room.sharedInventory.push('borderPass');
        room.borderPassGranted = true;
        io.to(roomCode).emit('itemReceived', { item: 'borderPass', from: 'Border Guard' });
      }
    }

    // Check for arrest - spawn police chase instead of instant game over
    const response = npcResponse.toLowerCase();
    const triggerWords = [
      'arrest', 'hands up', 'caught', 'backup', 'requesting backup',
      'police are on', 'detained', 'remain here', 'stay here', 
      'not going anywhere', 'wait for police', 'units en route'
    ];
    
    const isTriggered = (npcId === 'policeOfficer' || npcId === 'borderGuard' || npcId === 'exitGuard') &&
                        triggerWords.some(word => response.includes(word));
    
    if (isTriggered) {
      if (!room.isBeingChased) {
        console.log(`🚨 [CHASE] Triggered by ${npcId}! NPC said: "${npcResponse.substring(0, 80)}..."`);
        room.isBeingChased = true;
        spawnPolice(room, roomCode, io);
        io.to(roomCode).emit('chaseStarted', { message: '🚨 POLICE CHASE INITIATED! RUN!' });
        console.log(`🚨 [CHASE] Chase started event sent to room ${roomCode}`);
      } else {
        console.log(`🚨 [CHASE] Already being chased, ignoring new trigger from ${npcId}`);
      }
    } else if (npcId === 'policeOfficer' || npcId === 'borderGuard' || npcId === 'exitGuard') {
      // Log when these NPCs respond but don't trigger
      console.log(`ℹ️ [CHASE] ${npcId} responded but no trigger words found: "${npcResponse.substring(0, 80)}..."`);
    }

    // Check win condition
    if (checkWinCondition(room)) {
      room.gameWon = true;
      io.to(roomCode).emit('gameOver', { won: true, reason: 'escaped' });
    }
  }

  console.log(`[processNPCResponse] Sending typing:false to ${npcRoomId}`);
  io.to(npcRoomId).emit('npcTyping', { npcId, isTyping: false });
  console.log('[processNPCResponse] Complete');
}

// Check win conditions - now requires completing an escape action
function checkWinCondition(room) {
  // Win if any escape method is completed
  return room.completedActions.includes('digSite') || 
         room.completedActions.includes('helicopterPad') || 
         room.completedActions.includes('borderExit');
}

// Check lose conditions
function checkLoseCondition(room) {
  return room.arrested || room.timeUp;
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Create a new room
  socket.on('createRoom', ({ username }) => {
    const roomCode = generateRoomCode();
    const room = {
      code: roomCode,
      host: socket.id,
      players: {
        [socket.id]: {
          id: socket.id,
          username,
          position: { x: 512, y: 512 },
          sprite: { row: 0, frame: 0 },
          moving: false
        }
      },
      gameStarted: false,
      sharedInventory: [],
      npcs: JSON.parse(JSON.stringify(NPCs)), // Deep copy NPCs for this room
      currentLocation: 'map',
      arrested: false,
      crossedBorder: false,
      timeUp: false,
      gameWon: false,
      gameLost: false,
      completedActions: [], // Track which action zones have been used
      borderPassGranted: false, // Track if border guard approved passage
      isBeingChased: false, // Police chase active
      police: [] // Array of police NPCs chasing players
    };
    
    rooms.set(roomCode, room);
    socket.join(roomCode);
    socket.emit('roomCreated', { roomCode, room });
    console.log(`Room ${roomCode} created by ${username}`);
  });

  // Join existing room
  socket.on('joinRoom', ({ roomCode, username }) => {
    const room = rooms.get(roomCode);
    
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    if (Object.keys(room.players).length >= 4 && room.gameStarted) {
      socket.emit('error', { message: 'Room is full' });
      return;
    }

    room.players[socket.id] = {
      id: socket.id,
      username,
      position: { x: 512, y: 600 },
      sprite: { row: 0, frame: 0 },
      moving: false
    };

    socket.join(roomCode);
    socket.emit('roomJoined', { roomCode, room });
    io.to(roomCode).emit('playerJoined', { playerId: socket.id, player: room.players[socket.id] });
    console.log(`${username} joined room ${roomCode}`);
  });

  // Start game
  socket.on('startGame', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    if (room.host !== socket.id) {
      socket.emit('error', { message: 'Only host can start the game' });
      return;
    }

    if (Object.keys(room.players).length < 1) {
      socket.emit('error', { message: 'Need at least 1 player to start' });
      return;
    }

    room.gameStarted = true;
    io.to(roomCode).emit('gameStarted', { room });
    console.log(`Game started in room ${roomCode}`);
  });

  // Player movement
  socket.on('playerMove', ({ roomCode, position, sprite, moving }) => {
    const room = rooms.get(roomCode);
    
    if (!room || !room.players[socket.id]) {
      return;
    }

    room.players[socket.id].position = position;
    room.players[socket.id].sprite = sprite;
    room.players[socket.id].moving = moving;

    socket.to(roomCode).emit('playerMoved', {
      playerId: socket.id,
      position,
      sprite,
      moving
    });
  });

  // Enter NPC conversation
  socket.on('enterNPCChat', ({ roomCode, npcId }) => {
    console.log(`Player ${socket.id} entering NPC chat: ${npcId} in room ${roomCode}`);
    const room = rooms.get(roomCode);
    if (!room || !room.npcs[npcId]) {
      console.log('Error: Room or NPC not found');
      socket.emit('error', { message: 'NPC not found' });
      return;
    }

    const npc = room.npcs[npcId];
    
    // Join a specific room for this NPC chat
    const npcRoomId = `${roomCode}-npc-${npcId}`;
    socket.join(npcRoomId);
    console.log(`Player joined NPC room: ${npcRoomId}`);
    
    // Send full conversation history to the joining player
    const formattedHistory = npc.conversationHistory.map(msg => {
      if (msg.role === 'user') {
        // Extract username from "Username: message" format
        const match = msg.content.match(/^(.+?):\s*(.+)$/);
        if (match) {
          return {
            sender: match[1],
            message: match[2],
            isNPC: false
          };
        }
      } else if (msg.role === 'assistant') {
        return {
          sender: npc.name,
          message: msg.content,
          isNPC: true
        };
      }
      return null;
    }).filter(msg => msg !== null);
    
    console.log(`Sending ${formattedHistory.length} messages of history to player`);
    
    socket.emit('npcChatEntered', { 
      npcId, 
      npcName: npc.name,
      location: npc.location,
      conversationHistory: formattedHistory
    });
  });

  // Leave NPC conversation
  socket.on('leaveNPCChat', ({ roomCode, npcId }) => {
    const npcRoomId = `${roomCode}-npc-${npcId}`;
    socket.leave(npcRoomId);
  });

  // Send message to NPC
  socket.on('sendNPCMessage', async ({ roomCode, npcId, message }) => {
    console.log(`Player sending message to ${npcId}:`, message);
    const room = rooms.get(roomCode);
    if (!room || !room.npcs[npcId]) {
      console.log('Error: Room or NPC not found for message');
      return;
    }

    const player = room.players[socket.id];
    if (!player) {
      console.log('Error: Player not found');
      return;
    }

    const npc = room.npcs[npcId];
    const npcRoomId = `${roomCode}-npc-${npcId}`;
    
    console.log(`Broadcasting message to room: ${npcRoomId}`);
    
    // Broadcast the user message to all players in this NPC chat immediately
    io.to(npcRoomId).emit('npcMessageReceived', {
      npcId,
      sender: player.username,
      message: message,
      isNPC: false,
      timestamp: Date.now()
    });

    const userMessage = {
      role: 'user',
      content: `${player.username}: ${message}`
    };

    // Add message to pending buffer
    npc.pendingMessages.push(userMessage);
    console.log(`Pending messages for ${npcId}:`, npc.pendingMessages.length);

    // Clear existing timer if any
    if (npc.responseTimer) {
      clearTimeout(npc.responseTimer);
    }

    // Check if we should respond immediately (2 or more messages)
    if (npc.pendingMessages.length >= 2) {
      console.log('Processing NPC response immediately (2+ messages)');
      // Process immediately
      await processNPCResponse(roomCode, npcId);
    } else {
      // Set timer to respond after 3 seconds if no more messages
      npc.responseTimer = setTimeout(async () => {
        await processNPCResponse(roomCode, npcId);
      }, 3000);
    }
  });

  // Get game state
  socket.on('getGameState', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    socket.emit('gameStateUpdate', {
      sharedInventory: room.sharedInventory,
      arrested: room.arrested,
      crossedBorder: room.crossedBorder,
      gameWon: room.gameWon,
      gameLost: room.gameLost,
      completedActions: room.completedActions
    });
  });

  // Perform action at an action zone
  socket.on('performAction', ({ roomCode, actionId }) => {
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    const player = room.players[socket.id];
    if (!player) {
      socket.emit('error', { message: 'Player not found' });
      return;
    }

    // Define required items for each action
    const actionRequirements = {
      digSite: 'shovel',
      helicopterPad: 'helicopterKeys',
      borderExit: 'borderPass'
    };

    const requiredItem = actionRequirements[actionId];
    if (!requiredItem) {
      socket.emit('error', { message: 'Invalid action' });
      return;
    }

    // Check if player has required item
    if (!room.sharedInventory.includes(requiredItem)) {
      socket.emit('error', { message: `You need a ${requiredItem} to perform this action` });
      return;
    }

    // Check if action already completed
    if (room.completedActions.includes(actionId)) {
      socket.emit('error', { message: 'This action has already been completed' });
      return;
    }

    // Mark action as completed
    room.completedActions.push(actionId);

    // Determine success message
    let message = '';
    let won = false;
    
    if (actionId === 'digSite') {
      message = '💎 You dug a tunnel and found the escape route! You win!';
      won = true;
    } else if (actionId === 'helicopterPad') {
      message = '🚁 You started the helicopter and escaped! You win!';
      won = true;
    } else if (actionId === 'borderExit') {
      message = '🛂 You crossed the border successfully! You win!';
      room.crossedBorder = true;
      won = true;
    }

    // Broadcast to all players
    io.to(roomCode).emit('actionCompleted', { 
      action: actionId, 
      message,
      completedBy: player.username
    });

    // Check win condition
    if (won) {
      room.gameWon = true;
      io.to(roomCode).emit('gameOver', { won: true, reason: 'escaped' });
    }

    console.log(`Player ${player.username} completed action: ${actionId}`);
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    rooms.forEach((room, roomCode) => {
      if (room.players[socket.id]) {
        delete room.players[socket.id];
        
        io.to(roomCode).emit('playerLeft', { playerId: socket.id });
        
        if (Object.keys(room.players).length === 0 || room.host === socket.id) {
          rooms.delete(roomCode);
          console.log(`Room ${roomCode} deleted`);
        }
      }
    });
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
