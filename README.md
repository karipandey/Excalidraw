# Excalidraw Local Collaboration

A simple local-only collaborative Excalidraw setup using:

1. WebSocket server (y-websocket-server.js)
2. Vite-powered React frontend

Real-time drawing sync across multiple browser tabs/windows on localhost.

# Getting Started
1. Install
npm install

2. Run Server
npm run dev-server

Server listens on ws://localhost:1234.

3. Run Frontend
npm run dev

4. Open http://localhost:5173 in multiple tabs to test collaboration.

5. Sharing Rooms

Click Share → generates a unique room URL

Open the same URL in another tab to collaborate in real time

# Notes

Local-only, no database or auth
Server resets on restart
Optimized for local development Only

# Special Notes

I didnt get much time since I am currently on vacation, hence I was unable to deploy this.
I have made this application for local purpose only
This application is using the websockets for the real time syncing of drawings and file system for persistence

1 thing I was unable to do was: On closing the tab, and then opening it, the drawings should persist. 