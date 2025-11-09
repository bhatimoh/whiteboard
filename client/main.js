import CanvasBoard from "./canvas.js";

window.addEventListener("DOMContentLoaded", () => {
  const board = new CanvasBoard();

  const undoBtn = document.getElementById("undo");
  const redoBtn = document.getElementById("redo");
  const clearBtn = document.getElementById("clear");

  // Undo/Redo now request the server to change authoritative history
  undoBtn?.addEventListener("click", () => {
    if (board.socket && board.socket.socket) {
      board.socket.emitUndo();
    } else {
      console.warn("Socket not connected yet");
    }
  });

  redoBtn?.addEventListener("click", () => {
    if (board.socket && board.socket.socket) {
      board.socket.emitRedo();
    } else {
      console.warn("Socket not connected yet");
    }
  });

  clearBtn?.addEventListener("click", () => {
    if (board.socket && board.socket.socket) {
      const confirmClear = confirm("🧹 Clear board for all users?");
      if (confirmClear) {
        board.socket.emitClear();
      }
    }
  });

  console.log("🟢 Board ready (connected to socket for global undo/redo)");
});
