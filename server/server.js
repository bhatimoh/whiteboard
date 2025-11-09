// ===================================================================
// server.js — Collaborative Whiteboard Backend (Global history + undo/redo)
// ===================================================================
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
app.use(cors());
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// In-memory global state (server is source-of-truth)
let users = {}; // socketId -> { name, color }
let globalHistory = []; // array of strokes (committed)
let redoStack = []; // undone strokes waiting for redo

function randomName() {
  return "User" + Math.floor(1000 + Math.random() * 9000);
}
function randomColor() {
  const palette = [
    "#10A37F",
    "#F28B30",
    "#E64C3C",
    "#1E90FF",
    "#FFD700",
    "#A020F0",
  ];
  return palette[Math.floor(Math.random() * palette.length)];
}

// Basic route
app.get("/", (req, res) => res.send("Whiteboard server running"));

// Socket.io handlers
io.on("connection", (socket) => {
  // assign user
  const newUser = { name: randomName(), color: randomColor() };
  users[socket.id] = newUser;
  console.log(`🟢 ${newUser.name} connected (${socket.id})`);

  // inform everyone of new user list
  io.emit("users:update", users);

  // Send initial history to this socket (so new joiner syncs)
  socket.emit("init:history", globalHistory);

  // Live drawing events (we keep these to preserve low-latency preview)
  socket.on("draw:start", (data) => socket.broadcast.emit("draw:start", data));
  socket.on("draw:move", (data) => socket.broadcast.emit("draw:move", data));
  // When a stroke is finished, server commits it to global history
  socket.on("draw:end", (stroke) => {
    // stroke should be an object like { id, points: [...], color, size, user? }
    globalHistory.push(stroke);
    // clear redo because timeline changed
    redoStack = [];
    // broadcast commit to others
    io.emit("draw:end", stroke);
    // optional: broadcast new history snapshot (ensures consistent state)
    io.emit("sync:history", globalHistory);
  });

  // Cursor events (unchanged)
  socket.on("cursor:move", (pos) => {
    const user = users[socket.id];
    if (!user) return;
    socket.broadcast.emit("cursor:update", {
      id: socket.id,
      name: user.name,
      color: user.color,
      x: pos.x,
      y: pos.y,
    });
  });

  // --------- GLOBAL UNDO / REDO handling ----------
  socket.on("undo", () => {
    const last = globalHistory.pop();
    if (last) {
      redoStack.push(last);
      // Broadcast updated history to all clients (authoritative state)
      io.emit("sync:history", globalHistory);
      console.log(`↶ Undo performed by ${users[socket.id]?.name || socket.id}`);
    } else {
      // nothing to undo
      socket.emit("undo:empty");
    }
  });

  socket.on("redo", () => {
    const item = redoStack.pop();
    if (item) {
      globalHistory.push(item);
      io.emit("sync:history", globalHistory);
      console.log(`↷ Redo performed by ${users[socket.id]?.name || socket.id}`);
    } else {
      socket.emit("redo:empty");
    }
  });
  // ---------------- Global Clear Board ----------------
  socket.on("clear:board", () => {
    console.log(`🧹 Clear board by ${users[socket.id]?.name || socket.id}`);
    globalHistory = [];
    redoStack = [];
    // Tell everyone to clear their canvases
    io.emit("sync:history", globalHistory);
  });

  // When someone leaves
  socket.on("disconnect", () => {
    console.log(
      `🔴 ${users[socket.id]?.name || "User"} disconnected (${socket.id})`
    );
    delete users[socket.id];
    io.emit("users:update", users);
  });
});

const PORT = 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
