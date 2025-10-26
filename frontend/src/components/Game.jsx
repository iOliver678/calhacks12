import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { socket } from './Lobby';
import NPCChat from './NPCChat';
import './Game.css';

// NPC interaction zones (world coordinates) - adjusted to be inside the map
const NPC_ZONES = {
  hardwareClerk: { 
    x: 2842, 
    y: 872, 
    radius: 1, // Small radius - only used for positioning
    name: 'Hardware Store',
    color: '#ff4444',
    spriteRow: 0, // Which sprite row to use (0 = idle down, 7 = up, etc.)
    spriteOffset: { x: 0, y: 0 } // Offset to fine-tune sprite position
  },
  policeOfficer: { 
    x: 4106, 
    y: 4306, 
    radius: 1, // Small radius - only used for positioning
    name: 'Police Station',
    color: '#4444ff',
    spriteRow: 0,
    spriteOffset: { x: 0, y: 0 }
  },
  borderGuard: { 
    x: 730, 
    y: 4992, 
    radius: 1, // Small radius - only used for positioning
    name: 'Border Patrol',
    color: '#ff8800',
    spriteRow: 0,
    spriteOffset: { x: 0, y: 0 }
  },
  exitGuard: {
    x: 674,
    y: 1616,
    radius: 1, // Small radius - only used for positioning
    name: 'Exit Checkpoint',
    color: '#ff8800',
    spriteRow: 0,
    spriteOffset: { x: 0, y: 0 }
  }
};

// Action zones - require specific items to interact
const ACTION_ZONES = {
  digSite: {
    x: 1330,
    y: 3585,
    radius: 60,
    name: 'Suspicious Ground',
    requiredItem: 'shovel',
    color: '#9d4edd',
    action: 'dig',
    description: 'Dig for escape tunnel'
  },
  helicopterPad: {
    x: 4620,
    y: 5000,
    radius: 70,
    name: 'Helicopter Pad',
    requiredItem: 'helicopterKeys',
    color: '#06ffa5',
    action: 'fly',
    description: 'Escape by helicopter'
  },
  borderExit: {
    x: 674,
    y: 1616,
    radius: 65,
    name: 'Border Exit',
    requiredItem: 'borderPass',
    color: '#ffbe0b',
    action: 'cross',
    description: 'Cross the border'
  }
};

function Game({ roomCode, username, isHost, onLeave }) {
  const canvasRef = useRef(null);
  const audioRef = useRef(null);
  const [gameStarted, setGameStarted] = useState(false);
  const [players, setPlayers] = useState({});
  const [waitingForPlayers, setWaitingForPlayers] = useState(true);
  const [activeNPC, setActiveNPC] = useState(null);
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);
  
  // Debug: log activeNPC changes
  useEffect(() => {
    console.log('🎯 activeNPC changed to:', activeNPC);
  }, [activeNPC]);
  const [inventory, setInventory] = useState([]);
  const [gameOver, setGameOver] = useState(null);
  const [nearbyNPC, setNearbyNPC] = useState(null);
  const [nearbyAction, setNearbyAction] = useState(null);
  const [completedActions, setCompletedActions] = useState([]);
  const [winningAction, setWinningAction] = useState(null);
  const [winningPlayer, setWinningPlayer] = useState(null);
  
  // Refs to access current values without restarting animation loop
  const inventoryRef = useRef([]);
  const completedActionsRef = useRef([]);
  const nearbyNPCRef = useRef(null);
  const nearbyActionRef = useRef(null);
  const activeNPCRef = useRef(null);
  
  const gameStateRef = useRef({
    background: { x: -2370, y: -2600 },
    foreground: { x: -2370, y: -2600 },
    player: {
      position: { x: 512, y: 288 },
      sprite: { row: 0, frame: 0 },
      moving: false
    },
    keys: { w: false, a: false, s: false, d: false },
    lastKey: '',
    images: {},
    boundaries: [],
    frameCount: 0,
    otherPlayers: {}
  });

  useEffect(() => {
    socket.on('playerJoined', ({ playerId, player }) => {
      setPlayers(prev => ({ ...prev, [playerId]: player }));
      gameStateRef.current.otherPlayers[playerId] = player;
      if (Object.keys(gameStateRef.current.otherPlayers).length >= 0) {
        setWaitingForPlayers(false);
      }
    });

    socket.on('gameStarted', ({ room }) => {
      setGameStarted(true);
      setPlayers(room.players);
      gameStateRef.current.otherPlayers = { ...room.players };
      delete gameStateRef.current.otherPlayers[socket.id];
      const inv = room.sharedInventory || [];
      inventoryRef.current = inv;
      setInventory(inv);
    });

    socket.on('playerMoved', ({ playerId, position, sprite, moving }) => {
      if (gameStateRef.current.otherPlayers[playerId]) {
        gameStateRef.current.otherPlayers[playerId].position = position;
        gameStateRef.current.otherPlayers[playerId].sprite = sprite;
        gameStateRef.current.otherPlayers[playerId].moving = moving;
      }
    });

    socket.on('playerLeft', ({ playerId }) => {
      setPlayers(prev => {
        const newPlayers = { ...prev };
        delete newPlayers[playerId];
        return newPlayers;
      });
      delete gameStateRef.current.otherPlayers[playerId];
    });

    socket.on('itemReceived', ({ item, from }) => {
      setInventory(prev => {
        const updated = [...prev, item];
        inventoryRef.current = updated;
        return updated;
      });
      showNotification(`Received ${item} from ${from}!`);
    });

    socket.on('actionCompleted', ({ action, message, completedBy }) => {
      setCompletedActions(prev => {
        const updated = [...prev, action];
        completedActionsRef.current = updated;
        return updated;
      });
      setWinningAction(action);
      setWinningPlayer(completedBy);
      showNotification(message);
    });

    socket.on('borderCrossed', () => {
      showNotification('Border crossed! Head to the helicopter!');
    });

    socket.on('gameOver', ({ won, reason }) => {
      setGameOver({ won, reason });
    });

    return () => {
      socket.off('playerJoined');
      socket.off('gameStarted');
      socket.off('playerMoved');
      socket.off('playerLeft');
      socket.off('itemReceived');
      socket.off('actionCompleted');
      socket.off('borderCrossed');
      socket.off('gameOver');
    };
  }, []);

  // Check if player is near an NPC (using circle collision)
  const checkNPCProximity = (worldX, worldY) => {
    for (const [npcId, zone] of Object.entries(NPC_ZONES)) {
      const centerX = zone.x + zone.radius;
      const centerY = zone.y + zone.radius;
      const distance = Math.sqrt(
        Math.pow(worldX - centerX, 2) + 
        Math.pow(worldY - centerY, 2)
      );
      // Detection range: 100 pixels from NPC center
      if (distance < 100) {
        return { npcId, name: zone.name };
      }
    }
    return null;
  };

  // Check if player is near an action zone
  const checkActionProximity = (worldX, worldY) => {
    for (const [actionId, zone] of Object.entries(ACTION_ZONES)) {
      const centerX = zone.x + zone.radius;
      const centerY = zone.y + zone.radius;
      const distance = Math.sqrt(
        Math.pow(worldX - centerX, 2) + 
        Math.pow(worldY - centerY, 2)
      );
      // Increased detection range to 100 pixels for easier interaction
      if (distance < zone.radius + 100) {
        const hasItem = inventoryRef.current.includes(zone.requiredItem);
        const isCompleted = completedActionsRef.current.includes(actionId);
        return { 
          actionId, 
          name: zone.name, 
          requiredItem: zone.requiredItem,
          hasItem,
          isCompleted,
          action: zone.action,
          description: zone.description
        };
      }
    }
    return null;
  };

  const performAction = (actionId) => {
    const action = ACTION_ZONES[actionId];
    if (!action) return;

    // Check if player has required item
    if (!inventoryRef.current.includes(action.requiredItem)) {
      showNotification(`You need a ${action.requiredItem} to ${action.action} here!`);
      return;
    }

    // Check if already completed
    if (completedActionsRef.current.includes(actionId)) {
      showNotification('You already completed this action!');
      return;
    }

    // Emit to server
    socket.emit('performAction', { roomCode, actionId });
  };

  const showNotification = (message) => {
    // TODO: Add notification system
    console.log('NOTIFICATION:', message);
  };

  const closeNPCChat = useCallback(() => {
    console.log('🚪 NPCChat close callback called');
    activeNPCRef.current = null;
    setActiveNPC(null);
  }, []);

  // Background music control
  const toggleMusic = () => {
    if (!audioRef.current) return;
    
    if (isMusicPlaying) {
      audioRef.current.pause();
      setIsMusicPlaying(false);
    } else {
      audioRef.current.play().catch(err => {
        console.log('Audio play prevented:', err);
      });
      setIsMusicPlaying(true);
    }
  };

  // Start music when game starts
  useEffect(() => {
    if (gameStarted && audioRef.current && !isMusicPlaying) {
      // Try to autoplay (might be blocked by browser)
      audioRef.current.play().catch(err => {
        console.log('Autoplay prevented - user must click to start music');
      });
      setIsMusicPlaying(true);
    }
  }, [gameStarted]);

  const enterNPCChat = (npcId) => {
    // Clear all movement keys when entering chat
    const state = gameStateRef.current;
    state.keys = { w: false, a: false, s: false, d: false };
    state.lastKey = '';
    
    console.log('🚪 enterNPCChat called with:', npcId);
    // Just set the active NPC, the NPCChat component will handle the socket emit
    activeNPCRef.current = npcId;
    setActiveNPC(npcId);
  };

  useEffect(() => {
    if (!gameStarted) return;

    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    canvas.width = 1024;
    canvas.height = 576;

    const state = gameStateRef.current;

    const mapImage = new Image();
    mapImage.src = '/img/calhacks-map.png';
    
    const foregroundImage = new Image();
    foregroundImage.src = '/img/calhacks-map-foreground.png';
    
    const playerImage = new Image();
    playerImage.src = '/img/ninja.png';
    
    // NPC sprites - custom images for each NPC
    const npcImage = new Image();
    npcImage.src = '/img/ninja.png';
    
    // Load specific NPC images
    const hardwareClerkImage = new Image();
    hardwareClerkImage.src = '/img/blonde_man.png';
    
    const policeOfficerImage = new Image();
    policeOfficerImage.src = '/img/policeman.png';
    
    const borderGuardImage = new Image();
    borderGuardImage.src = '/img/soldier.png';
    
    const exitGuardImage = new Image();
    exitGuardImage.src = '/img/soldier.png';

    state.images = { 
      mapImage, 
      foregroundImage, 
      playerImage, 
      npcImage 
    };
    
    // Store custom images per NPC
    state.images.npcImages = {
      default: npcImage,
      hardwareClerk: hardwareClerkImage,
      policeOfficer: policeOfficerImage,
      borderGuard: borderGuardImage,
      exitGuard: exitGuardImage
    };

    fetch('/data/collisions.js')
      .then(res => res.text())
      .then(text => {
        const collisionsMatch = text.match(/\[([\s\S]*)\]/);
        if (collisionsMatch) {
          const collisions = eval('[' + collisionsMatch[1] + ']');
          const collisionsMap = [];
          for (let i = 0; i < collisions.length; i += 120) {
            collisionsMap.push(collisions.slice(i, i + 120));
          }

          const boundaries = [];
          const paddingTiles = 10;
          const offsetX = 10;
          const offsetY = 10;

          collisionsMap.forEach((row, i) => {
            row.forEach((symbol, j) => {
              if (symbol === 1479 || symbol === 1475) {
                boundaries.push({
                  position: {
                    x: (j - paddingTiles + offsetX) * 48,
                    y: (i - paddingTiles + offsetY) * 48
                  },
                  width: 48,
                  height: 48
                });
              }
            });
          });

          state.boundaries = boundaries;
        }
      });

    const handleKeyDown = (e) => {
      // Don't process movement keys if chat is open
      if (activeNPCRef.current) return;
      
      const key = e.key.toLowerCase();
      if (['w', 'a', 's', 'd'].includes(key)) {
        state.keys[key] = true;
        state.lastKey = key;
      }
      if (key === 'e' && nearbyNPCRef.current) {
        enterNPCChat(nearbyNPCRef.current.npcId);
      }
      if (key === 'f' && nearbyActionRef.current && !nearbyActionRef.current.isCompleted) {
        performAction(nearbyActionRef.current.actionId);
      }
    };

    const handleKeyUp = (e) => {
      // Don't process movement keys if chat is open
      if (activeNPCRef.current) return;
      
      const key = e.key.toLowerCase();
      if (['w', 'a', 's', 'd'].includes(key)) {
        state.keys[key] = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    const checkCollisions = (worldX, worldY) => {
      const player = { x: worldX, y: worldY, width: 32, height: 64 };
      return state.boundaries.some(boundary => {
        return (
          player.x + player.width >= boundary.position.x &&
          player.x <= boundary.position.x + boundary.width &&
          player.y + player.height >= boundary.position.y &&
          player.y <= boundary.position.y + boundary.height
        );
      });
    };

    const checkMapBounds = (x, y) => {
      const mapWidth = 5760;
      const mapHeight = 5760;
      const minX = -(mapWidth - canvas.width);
      const maxX = 0;
      const minY = -(mapHeight - canvas.height);
      const maxY = 0;
      return x >= minX && x <= maxX && y >= minY && y <= maxY;
    };

    let animationId;
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      
      context.fillStyle = 'black';
      context.fillRect(0, 0, canvas.width, canvas.height);

      if (state.images.mapImage.complete) {
        context.drawImage(state.images.mapImage, state.background.x, state.background.y);
      }

      // Draw NPCs as sprites
      Object.entries(NPC_ZONES).forEach(([npcId, zone]) => {
        const centerX = zone.x + zone.radius;
        const centerY = zone.y + zone.radius;
        const screenX = centerX + state.background.x;
        const screenY = centerY + state.background.y;
        
        // Draw NPC sprite (with idle animation)
        // Try to use custom sprite for this NPC, otherwise use default
        const npcSpriteImage = state.images.npcImages?.[npcId] || state.images.npcImage;
        
        if (npcSpriteImage.complete) {
          const spriteWidth = 32;
          const spriteHeight = 32;
          const scale = 4;
          
          // Idle animation: slight bobbing
          const bobOffset = Math.sin(state.frameCount * 0.03) * 3;
          
          // Draw NPC sprite with idle animation
          // Calculate sprite frame based on frameCount for idle animation
          const idleFrame = Math.floor((state.frameCount / 20) % 4);
          
          const spriteRow = zone.spriteRow || 0;
          
          const spriteY = screenY - spriteHeight * scale - 10 + bobOffset + zone.spriteOffset.y;
          
          // Draw shadow
          context.fillStyle = 'rgba(0, 0, 0, 0.3)';
          context.beginPath();
          context.ellipse(
            screenX, spriteY + scale * spriteHeight + 5,
            scale * spriteWidth * 0.4, scale * spriteHeight * 0.2,
            0, 0, Math.PI * 2
          );
          context.fill();
          
          context.drawImage(
            npcSpriteImage,
            idleFrame * spriteWidth,
            spriteRow * spriteHeight,
            spriteWidth,
            spriteHeight,
            screenX - (spriteWidth * scale) / 2 + zone.spriteOffset.x,
            spriteY,
            spriteWidth * scale,
            spriteHeight * scale
          );
        }
        
        // Draw name above (with background for readability)
        context.fillStyle = 'rgba(0, 0, 0, 0.7)';
        context.fillRect(screenX - 80, screenY - 120, 160, 25);
        
        context.fillStyle = zone.color;
        context.font = 'bold 14px "JetBrains Mono"';
        context.textAlign = 'center';
        context.fillText(zone.name, screenX, screenY - 100);
        
        // Draw interaction hint if player is near
        const worldX = state.player.position.x - state.background.x;
        const worldY = state.player.position.y - state.background.y;
        const distance = Math.sqrt(
          Math.pow(worldX - centerX, 2) + 
          Math.pow(worldY - centerY, 2)
        );
        
        if (distance < 100) {
          context.fillStyle = 'rgba(0, 0, 0, 0.7)';
          context.fillRect(screenX - 60, screenY + 80, 120, 20);
          
          context.fillStyle = '#39ff14';
          context.font = 'bold 12px "JetBrains Mono"';
          context.fillText('[E] Talk', screenX, screenY + 95);
        }
      });

      // Draw Action Zones
      Object.entries(ACTION_ZONES).forEach(([actionId, zone]) => {
        const centerX = zone.x + zone.radius;
        const centerY = zone.y + zone.radius;
        const screenX = centerX + state.background.x;
        const screenY = centerY + state.background.y;
        
        const hasItem = inventoryRef.current.includes(zone.requiredItem);
        const isCompleted = completedActionsRef.current.includes(actionId);
        const zoneColor = isCompleted ? '#888888' : (hasItem ? zone.color : '#666666');
        const opacity = isCompleted ? '30' : (hasItem ? '60' : '40');
        
        // Draw outer glow (different pattern for locked/unlocked)
        const gradient = context.createRadialGradient(
          screenX, screenY, 0,
          screenX, screenY, zone.radius + 25
        );
        gradient.addColorStop(0, zoneColor + opacity);
        gradient.addColorStop(0.7, zoneColor + '20');
        gradient.addColorStop(1, 'transparent');
        
        context.fillStyle = gradient;
        context.beginPath();
        context.arc(screenX, screenY, zone.radius + 25, 0, Math.PI * 2);
        context.fill();
        
        // Draw main circle with dashed border if locked
        context.fillStyle = zoneColor + (isCompleted ? '40' : (hasItem ? '50' : '30'));
        context.beginPath();
        context.arc(screenX, screenY, zone.radius, 0, Math.PI * 2);
        context.fill();
        
        // Draw border (dashed if locked, solid if unlocked)
        context.strokeStyle = zoneColor;
        context.lineWidth = 3;
        if (!hasItem && !isCompleted) {
          context.setLineDash([10, 5]);
        }
        context.beginPath();
        context.arc(screenX, screenY, zone.radius, 0, Math.PI * 2);
        context.stroke();
        context.setLineDash([]); // Reset dash
        
        // Draw pulsing effect (only if unlocked and not completed)
        if (hasItem && !isCompleted) {
          const pulseRadius = zone.radius * 0.6 + Math.sin(state.frameCount * 0.05) * 12;
          context.fillStyle = 'rgba(255, 255, 255, 0.4)';
          context.beginPath();
          context.arc(screenX, screenY, pulseRadius, 0, Math.PI * 2);
          context.fill();
        }
        
        // Draw lock icon if locked, checkmark if completed
        if (isCompleted) {
          context.fillStyle = '#00ff00';
          context.font = 'bold 24px Arial';
          context.textAlign = 'center';
          context.fillText('✓', screenX, screenY + 8);
        } else if (!hasItem) {
          context.fillStyle = '#ff4444';
          context.font = 'bold 24px Arial';
          context.textAlign = 'center';
          context.fillText('🔒', screenX, screenY + 8);
        }
        
        // Draw name above
        context.fillStyle = zoneColor;
        context.font = 'bold 14px "JetBrains Mono"';
        context.textAlign = 'center';
        context.fillText(zone.name, screenX, screenY - zone.radius - 15);
        
        // Draw interaction hint if player is near
        const worldX = state.player.position.x - state.background.x;
        const worldY = state.player.position.y - state.background.y;
        const distance = Math.sqrt(
          Math.pow(worldX - centerX, 2) + 
          Math.pow(worldY - centerY, 2)
        );
        
        if (distance < zone.radius + 100) {
          if (isCompleted) {
            context.fillStyle = '#888888';
            context.font = '12px "JetBrains Mono"';
            context.fillText('Completed', screenX, screenY + zone.radius + 25);
          } else if (hasItem) {
            context.fillStyle = '#39ff14';
            context.font = 'bold 12px "JetBrains Mono"';
            context.fillText(`[F] ${zone.action.toUpperCase()}`, screenX, screenY + zone.radius + 25);
          } else {
            context.fillStyle = '#ff4444';
            context.font = '12px "JetBrains Mono"';
            context.fillText(`Need: ${zone.requiredItem}`, screenX, screenY + zone.radius + 25);
          }
        }
      });

      const speed = 8;
      let moved = false;
      state.player.moving = false;

      if (state.keys.w && state.lastKey === 'w') {
        const newY = state.background.y + speed;
        const worldX = state.player.position.x - state.background.x;
        const worldY = state.player.position.y - newY;
        
        if (!checkCollisions(worldX, worldY) && checkMapBounds(state.background.x, newY)) {
          state.background.y = newY;
          state.foreground.y = newY;
          state.player.sprite.row = 7;
          state.player.moving = true;
          moved = true;
        }
      } else if (state.keys.a && state.lastKey === 'a') {
        const newX = state.background.x + speed;
        const worldX = state.player.position.x - newX;
        const worldY = state.player.position.y - state.background.y;
        
        if (!checkCollisions(worldX, worldY) && checkMapBounds(newX, state.background.y)) {
          state.background.x = newX;
          state.foreground.x = newX;
          state.player.sprite.row = 5;
          state.player.moving = true;
          moved = true;
        }
      } else if (state.keys.s && state.lastKey === 's') {
        const newY = state.background.y - speed;
        const worldX = state.player.position.x - state.background.x;
        const worldY = state.player.position.y - newY;
        
        if (!checkCollisions(worldX, worldY) && checkMapBounds(state.background.x, newY)) {
          state.background.y = newY;
          state.foreground.y = newY;
          state.player.sprite.row = 4;
          state.player.moving = true;
          moved = true;
        }
      } else if (state.keys.d && state.lastKey === 'd') {
        const newX = state.background.x - speed;
        const worldX = state.player.position.x - newX;
        const worldY = state.player.position.y - state.background.y;
        
        if (!checkCollisions(worldX, worldY) && checkMapBounds(newX, state.background.y)) {
          state.background.x = newX;
          state.foreground.x = newX;
          state.player.sprite.row = 6;
          state.player.moving = true;
          moved = true;
        }
      }

      // Check NPC proximity
      const worldX = state.player.position.x - state.background.x;
      const worldY = state.player.position.y - state.background.y;
      const nearby = checkNPCProximity(worldX, worldY);
      nearbyNPCRef.current = nearby;
      setNearbyNPC(nearby);

      // Check action zone proximity
      const nearbyActionZone = checkActionProximity(worldX, worldY);
      nearbyActionRef.current = nearbyActionZone;
      setNearbyAction(nearbyActionZone);

      if (moved || state.frameCount % 30 === 0) {
        const worldPos = {
          x: worldX,
          y: worldY
        };
        socket.emit('playerMove', {
          roomCode,
          position: worldPos,
          sprite: state.player.sprite,
          moving: state.player.moving
        });
      }

      if (state.player.moving) {
        if (state.frameCount % 10 === 0) {
          state.player.sprite.frame = (state.player.sprite.frame + 1) % 4;
        }
      } else {
        state.player.sprite.frame = 0;
        state.player.sprite.row = 0;
      }

      Object.entries(state.otherPlayers).forEach(([id, otherPlayer]) => {
        if (state.images.playerImage.complete && otherPlayer.position) {
          const screenX = otherPlayer.position.x + state.background.x;
          const screenY = otherPlayer.position.y + state.background.y;
          
          const spriteWidth = 32;
          const spriteHeight = 32;
          const scale = 4;

          context.drawImage(
            state.images.playerImage,
            (otherPlayer.sprite?.frame || 0) * spriteWidth,
            (otherPlayer.sprite?.row || 0) * spriteHeight,
            spriteWidth,
            spriteHeight,
            screenX,
            screenY,
            spriteWidth * scale,
            spriteHeight * scale
          );

          context.fillStyle = 'white';
          context.font = 'bold 16px Arial';
          context.textAlign = 'center';
          context.fillText(otherPlayer.username, screenX + 64, screenY - 10);
        }
      });

      if (state.images.playerImage.complete) {
        const spriteWidth = 32;
        const spriteHeight = 32;
        const scale = 4;

        context.drawImage(
          state.images.playerImage,
          state.player.sprite.frame * spriteWidth,
          state.player.sprite.row * spriteHeight,
          spriteWidth,
          spriteHeight,
          state.player.position.x,
          state.player.position.y,
          spriteWidth * scale,
          spriteHeight * scale
        );

        context.fillStyle = 'white';
        context.font = 'bold 16px Arial';
        context.textAlign = 'center';
        context.fillText(username, state.player.position.x + 64, state.player.position.y - 10);
      }

      if (state.images.foregroundImage.complete) {
        context.drawImage(state.images.foregroundImage, state.foreground.x, state.foreground.y);
      }

      // Debug: Draw player world position in bottom left
      const debugWorldX = state.player.position.x - state.background.x;
      const debugWorldY = state.player.position.y - state.background.y;
      context.fillStyle = 'rgba(0, 0, 0, 0.7)';
      context.fillRect(10, canvas.height - 60, 200, 50);
      context.fillStyle = '#39ff14';
      context.font = 'bold 14px "JetBrains Mono"';
      context.textAlign = 'left';
      context.fillText(`X: ${Math.round(debugWorldX)}`, 20, canvas.height - 35);
      context.fillText(`Y: ${Math.round(debugWorldY)}`, 20, canvas.height - 15);

      state.frameCount++;
    };

    animate();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [gameStarted, roomCode, username]);

  const handleStartGame = () => {
    socket.emit('startGame', { roomCode });
  };

  const handleLeave = () => {
    socket.disconnect();
    onLeave();
  };

  if (gameOver) {
    // Determine win message based on action
    let winTitle = 'ESCAPE SUCCESSFUL!';
    let winMessage = 'You successfully escaped with the money!';
    let winIcon = '🎉';

    if (gameOver.won && winningAction) {
      if (winningAction === 'digSite') {
        winTitle = '🏆 TUNNEL ESCAPE!';
        winMessage = `${winningPlayer || 'Your team'} dug a secret tunnel and escaped underground with the stolen cash!`;
        winIcon = '⛏️';
      } else if (winningAction === 'helicopterPad') {
        winTitle = '🏆 AERIAL ESCAPE!';
        winMessage = `${winningPlayer || 'Your team'} flew away in the helicopter! The police can't catch you now!`;
        winIcon = '🚁';
      } else if (winningAction === 'borderExit') {
        winTitle = '🏆 BORDER CROSSING!';
        winMessage = `${winningPlayer || 'Your team'} convinced the border guard and made it across! Freedom awaits!`;
        winIcon = '🛂';
      }
    }

    return (
      <div className="game-over-screen">
        <div className="game-over-container">
          {gameOver.won ? (
            <>
              <div className="win-icon" style={{ fontSize: '80px', marginBottom: '20px', animation: 'bounceIn 0.8s cubic-bezier(0.68, -0.55, 0.265, 1.55)' }}>
                {winIcon}
              </div>
              <h1 style={{ 
                color: '#39ff14', 
                textShadow: '0 0 20px #39ff14, 0 0 40px #39ff14',
                animation: 'fadeIn 1s ease-out'
              }}>
                {winTitle}
              </h1>
              <p style={{ 
                fontSize: '18px', 
                maxWidth: '500px', 
                lineHeight: '1.6',
                animation: 'fadeIn 1.2s ease-out'
              }}>
                {winMessage}
              </p>
              <div style={{ 
                marginTop: '20px', 
                padding: '15px 25px', 
                background: 'rgba(57, 255, 20, 0.1)',
                border: '2px solid #39ff14',
                borderRadius: '8px',
                fontSize: '24px',
                fontWeight: 'bold',
                color: '#39ff14',
                animation: 'pulse 2s ease-in-out infinite'
              }}>
                💰 $500,000 SECURED 💰
              </div>
              {/* Celebratory particles */}
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                overflow: 'hidden'
              }}>
                {[...Array(20)].map((_, i) => (
                  <div
                    key={i}
                    style={{
                      position: 'absolute',
                      top: `${Math.random() * 100}%`,
                      left: `${Math.random() * 100}%`,
                      width: '10px',
                      height: '10px',
                      background: i % 3 === 0 ? '#39ff14' : i % 3 === 1 ? '#FFD700' : '#00ffff',
                      borderRadius: '50%',
                      animation: `float ${3 + Math.random() * 3}s ease-in-out infinite`,
                      animationDelay: `${Math.random() * 2}s`,
                      opacity: 0.6
                    }}
                  />
                ))}
              </div>
            </>
          ) : (
            <>
              <h1>{gameOver.reason === 'arrested' ? '🚨 BUSTED!' : 'GAME OVER'}</h1>
              <p>
                {gameOver.reason === 'arrested' 
                  ? 'You were arrested by the authorities! The money has been recovered.' 
                  : 'Mission failed!'}
              </p>
            </>
          )}
          <button className="btn-primary" onClick={handleLeave} style={{ marginTop: '30px', position: 'relative', zIndex: 10 }}>
            Return to Lobby
          </button>
        </div>
      </div>
    );
  }

  if (!gameStarted) {
    return (
      <div className="waiting-room">
        <div className="waiting-container">
          <h2>Room: {roomCode}</h2>
          <div className="mission-brief">
            <h3>Mission Briefing</h3>
            <p>You just robbed $500,000 from the bank. Escape the city!</p>
            <div className="objectives">
              <div className="objective">1. Get a shovel from the Hardware Store</div>
              <div className="objective">2. Convince the Police Officer to give you helicopter keys</div>
              <div className="objective">3. Cross the border by convincing the Border Guard</div>
            </div>
          </div>
          
          <p>Players in room: {Object.keys(players).length}/4</p>
          
          <div className="player-list">
            {Object.values(players).map((player) => (
              <div key={player.id} className="player-item">
                {player.username} {player.id === socket.id && '(You)'}
              </div>
            ))}
          </div>

          {waitingForPlayers && (
            <p className="waiting-text">Waiting for players to join...</p>
          )}

          {isHost && (
            <button className="btn-start" onClick={handleStartGame}>
              Start Heist
            </button>
          )}

          {!isHost && (
            <p className="waiting-text">Waiting for host to start the heist...</p>
          )}

          <button className="btn-leave" onClick={handleLeave}>
            Leave Room
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="game">
      {/* Background Music */}
      <audio 
        ref={audioRef}
        src="/audio/Lights Out (Console Edition) - The Escapists Music Extended [5JKt3rJ95WU].mp3"
        loop
        volume="0.3"
        preload="auto"
      />
      
      <div className="game-hud">
        <div className="hud-left">
          <div className="room-info">Room: {roomCode}</div>
          <div className="inventory">
            <span className="inventory-label">Inventory:</span>
            {inventory.length === 0 ? (
              <span className="inventory-empty">Empty</span>
            ) : (
              inventory.map((item, idx) => (
                <span key={idx} className="inventory-item">{item}</span>
              ))
            )}
          </div>
        </div>
        <div className="hud-right">
          {nearbyNPC && (
            <div className="interaction-prompt">
              Press E to talk to {nearbyNPC.name}
            </div>
          )}
          {nearbyAction && !nearbyNPC && (
            <div className="interaction-prompt" style={{
              color: nearbyAction.isCompleted ? '#888888' : 
                     nearbyAction.hasItem ? '#39ff14' : '#ff4444'
            }}>
              {nearbyAction.isCompleted ? 
                `${nearbyAction.name} - Completed` :
                nearbyAction.hasItem ? 
                  `Press F to ${nearbyAction.action} - ${nearbyAction.name}` :
                  `${nearbyAction.name} - Need ${nearbyAction.requiredItem}`
              }
            </div>
          )}
          <button 
            className="btn-music-toggle" 
            onClick={toggleMusic}
            title={isMusicPlaying ? 'Mute Music' : 'Play Music'}
          >
            {isMusicPlaying ? '🔊' : '🔇'}
          </button>
          <button className="btn-leave-game" onClick={handleLeave}>Leave</button>
        </div>
      </div>
      <canvas ref={canvasRef} />
      
      {activeNPC && (() => {
        const npcName = activeNPC === 'hardwareClerk' ? 'Hardware Store Clerk' : 
                        activeNPC === 'policeOfficer' ? 'Police Officer' : 
                        activeNPC === 'borderGuard' ? 'Border Guard' : 'Exit Guard';
        const location = NPC_ZONES[activeNPC].name;
        
        return (
          <NPCChat
            key={activeNPC}
            socket={socket}
            roomCode={roomCode}
            npcId={activeNPC}
            npcName={npcName}
            location={location}
            username={username}
            onClose={closeNPCChat}
          />
        );
      })()}
    </div>
  );
}

export default Game;
