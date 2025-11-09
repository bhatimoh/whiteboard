// ===================================================================
// websocket.js — client-side socket wrapper (listens/emit)
// ===================================================================
import { io } from "https://cdn.socket.io/4.7.2/socket.io.esm.min.js";

class SocketConnection {
  constructor(board) {
    this.board = board;
    this.socket = io("http://localhost:3000");

    this.socket.on("connect", () => {
      console.log("🟢 Connected to server:", this.socket.id);
    });

    // Users list (name + color)
    this.socket.on("users:update", (users) => {
      this.board.updateActiveUsers(users);
      // apply own color if server assigned it
      const me = users[this.socket.id];
      if (me) this.board.color = me.color;
    });

    // Initial history (when joining)
    this.socket.on("init:history", (history) => {
      console.log("init:history received", history?.length || 0);
      this.board.syncHistory(history);
    });

    // authoritative history sync (after undo/redo or commit)
    this.socket.on("sync:history", (history) => {
      // full replacement of history
      this.board.syncHistory(history);
    });

    // live draw events (low-latency preview)
    this.socket.on("draw:start", (data) => this.board.startRemoteStroke(data));
    this.socket.on("draw:move", (data) => this.board.updateRemoteStroke(data));
    // when stroke committed by other side
    this.socket.on("draw:end", (data) => this.board.commitRemoteStroke(data));

    // cursor updates
    this.socket.on("cursor:update", (cursor) =>
      this.board.updateRemoteCursor(cursor)
    );
  }

  emitStart(stroke) {
    this.socket.emit("draw:start", stroke);
  }
  emitMove(point) {
    this.socket.emit("draw:move", point);
  }
  emitEnd(stroke) {
    this.socket.emit("draw:end", stroke);
  }

  emitCursor(pos) {
    this.socket.emit("cursor:move", pos);
  }

  // global undo/redo requests (server will broadcast sync:history)
  emitUndo() {
    this.socket.emit("undo");
  }
  emitRedo() {
    this.socket.emit("redo");
  }
  emitClear() {
    this.socket.emit("clear:board");
  }
}

export default SocketConnection;
