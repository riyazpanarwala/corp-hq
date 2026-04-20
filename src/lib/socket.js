// src/lib/socket.js
const { Server }               = require("socket.io");
const { verifyAccessToken }    = require("./auth");

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
      // MAJOR FIX: The old code did:
      //   extractBearerToken(raw || ("Bearer " + raw))
      // If `raw` was already "Bearer <token>", the fallback produced
      // "Bearer Bearer <token>" — extractBearerToken would then return null
      // and every socket connection would fail with "Unauthorized".
      //
      // Now we normalise the raw value directly without calling extractBearerToken:
      const raw = socket.handshake.auth?.token
               || socket.handshake.headers?.authorization;

      if (!raw) throw new Error("No token provided");

      // Strip "Bearer " prefix if present, otherwise use the raw value as-is
      const token = raw.startsWith("Bearer ") ? raw.slice(7) : raw;

      if (!token) throw new Error("Empty token");

      const payload = await verifyAccessToken(token);
      socket.data.userId = payload.sub;
      socket.data.role   = payload.role;
      socket.data.name   = payload.name;
      next();
    } catch (err) {
      console.warn("[Socket] Auth failed:", err.message);
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const { userId, role, name } = socket.data;
    console.log(`[Socket] ${name} (${role}) connected`);
    if (role === "ADMIN") socket.join("admin-room");
    socket.join(`user-${userId}`);
    socket.on("disconnect", () => console.log(`[Socket] ${name} disconnected`));
  });

  return io;
}

function emitToAdmins(event, data)           { io?.to("admin-room").emit(event, data);       }
function emitToUser(userId, event, data)     { io?.to(`user-${userId}`).emit(event, data);   }

module.exports = { initSocket, emitToAdmins, emitToUser };
