import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // With VITE_API=http the app calls /api/v1 on the backend (npm run dev:api).
    proxy: { '/api': process.env.API_URL ?? 'http://localhost:3000' },
  },
});
