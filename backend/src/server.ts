import 'dotenv/config';
import { createServer } from 'http';
import mongoose from 'mongoose';
import app from './app.js';
import { initAuth } from './auth.js';
import { initSocket } from './socket.js';

const PORT = process.env.PORT || 5000;

// Create HTTP server from Express app (required for Socket.IO)
const httpServer = createServer(app);

// Database connection
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI as string, {
      maxPoolSize: 50, // Based on mongohost limits adjust accordingly: 50
      minPoolSize: 10   // Based on mongohost limits adjust accordingly: 10,
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error('Error connecting to MongoDB:', error);
    process.exit(1);
  }
};

// Start the server
const startServer = async () => {
  // Database connection
  await connectDB();

  // Heal devices accidentally revoked by single-device policy bug, restoring up to 10 active devices per user
  try {
    const Device = (await import('./models/Device.js')).default;
    const usersWithDevices = await Device.distinct('userId');
    for (const uid of usersWithDevices) {
      const devices = await Device.find({ userId: uid })
        .sort({ registeredAt: -1, updatedAt: -1 })
        .limit(10);
      const revokedIds = devices.filter((d) => d.revokedAt != null).map((d) => d._id);
      if (revokedIds.length > 0) {
        await Device.updateMany({ _id: { $in: revokedIds } }, { $unset: { revokedAt: 1 } });
        console.log(`[E2EE] Restored active status for ${revokedIds.length} device(s) (user ${uid})`);
      }
    }
  } catch (healErr) {
    console.warn('[E2EE] Startup device recovery warning:', healErr);
  }

  // Initialize Better Auth
  initAuth();

  // Initialize Socket.IO on the HTTP server
  initSocket(httpServer);

  httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

startServer();

