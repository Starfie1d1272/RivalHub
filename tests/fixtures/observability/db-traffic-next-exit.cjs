/* eslint-disable @typescript-eslint/no-require-imports -- Patch fs before loading the CommonJS Next server and traffic modules. */
// Exercise Next's own SIGTERM cleanup against a local build; never contacts a service.
const fs = require('node:fs/promises');
const originalOpen = fs.open;
let blockNextSync = false;
fs.open = async (...args) => {
  const file = await originalOpen(...args);
  if (blockNextSync && String(args[0]).endsWith('.tmp')) {
    blockNextSync = false;
    file.sync = () => new Promise(() => {});
  }
  return file;
};
const { startServer } = require(process.cwd() + '/node_modules/next/dist/server/lib/start-server');
const { recordDbTraffic, flushDbTraffic, observeDbStream } = require(process.cwd() + '/src/lib/observability/db-traffic.ts');
const { preparePgTraffic } = require(process.cwd() + '/src/lib/observability/pg-traffic-adapter.ts');
const { EventEmitter } = require('node:events');
process.env.NODE_ENV = 'production';
process.env.RIVALHUB_RUNTIME_HEALTH_ENABLED = '0';
process.env.DB_TRAFFIC_KEY = 'x'.repeat(32);
process.env.PRODUCT_TELEMETRY_ENDPOINT = 'https://example.invalid/v1/batches';
process.env.DB_TRAFFIC_SPOOL_DIRECTORY = process.argv[2];
global.fetch = () => new Promise(() => {});
(async () => {
  await startServer({ dir: process.cwd(), isDev: false, hostname: '127.0.0.1', port: 0, allowRetry: false });
  process.env.RIVALHUB_RUNTIME_HEALTH_ENABLED = '1'; flushDbTraffic();
  const startup = setInterval(() => {
    const state = process[Symbol.for('rivalhub.db-traffic.v3')];
    if (!state?.deliveryStarted || state.sending) return;
    clearInterval(startup);
    const addPartial = () => {
      const stream = new EventEmitter();
      const connection = Object.assign(new EventEmitter(), { attachListeners() {} });
      const client = Object.assign(new EventEmitter(), { connection, _activeQuery: null, _queryQueue: [], _sentQueryQueue: [] });
      preparePgTraffic(client); connection.attachListeners(stream); observeDbStream(client);
      stream.emit('data', Buffer.alloc(3));
    };
    if (process.argv[3] === 'partial') { addPartial(); process.stdout.write('CAPSULE_READY\n'); return; }
    blockNextSync = process.argv[3] === 'sync' || process.argv[3] === 'partial-sync';
    recordDbTraffic('unknown', 'unknown', 2, 1, false); flushDbTraffic();
    const pending = setInterval(() => {
      if (process.argv[3] === 'sync' || process.argv[3] === 'partial-sync' ? !state.sealing || blockNextSync : !state.sending || state.sealing) return;
      clearInterval(pending); if (process.argv[3] === 'partial-sync') addPartial(); else recordDbTraffic('unknown', 'unknown', 3, 1, false); process.stdout.write('CAPSULE_READY\n');
    }, 5);
  }, 5);
})().catch(error => { console.error(error); process.exit(1); });
