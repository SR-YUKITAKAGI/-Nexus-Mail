import dotenv from 'dotenv';
import { createApp } from './app';

dotenv.config({ path: '../.env' });

const PORT = process.env.PORT || 3001;
const app = createApp();

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📧 Nexus Mail Backend Ready`);
});