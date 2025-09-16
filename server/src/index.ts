import dotenv from 'dotenv';
import { createApp } from './app';

dotenv.config({ path: '../.env' });

const PORT = parseInt(process.env.PORT || '3001', 10);
const app = createApp();

// Listen on all interfaces (0.0.0.0) to allow access from Windows host
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📧 Nexus Mail Backend Ready`);
  console.log(`   Accessible from Windows at http://localhost:${PORT}`);
});