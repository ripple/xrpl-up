import { Client } from 'xrpl';
import { NetworkConfig } from './config';
export interface ServerInfo {
    ledgerIndex: number;
    networkId?: number;
    completeLedgers?: string;
    buildVersion?: string;
}
export declare class NetworkManager {
    private _client;
    private _networkName;
    private _networkConfig;
    constructor(networkName: string, networkConfig: NetworkConfig);
    get client(): Client;
    get url(): string;
    get displayName(): string;
    get networkName(): string;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    getServerInfo(): Promise<ServerInfo>;
    subscribeToLedger(onClose: (ledgerIndex: number, txnCount: number) => void): Promise<void>;
    /**
     * Subscribe to all validated transactions on this network.
     * In local mode every transaction comes from the developer's own scripts —
     * on public networks this would include all other users' transactions too.
     */
    subscribeToTransactions(onTx: (tx: Record<string, unknown>) => void): Promise<void>;
}
//# sourceMappingURL=network.d.ts.map