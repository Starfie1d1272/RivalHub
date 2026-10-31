/* eslint-disable @typescript-eslint/no-require-imports -- Substitute the source register hook in an actual Next server. */
global.AsyncLocalStorage = require("node:async_hooks").AsyncLocalStorage;
const fs = require('node:fs/promises'); const originalOpen = fs.open; let unblock;
if (process.argv[4] === 'held') fs.open = async (...args) => { const file = await originalOpen(...args); if (String(args[0]).endsWith('.tmp') && !unblock) { file.sync = () => { process.stdout.write('MARKER_WAIT\n'); return new Promise(resolve => { unblock = resolve; }); }; } return file; };
process.on('message', async message => { if (message === 'release' && unblock) unblock(); if (message === 'retry') { const { initializeDbTraffic } = require(process.cwd() + '/src/lib/observability/db-traffic.ts'); const ready = await initializeDbTraffic(); const raw = await fs.readFile(process.argv[2] + '/state.json', 'utf8'); process.send({ event: 'retried', ready, unknown: JSON.parse(raw).coverageUnknownSince !== null }); } });
const { Module } = require('node:module'); const only = require.resolve(process.cwd() + '/node_modules/server-only'); const stub = new Module(only); stub.loaded = true; stub.exports = {}; require.cache[only] = stub;
const globalsPath = require.resolve(process.cwd() + '/node_modules/next/dist/server/lib/router-utils/instrumentation-globals.external.js'); const actual = require(globalsPath);
const register = async () => { process.env.NEXT_RUNTIME = 'nodejs'; await require(process.cwd() + '/src/instrumentation.ts').register(); };
require.cache[globalsPath].exports = { ...actual, ensureInstrumentationRegistered: register, ensureInstrumentationRegisteredWithDeferredSpans: register };
process.env.NODE_ENV = 'production'; process.env.DB_TRAFFIC_KEY = 'x'.repeat(32); process.env.PRODUCT_TELEMETRY_ENDPOINT = 'https://example.invalid/v1/batches'; process.env.DB_TRAFFIC_SPOOL_DIRECTORY = process.argv[2];
const { startServer } = require(process.cwd() + '/node_modules/next/dist/server/lib/start-server');
startServer({dir:process.cwd(),isDev:false,hostname:'127.0.0.1',port:Number(process.argv[3]),allowRetry:false}).then(()=> { const s=process[Symbol.for('rivalhub.db-traffic.v3')]; process.send({event:'ready',durable:!!s?.deliveryStarted,degraded:s?.degradedSince!==undefined}); }).catch(error=>{console.error(error);process.exit(1)});
