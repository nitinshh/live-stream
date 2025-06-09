const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Serve static files
app.use(express.static('public'));

// Store room information
const rooms = new Map();

// Generate unique room code
app.get('/create-room', (req, res) => {
  const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  rooms.set(roomCode, {
    id: roomCode,
    streamer: null,
    viewers: new Set(),
    created: Date.now()
  });

  res.setHeader('Content-Type', 'application/json');
  res.status(200).send(JSON.stringify({ roomCode }));
});

// Streamer page
app.get('/stream/:roomCode', (req, res) => {
  const { roomCode } = req.params;
  if (!rooms.has(roomCode)) {
    return res.status(404).send('Room not found');
  }
  res.sendFile(path.join(__dirname, 'public', 'streamer.html'));
});

// Viewer page
app.get('/watch/:roomCode', (req, res) => {
  const { roomCode } = req.params;
  if (!rooms.has(roomCode)) {
    return res.status(404).send('Room not found');
  }
  res.sendFile(path.join(__dirname, 'public', 'viewer.html'));
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join room as streamer
  socket.on('join-as-streamer', (roomCode) => {
    const room = rooms.get(roomCode);
    if (room) {
      room.streamer = socket.id;
      socket.join(roomCode);
      socket.roomCode = roomCode;
      socket.emit('joined-as-streamer', roomCode);
      console.log(`Streamer ${socket.id} joined room ${roomCode}`);
    }
  });

  // Join room as viewer
  socket.on('join-as-viewer', (roomCode) => {
    const room = rooms.get(roomCode);
    if (room) {
      room.viewers.add(socket.id);
      socket.join(roomCode);
      socket.roomCode = roomCode;
      socket.emit('joined-as-viewer', roomCode);
      
      // Notify streamer about new viewer
      if (room.streamer) {
        socket.to(room.streamer).emit('viewer-joined', socket.id);
      }
      
      console.log(`Viewer ${socket.id} joined room ${roomCode}`);
    }
  });

  // WebRTC signaling
  socket.on('offer', (data) => {
    socket.to(data.target).emit('offer', {
      offer: data.offer,
      sender: socket.id
    });
  });

  socket.on('answer', (data) => {
    socket.to(data.target).emit('answer', {
      answer: data.answer,
      sender: socket.id
    });
  });

  socket.on('ice-candidate', (data) => {
    socket.to(data.target).emit('ice-candidate', {
      candidate: data.candidate,
      sender: socket.id
    });
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    if (socket.roomCode) {
      const room = rooms.get(socket.roomCode);
      if (room) {
        if (room.streamer === socket.id) {
          // Streamer disconnected, notify all viewers
          socket.to(socket.roomCode).emit('streamer-disconnected');
          room.streamer = null;
        } else {
          // Viewer disconnected
          room.viewers.delete(socket.id);
          if (room.streamer) {
            socket.to(room.streamer).emit('viewer-left', socket.id);
          }
        }
      }
    }
  });

    // Chat message handler
    socket.on('chat-message', (data) => {
    const { username, message, timestamp } = data;

    const roomCode = socket.roomCode;
    const senderId = socket.id;

    if (roomCode) {
      io.to(roomCode).emit('chat-message', {
        senderId,
        username,
        message,
        timestamp: timestamp || new Date().toISOString()
      });
    }
  });



});

// Clean up old rooms (older than 24 hours)
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    if (now - room.created > 24 * 60 * 60 * 1000) {
      rooms.delete(code);
    }
  }
}, 60 * 60 * 1000); // Check every hour

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} to start streaming`);
});