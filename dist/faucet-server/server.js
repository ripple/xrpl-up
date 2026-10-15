"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_http_1 = __importDefault(require("node:http"));
const xrpl_1 = require("xrpl");
const RIPPLED_WS_URL = process.env.RIPPLED_WS_URL ?? 'ws://rippled:80';
const PORT = parseInt(process.env.FAUCET_PORT ?? '3001', 10);
const FUND_AMOUNT_XRP = parseInt(process.env.FUND_AMOUNT_XRP ?? '1000', 10);
const LEDGER_INTERVAL_MS = parseInt(process.env.LEDGER_INTERVAL_MS ?? '0', 10);
const GENESIS_SEED = 'snoPBrXtMeMyMHUVTgbuqAfg1SUTb';
// Singleton client — reuse one WebSocket connection for all requests
let client = null;
async function getClient() {
    if (client && client.isConnected())
        return client;
    client = new xrpl_1.Client(RIPPLED_WS_URL, { timeout: 60_000 });
    // Swallow connection-level errors (e.g. rippled restarting for a snapshot).
    // The HTTP server stays up; the next request will reconnect via this function.
    client.on('error', () => { client = null; });
    await client.connect();
    // A build off plain develop reports `0.0.0-dev+<sha>`. xrpl.js only adds the
    // required NetworkID for servers reporting >= 1.11.0, so every payment would
    // be rejected with telREQUIRES_NETWORK_ID. A 0.0.0 build is the newest code.
    if (client.buildVersion && /^0\.0\.0(?![0-9])/.test(client.buildVersion)) {
        client.buildVersion = '999.0.0';
    }
    return client;
}
/** Read the full request body as a string. */
function readBody(req) {
    return new Promise((resolve) => {
        let data = '';
        req.on('data', (chunk) => { data += chunk.toString(); });
        req.on('end', () => resolve(data));
        req.on('error', () => resolve(''));
    });
}
/**
 * Fund a wallet on the local sandbox.
 *
 * - If `destination` is provided: send FUND_AMOUNT_XRP to that address.
 *   Returns `{ address, balance }` — no seed (caller already has it).
 * - If `destination` is omitted: generate a fresh wallet, fund it, and
 *   return `{ address, seed, balance }`.
 */
async function fundWallet(destination) {
    const c = await getClient();
    const genesis = xrpl_1.Wallet.fromSeed(GENESIS_SEED);
    let targetAddress;
    let newWallet;
    if (destination) {
        targetAddress = destination;
    }
    else {
        newWallet = xrpl_1.Wallet.generate();
        targetAddress = newWallet.address;
    }
    const paymentTx = await c.autofill({
        TransactionType: 'Payment',
        Account: genesis.address,
        Amount: (0, xrpl_1.xrpToDrops)(String(FUND_AMOUNT_XRP)),
        Destination: targetAddress,
    });
    const { tx_blob } = genesis.sign(paymentTx);
    const submitted = await c.submit(tx_blob);
    // tem/tef/tel mean the payment was rejected outright. Reporting success here
    // would hand the caller an address that never reaches the ledger.
    const engineResult = submitted.result.engine_result;
    if (/^(tem|tef|tel)/.test(engineResult)) {
        throw new Error(`Funding payment rejected: ${engineResult} ${submitted.result.engine_result_message}`);
    }
    // Advance the ledger to validate the funding transaction.
    // Wrap in try/catch — the CLI's auto-advance ticker may beat us to it; harmless.
    try {
        await c.request({ command: 'ledger_accept' });
    }
    catch {
        // ledger already closed by someone else — that's fine
    }
    return {
        address: targetAddress,
        ...(newWallet ? { seed: newWallet.seed ?? '' } : {}),
        balance: FUND_AMOUNT_XRP,
    };
}
const server = node_http_1.default.createServer(async (req, res) => {
    // Health check
    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
    }
    // Fund a wallet
    if (req.method === 'POST' && req.url === '/faucet') {
        try {
            // Read optional body — { destination?: string }
            let destination;
            const rawBody = await readBody(req);
            if (rawBody) {
                try {
                    const parsed = JSON.parse(rawBody);
                    if (parsed.destination && typeof parsed.destination === 'string') {
                        destination = parsed.destination;
                    }
                }
                catch { /* ignore malformed JSON — treat as no destination */ }
            }
            const result = await fundWallet(destination);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: message }));
        }
        return;
    }
    res.writeHead(404);
    res.end();
});
server.listen(PORT, () => {
    console.log(`[faucet] listening on port ${PORT}, rippled at ${RIPPLED_WS_URL}`);
});
// Auto-advance ledger (detach mode only — when CLI is not running)
if (LEDGER_INTERVAL_MS > 0) {
    const advance = async () => {
        try {
            const c = await getClient();
            await c.request({ command: 'ledger_accept' });
        }
        catch { /* swallow — rippled may be restarting */ }
        setTimeout(advance, LEDGER_INTERVAL_MS);
    };
    setTimeout(advance, LEDGER_INTERVAL_MS);
    console.log(`[faucet] auto-advancing ledger every ${LEDGER_INTERVAL_MS}ms`);
}
// Graceful shutdown
process.on('SIGTERM', async () => {
    if (client?.isConnected())
        await client.disconnect();
    server.close(() => process.exit(0));
});
