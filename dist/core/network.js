"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NetworkManager = void 0;
const xrpl_1 = require("xrpl");
const dev_build_1 = require("../utils/dev-build");
const client_1 = require("../cli/utils/client");
class NetworkManager {
    _client;
    _networkName;
    _networkConfig;
    constructor(networkName, networkConfig) {
        this._networkName = networkName;
        this._networkConfig = networkConfig;
        this._client = new xrpl_1.Client(networkConfig.url, { timeout: 60_000 });
    }
    get client() {
        return this._client;
    }
    get url() {
        return this._networkConfig.url;
    }
    get displayName() {
        return this._networkConfig.name ?? this._networkName;
    }
    get networkName() {
        return this._networkName;
    }
    async connect() {
        await this._client.connect();
        (0, dev_build_1.normalizeDevBuildVersion)(this._client);
        // Same gate as cli/utils/client.ts's withClient — status/accounts go
        // through this separate connection path, not withClient, and previously
        // had no mainnet check of any kind (faucet/node.ts already have their
        // own independent isMainnet() hostname check before ever constructing a
        // NetworkManager, so this is redundant-but-harmless for those two).
        const isLocal = /localhost|127\.0\.0\.1/i.test(this._networkConfig.url);
        if ((0, client_1.shouldBlockMainnet)(this._client.networkID, isLocal)) {
            await this._client.disconnect();
            throw new client_1.MainnetBlockedError(this._networkConfig.url);
        }
    }
    async disconnect() {
        if (this._client.isConnected()) {
            await this._client.disconnect();
        }
    }
    async getServerInfo() {
        const res = await this._client.request({ command: 'server_info' });
        const info = res.result.info;
        return {
            ledgerIndex: info.validated_ledger?.seq ?? 0,
            networkId: info.network_id,
            completeLedgers: info.complete_ledgers,
            buildVersion: info.build_version,
        };
    }
    async subscribeToLedger(onClose) {
        await this._client.request({ command: 'subscribe', streams: ['ledger'] });
        // xrpl v2 typed overloads don't include 'ledgerClosed' but the event is emitted
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this._client.on('ledgerClosed', (data) => {
            onClose(data.ledger_index ?? 0, data.txn_count ?? 0);
        });
    }
    /**
     * Subscribe to all validated transactions on this network.
     * In local mode every transaction comes from the developer's own scripts —
     * on public networks this would include all other users' transactions too.
     */
    async subscribeToTransactions(onTx) {
        await this._client.request({ command: 'subscribe', streams: ['transactions'] });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this._client.on('transaction', onTx);
    }
}
exports.NetworkManager = NetworkManager;
