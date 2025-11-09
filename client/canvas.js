// ===================================================================
// canvas.js — client drawing + remote sync + global undo/redo playback
// ===================================================================
import SocketConnection from "./websocket.js";

export default class CanvasBoard {
  constructor() {
    // DOM canvases
    this.historyCanvas = document.getElementById("history");
    this.remoteCanvas = document.getElementById("remote");
    this.liveCanvas = document.getElementById("live");

    // create top cursor layer
    this.cursorCanvas = document.createElement("canvas");
    this.cursorCanvas.id = "cursor-layer";
    this.liveCanvas.parentElement.appendChild(this.cursorCanvas);

    // 2D contexts
    this.hctx = this.historyCanvas.getContext("2d");
    this.rctx = this.remoteCanvas.getContext("2d");
    this.lctx = this.liveCanvas.getContext("2d");
    this.cctx = this.cursorCanvas.getContext("2d");

    // brush defaults
    this.color = "#10A37F";
    this.size = 10;

    // local state
    this.strokes = []; // local mirror of server's globalHistory
    this.currentStroke = []; // points during an in-progress local stroke
    this.isDrawing = false;

    // remote in-progress strokes keyed by stroke id or user id
    this.remoteStrokes = {};

    // remote cursors keyed by socket id
    this.remoteCursors = {};

    // socket connection (board reference passed)
    this.socket = new SocketConnection(this);

    // bind + size
    this._bindEvents();
    this._resizeCanvas();
    window.addEventListener("resize", () => this._resizeCanvas());
  }

  // ------------------ resize & coordinate helpers ------------------
  _resizeCanvas() {
    const container = this.liveCanvas.parentElement;
    const width = container.clientWidth;
    const height = container.clientHeight;

    for (const c of [
      this.historyCanvas,
      this.remoteCanvas,
      this.liveCanvas,
      this.cursorCanvas,
    ]) {
      // preserve content for history & remote; not strictly necessary for this demo,
      // but ensures content is not lost on resize
      if (c === this.historyCanvas || c === this.remoteCanvas) {
        const data = c.toDataURL();
        c.width = width;
        c.height = height;
        const img = new Image();
        img.src = data;
        img.onload = () => c.getContext("2d").drawImage(img, 0, 0);
      } else {
        c.width = width;
        c.height = height;
      }
    }
  }

  _getPos(e, targetCanvas = this.liveCanvas) {
    const rect = targetCanvas.getBoundingClientRect();
    const scaleX = targetCanvas.width / rect.width;
    const scaleY = targetCanvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  // ------------------ event binding ------------------
  _bindEvents() {
    this.liveCanvas.addEventListener("mousedown", (e) => this._start(e));
    this.liveCanvas.addEventListener("mousemove", (e) => {
      // send cursor updates regardless of drawing state
      const pos = this._getPos(e);
      this.socket.emitCursor(pos);

      // drawing move
      this._move(e);
    });
    window.addEventListener("mouseup", () => this._end());
  }

  // ------------------ local drawing flow ------------------
  _start(e) {
    this.isDrawing = true;
    const p = this._getPos(e);
    this.currentStroke = [p];

    // notify others of start (low-latency)
    const startStroke = {
      id: crypto.randomUUID(),
      points: [p],
      color: this.color,
      size: this.size,
    };
    // store temp id so subsequent move/end can include same id if needed
    this._localTempId = startStroke.id;
    this.socket.emitStart(startStroke);
  }

  _move(e) {
    if (!this.isDrawing) return;
    const p = this._getPos(e);
    this.currentStroke.push(p);

    // render on live layer
    this.lctx.clearRect(0, 0, this.liveCanvas.width, this.liveCanvas.height);
    this._drawSmooth(this.lctx, this.currentStroke, this.color, this.size);

    // Throttle network emits (send fewer move messages)
    const now = Date.now();
    if (!this.lastEmit) this.lastEmit = 0;
    if (now - this.lastEmit > 30) {
      this.socket.emitMove({
        points: [p],
        color: this.color,
        size: this.size,
        id: this._localTempId,
      });
      this.lastEmit = now;
    }
  }

  _end() {
    if (!this.isDrawing) return;
    this.isDrawing = false;

    // commit locally and inform server (server will push sync)
    const stroke = {
      id: this._localTempId || crypto.randomUUID(),
      points: [...this.currentStroke],
      color: this.color,
      size: this.size,
    };

    // push locally (will be replaced by server's authoritative history via sync:history)
    this.strokes.push(stroke);
    // draw permanently on history canvas
    this._drawSmooth(this.hctx, stroke.points, stroke.color, stroke.size);

    // send commit to server
    this.socket.emitEnd(stroke);

    // clear live layer
    this.currentStroke = [];
    this.lctx.clearRect(0, 0, this.liveCanvas.width, this.liveCanvas.height);
    this._localTempId = null;
  }

  // ------------------ drawing helper ------------------
  _drawSmooth(ctx, pts, color, size) {
    if (!pts || pts.length < 2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const midX = (pts[i].x + pts[i + 1].x) / 2;
      const midY = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
    }
    ctx.stroke();
  }

  // ------------------ remote / incoming events ------------------
  // remote starts an in-progress stroke (store by id)
  startRemoteStroke(data) {
    if (!data || !data.id) return;
    this.remoteStrokes[data.id] = { ...data };
  }

  // remote moves — append points and draw preview on remote canvas
  updateRemoteStroke(data) {
    // data might include id and points array
    if (!data || !data.id) {
      // fallback: try to update first remote stroke
      const first = Object.values(this.remoteStrokes)[0];
      if (first) {
        first.points.push(...(data.points || []));
        this.rctx.clearRect(
          0,
          0,
          this.remoteCanvas.width,
          this.remoteCanvas.height
        );
        this._drawSmooth(this.rctx, first.points, first.color, first.size);
      }
      return;
    }
    const s = this.remoteStrokes[data.id];
    if (!s) return;
    s.points.push(...(data.points || []));
    this.rctx.clearRect(
      0,
      0,
      this.remoteCanvas.width,
      this.remoteCanvas.height
    );
    this._drawSmooth(this.rctx, s.points, s.color, s.size);
  }

  // remote committed the stroke
  commitRemoteStroke(stroke) {
    if (!stroke) return;
    // add to local strokes then redraw history (server will also soon emit sync:history)
    this.strokes.push(stroke);
    this._drawSmooth(this.hctx, stroke.points, stroke.color, stroke.size);

    // remove any remote preview with same id
    if (stroke.id && this.remoteStrokes[stroke.id]) {
      delete this.remoteStrokes[stroke.id];
      this.rctx.clearRect(
        0,
        0,
        this.remoteCanvas.width,
        this.remoteCanvas.height
      );
    }
  }

  // ------------------ authoritative history sync (undo/redo & join) ------------------
  // Replace local strokes with server's authoritative history and redraw
  syncHistory(history) {
    if (!Array.isArray(history)) history = [];
    this.strokes = history.slice(); // copy
    // redraw history canvas from scratch
    this.hctx.clearRect(
      0,
      0,
      this.historyCanvas.width,
      this.historyCanvas.height
    );
    for (const s of this.strokes) {
      this._drawSmooth(this.hctx, s.points, s.color, s.size);
    }
    // clear remote preview + live layer
    this.rctx.clearRect(
      0,
      0,
      this.remoteCanvas.width,
      this.remoteCanvas.height
    );
    this.lctx.clearRect(0, 0, this.liveCanvas.width, this.liveCanvas.height);
  }

  // ------------------ Active users list ------------------
  updateActiveUsers(users) {
    this.activeUsers = users || {};
    const ul = document.getElementById("user-list");
    if (!ul) return;
    ul.innerHTML = "";
    Object.values(users || {}).forEach((u) => {
      const li = document.createElement("li");
      li.className = "user";
      li.textContent = `👤 ${u.name}`;
      li.style.color = u.color;
      ul.appendChild(li);
    });
  }

  // ------------------ cursors ------------------
  updateRemoteCursor(cursor) {
    // cursor: { id, name, color, x, y }
    this.remoteCursors[cursor.id] = cursor;
    this._renderCursors();
  }
  _renderCursors() {
    this.cctx.clearRect(
      0,
      0,
      this.cursorCanvas.width,
      this.cursorCanvas.height
    );
    for (const c of Object.values(this.remoteCursors)) {
      this.cctx.beginPath();
      this.cctx.fillStyle = c.color;
      this.cctx.arc(c.x, c.y, 6, 0, Math.PI * 2);
      this.cctx.fill();
      this.cctx.font = "10px sans-serif";
      this.cctx.fillStyle = "#fff";
      this.cctx.fillText(c.name, c.x + 8, c.y + 4);
    }
  }
}
