require('dotenv').config();
const app  = require('./app');
const { pool } = require('./config/database');
const fs   = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

async function startServer() {
  try {
    // Verify database connection before accepting traffic
    await pool.query('SELECT 1');
    console.log('[server] ✅ Database connected');

    app.listen(PORT, () => {
      console.log(`[server] 🚀 Running on http://localhost:${PORT}`);
      console.log(`[server] Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (err) {
    console.error('[server] ❌ Failed to start:', err.message);
    process.exit(1);
  }
}

startServer();
