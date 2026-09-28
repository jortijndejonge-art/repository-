import { createHttpClient } from './http';
import { createMockClient } from './mock';
import type { ApiClient } from './types';

export * from './types';

/**
 * VITE_API=http talks to the real backend; anything else uses the in-browser
 * mock with the demo club (handy for demos without a server).
 */
export const api: ApiClient = import.meta.env.VITE_API === 'http' ? createHttpClient() : createMockClient();
