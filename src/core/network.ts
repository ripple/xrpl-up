import { Client } from 'xrpl';
import { NetworkConfig } from './config';

export interface ServerInfo {
  ledgerIndex: number;
  networkId?: number;
  completeLedgers?: string;
  buildVersion?: string;
}

export class NetworkManager {
  private _client: Client;
  private _networkName: string;
  private _networkConfig: NetworkConfig;

  constructor(networkName: string, networkConfig: NetworkConfig) {
    this._networkName = networkName;
    this._networkConfig = networkConfig;
    this._client = new Client(networkConfig.url, { timeout: 60_000 });
  }

  get client(): Client {
    return this._client;
  }

  get url(): string {
    return this._networkConfig.url;
  }

  get displayName(): string {
    return this._networkConfig.name ?? this._networkName;
  }

  get networkName(): string {
    return this._networkName;
  }

  async connect(): Promise<void> {
    await this._client.connect();
  }

  async disconnect(): Promise<void> {
    if (this._client.isConnected()) {
      await this._client.disconnect();
    }
  }

  async getServerInfo(): Promise<ServerInfo> {
    const res = await this._client.request({ command: 'server_info' });
    const info = res.result.info;
    return {
      ledgerIndex: info.validated_ledger?.seq ?? 0,
      networkId: info.network_id,
      completeLedgers: info.complete_ledgers,
      buildVersion: info.build_version,
    };
  }

  async subscribeToLedger(
    onClose: (ledgerIndex: number, txnCount: number) => void
  ): Promise<void> {
    await this._client.request({ command: 'subscribe', streams: ['ledger'] });
    // xrpl v2 typed overloads don't include 'ledgerClosed' but the event is emitted
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this._client as any).on('ledgerClosed', (data: Record<string, unknown>) => {
      onClose(
        (data.ledger_index as number) ?? 0,
        (data.txn_count as number) ?? 0
      );
    });
  }

  /**
   * Subscribe to all validated transactions on this network.
   * In local mode every transaction comes from the developer's own scripts —
   * on public networks this would include all other users' transactions too.
   */
  async subscribeToTransactions(
    onTx: (tx: Record<string, unknown>) => void
  ): Promise<void> {
    await this._client.request({ command: 'subscribe', streams: ['transactions'] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this._client as any).on('transaction', onTx);
  }
}
