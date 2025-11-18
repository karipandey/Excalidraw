import http from "http";
import { WebSocketServer } from "ws";
import fs from "fs";
import path from "path";
import os from "os";

const port = 1234;
// Persist rooms to OS temp directory during development to avoid triggering nodemon restarts
const roomsDir = path.resolve(os.tmpdir(), "excalidraw-rooms");

if (!fs.existsSync(roomsDir)) {
  fs.mkdirSync(roomsDir, { recursive: true });
}

const server = http.createServer((req, res) => {
  // Allow simple CORS for health checks from the browser during development
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("simple websocket relay with patch/persistence\n");
});

const wss = new WebSocketServer({ server });

const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    // try to load from disk
    const file = path.join(roomsDir, `${roomId}.json`);
    let scene = null;
    if (fs.existsSync(file)) {
      try {
        const txt = fs.readFileSync(file, "utf8");
        scene = JSON.parse(txt);
      } catch (err) {
        console.error("failed loading room file", file, err);
      }
    }
    rooms.set(roomId, { scene, clients: new Set(), lastSeq: 0 });
  }
  return rooms.get(roomId);
}

function persistRoom(roomId) {
  const r = rooms.get(roomId);
  if (!r) return;
  const file = path.join(roomsDir, `${roomId}.json`);
  try {
    fs.writeFileSync(file, JSON.stringify(r.scene || {}), "utf8");
  } catch (err) {
    console.error("failed writing room file", file, err);
  }
}

// on startup, pre-load any room files
for (const f of fs.readdirSync(roomsDir)) {
  if (f.endsWith(".json")) {
    const id = f.slice(0, -5);
    getRoom(id);
  }
}

// Helper to apply a patch to a scene object
function applyPatchToScene(scene, patch) {
  const s = scene || { elements: [], appState: {} };
  const byId = new Map(s.elements.map((el) => [el.id, el]));
  // removals
  if (Array.isArray(patch.removed)) {
    for (const id of patch.removed) {
      byId.delete(id);
    }
  }
  // updates
  if (Array.isArray(patch.updated)) {
    for (const el of patch.updated) {
      if (!el.id) continue;
      byId.set(el.id, el);
    }
  }
  // additions
  if (Array.isArray(patch.added)) {
    for (const el of patch.added) {
      if (!el.id) continue;
      byId.set(el.id, el);
    }
  }
  const elements = Array.from(byId.values());
  const appState = patch.appState || s.appState || {};
  return { elements, appState };
}

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.roomId = null;

  ws.on("pong", () => (ws.isAlive = true));

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (err) {
      console.log("error parsing ws message", err);
      return;
    }

    if (msg?.type === "join") {
      const { room } = msg;
      if (!room) return;
      const r = getRoom(room);
      r.clients.add(ws);
      ws.roomId = room;
      console.log(`client joined room=${room} clients=${r.clients.size}`);
      // send existing scene (with sequence) if present
      if (r.scene) {
        ws.send(
          JSON.stringify({ type: "scene", seq: r.lastSeq, data: r.scene })
        );
      }
      return;
    }

    if (msg?.type === "scene") {
      // legacy: full scene replace
      const room = ws.roomId || msg.room;
      if (!room) return;
      const r = getRoom(room);
      r.lastSeq = (r.lastSeq || 0) + 1;
      r.scene = msg.data;
      persistRoom(room);
      console.log(
        `received full scene for room=${room}, seq=${
          r.lastSeq
        }, broadcasting to ${r.clients.size - 1} peers`
      );
      for (const client of r.clients) {
        if (client !== ws && client.readyState === 1) {
          client.send(
            JSON.stringify({ type: "scene", seq: r.lastSeq, data: msg.data })
          );
        }
      }
      return;
    }

    if (msg?.type === "patch") {
      const room = ws.roomId || msg.room;
      if (!room) return;
      const r = getRoom(room);
      r.lastSeq = (r.lastSeq || 0) + 1;
      console.log(`server received patch for room=${room} seq=${r.lastSeq}`);
      // apply patch to r.scene
      try {
        r.scene = applyPatchToScene(r.scene, msg.data || {});
        persistRoom(room);
      } catch (err) {
        console.error("failed applying patch", err);
      }
      // broadcast patch to others
      let sent = 0;
      for (const client of r.clients) {
        if (client !== ws && client.readyState === 1) {
          try {
            client.send(
              JSON.stringify({ type: "patch", seq: r.lastSeq, data: msg.data })
            );
            sent++;
          } catch (err) {
            console.error("failed sending patch to client", err);
          }
        }
      }
      console.log(`broadcasted patch seq=${r.lastSeq} to ${sent} peers`);
      return;
    }

    if (msg?.type === "ack") {
      const room = ws.roomId || msg.room;
      if (!room) return;
      console.log(`ack received for room=${room} seq=${msg.seq}`);
      return;
    }
  });

  ws.on("close", () => {
    const room = ws.roomId;
    if (!room) return;
    const r = rooms.get(room);
    if (!r) return;
    r.clients.delete(ws);
    console.log(`client left room=${room} clients=${r.clients.size}`);
    // if no clients remain, we still persist the scene to disk (already done on updates)
  });
});

// simple ping to detect dead clients
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping(() => {});
  }
}, 30000);

server.listen(port, () => {
  console.log(`websocket relay server running on port ${port}`);
});
