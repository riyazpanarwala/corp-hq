// src/lib/socket.js
const { Server } = require("socket.io");
const { verifyAccessToken, extractBearerToken } = require("./auth");

let io = null;

function initSocket(httpServer) {
  if (io) return io;

  io = new Server(httpServer, {
    path: "/api/socket",
    cors: {
      origin:  process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
      methods: ["GET", "POST"],
    },
    transports: ["websocket", "polling"],
  });

  // JWT middleware
  io.use(async (socket, next) => {
    try {
      const raw = socket.handshake.auth?.token || socket.handshake.headers?.authorization;
      const token = extractBearerToken(raw || ("Bearer " + raw));
      if (!token) throw new Error("No token");
      const payload = await verifyAccessToken(token);
      socket.data.userId = payload.sub;
      socket.data.role   = payload.role;
      socket.data.name   = payload.name;
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const { userId, role, name } = socket.data;
    console.log(`[Socket] ${name} (${role}) connected`);
    if (role === "ADMIN")  socket.join("admin-room");
    socket.join(`user-${userId}`);
    socket.on("disconnect", () => console.log(`[Socket] ${name} disconnected`));
  });

  return io;
}

function emitToAdmins(event, data) { io?.to("admin-room").emit(event, data); }
function emitToUser(userId, event, data) { io?.to(`user-${userId}`).emit(event, data); }

module.exports = { initSocket, emitToAdmins, emitToUser };
