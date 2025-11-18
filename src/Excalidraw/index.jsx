import { useRef, useEffect, useState, useCallback } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import "./index.css";
const WS_URL = "ws://localhost:1234";

const ExcalidrawComponent = () => {
  const excalidrawRef = useRef(null);
  const wsRef = useRef(null);

  const applying = useRef(false);
  const pendingTimer = useRef(null);
  const lastSeq = useRef(0);
  const lastSentElementsRef = useRef([]);
  const lastKnownElementsRef = useRef([]);

  const [roomId, setRoomId] = useState(() => {
    const p = new URL(window.location.href);
    return p.searchParams.get("room") || "";
  });

  const [connected, setConnected] = useState(false);

  const connectToRoom = useCallback((room) => {
    if (!room) return;

    wsRef.current?.close();
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: "join", room }));
    };

    ws.onclose = () => {
      setConnected(false);
    };
    ws.onerror = () => {
      setConnected(false);
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      const seq = msg.seq || 0;
      if (seq <= lastSeq.current) return;
      lastSeq.current = seq;

      if (msg.type === "scene") {
        applying.current = true;
        lastKnownElementsRef.current = msg.data.elements || [];
        lastSentElementsRef.current = lastKnownElementsRef.current;
        excalidrawRef.current?.updateScene(msg.data);
        setTimeout(() => (applying.current = false), 50);
      }

      if (msg.type === "patch") {
        const p = msg.data;
        const map = new Map(lastKnownElementsRef.current.map((e) => [e.id, e]));

        p.removed?.forEach((id) => map.delete(id));
        p.updated?.forEach((el) => map.set(el.id, el));
        p.added?.forEach((el) => map.set(el.id, el));

        lastKnownElementsRef.current = [...map.values()];

        applying.current = true;
        excalidrawRef.current?.updateScene({
          elements: lastKnownElementsRef.current,
        });
        setTimeout(() => (applying.current = false), 50);
      }
    };
  }, []);

  // auto-connect if room present in URL on mount
  useEffect(() => {
    if (roomId) connectToRoom(roomId);
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, [roomId, connectToRoom]);

  // SEND PATCHES TO SERVER
  const sendScene = useCallback(
    (elements) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== 1) return;

      const prev = lastSentElementsRef.current || [];
      const prevMap = new Map(prev.map((el) => [el.id, el]));
      const currMap = new Map(elements.map((el) => [el.id, el]));

      const added = [];
      const updated = [];
      const removed = [];

      elements.forEach((el) => {
        const old = prevMap.get(el.id);
        if (!old) added.push(el);
        else if (JSON.stringify(old) !== JSON.stringify(el)) updated.push(el);
      });

      prev.forEach((el) => {
        if (!currMap.has(el.id)) removed.push(el.id);
      });

      if (!added.length && !updated.length && !removed.length) return;

      ws.send(
        JSON.stringify({
          type: "patch",
          room: roomId,
          data: { added, updated, removed },
        })
      );

      lastSentElementsRef.current = elements;
    },
    [roomId]
  );

  const handleOnChange = useCallback(
    (elements, state) => {
      if (applying.current) return;
      clearTimeout(pendingTimer.current);
      pendingTimer.current = setTimeout(() => sendScene(elements, state), 300);
    },
    [sendScene]
  );

  const createShareLink = useCallback(() => {
    const id = Math.random().toString(36).slice(2, 10);
    const url = new URL(window.location.href);
    url.searchParams.set("room", id);
    window.history.pushState({}, "", url.toString());
    setRoomId(id);
    navigator.clipboard.writeText(url.toString());
    alert(`Copied share link:\n${url}`);
  }, []);

  return (
    <div className="excal-root">
      <div className="excal-toolbar">
        <button onClick={createShareLink}>
          {roomId ? "Copy link" : "Share"}
        </button>
        {roomId && (
          <div className="excal-room">
            Room: <code>{roomId}</code> —
            {connected ? " connected" : " connecting..."}
          </div>
        )}
      </div>

      <div className="excal-wrapper">
        <Excalidraw
          excalidrawAPI={(api) => (excalidrawRef.current = api)}
          onChange={handleOnChange}
          style={{ width: "100%", height: "100%" }}
        />
      </div>
    </div>
  );
};

export default ExcalidrawComponent;
