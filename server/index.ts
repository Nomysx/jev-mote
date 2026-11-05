// Mote server entry point (npm run dev / npm start).

import { startMote } from './main';

startMote()
  .then((mote) => {
    const shutdown = () => {
      void mote.close().finally(() => process.exit(0));
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  })
  .catch((err) => {
    console.error('[mote] failed to start:', err);
    process.exit(1);
  });
