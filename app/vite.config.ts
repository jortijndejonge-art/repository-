import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_BASE sets the folder the app is served from, e.g. "/myhockey/" for
// www.solarbytez.com/myhockey. Defaults to the site root.
const base = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    host: true,
    // With VITE_API=http the app calls <base>api/v1 on the backend (npm run dev:api).
    proxy: {
      [`${base}api`]: {
        target: process.env.API_URL ?? 'http://localhost:3000',
        rewrite: (path) => path.replace(new RegExp(`^${base}`), '/'),
      },
    },
  },
});
