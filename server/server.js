// server.js
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
  })
);

const server = createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

let users = {};
let globalHistory = [];
let redoStack = [];

io.on("connection", (socket) => {
  console.log("✅ User connected:", socket.id);

  users[socket.id] = { name: "Anonymous", color: "#10A37F" };
  io.emit("users:update", users);

  socket.on("user:setName", (name) => {
    users[socket.id].name = name;
    io.emit("users:update", users);
  });

  socket.on("draw:end", (stroke) => {
    globalHistory.push(stroke);
    redoStack = [];
    socket.broadcast.emit("draw:end", stroke);
  });

  socket.on("undo", () => {
    const last = globalHistory.pop();
    if (last) redoStack.push(last);
    io.emit("sync:history", globalHistory);
  });

  socket.on("redo", () => {
    const redo = redoStack.pop();
    if (redo) globalHistory.push(redo);
    io.emit("sync:history", globalHistory);
  });

  socket.on("clear:board", () => {
    globalHistory = [];
    redoStack = [];
    io.emit("sync:history", []);
  });

  socket.on("disconnect", () => {
    delete users[socket.id];
    io.emit("users:update", users);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
