import WebSocket from 'isomorphic-ws';
import { MempoolOptions, addDefaultOptions, Transaction, AddressTransactionsResponse } from './interfaces';

export enum ConnectionState {
  Connected,
  Connecting,
  Offline
}

export enum AddressTxEvent {
  mempool = 'mempool',
  confirmed = 'confirmed',
  removed = 'removed',
} 

export class MempoolSocket {
  private options: MempoolOptions;
  private wsUrl: string;

  private heartbeatTimer = null;
  private lastResponseTime = 0;
  private websocketState: ConnectionState = ConnectionState.Offline;
  private ws: WebSocket | null = null;
  private addressTxCallbacks: {
    [event in AddressTxEvent]?: (address: string, tx: Transaction) => void;
  } = {};
  private outQueue: string[] = [];

  constructor(options: MempoolOptions = {}) {
    this.options = addDefaultOptions(options);
    const networkPath = ['testnet', 'signet'].includes(this.options.network || '') ? ('/' + this.options.network) : '';
    this.wsUrl = `${this.options.secure ? 'wss' : 'ws'}://${this.options.hostname}${networkPath}/api/v1/ws`;
  }

  private async init(): Promise<WebSocket> {
    if (!this.ws && this.websocketState === ConnectionState.Offline) {
      return new Promise((resolve, reject) => {
        this.websocketState = ConnectionState.Connecting;
        const connectionTimeout = setTimeout(() => { reject('websocket connection timed out'); }, 5000);

        try {
          this.ws = this.ws = new WebSocket(this.wsUrl);

          this.ws.on('error', console.error);

          this.ws.on('close', () => {
            this.handleClose();
          })

          this.ws.on('message', (msg: any) => {
            this.handleResponse(msg);
          });

          this.ws.on('open', () => {
            this.handleOpen();
            clearTimeout(connectionTimeout);
            resolve(this.ws as WebSocket);
          });
        } catch (e) {
          reject(e);
        }
      });
    } else if (this.ws && this.websocketState === ConnectionState.Connected) {
      return Promise.resolve(this.ws);
    } else {
      await new Promise((resolve) => {
        setTimeout(resolve, 2000);
      });
      return this.init();
    }
  }

  private async connect(): Promise<WebSocket> {
    return this.init();
  }

  private reconnect(): void {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.connect();
  }

  private heartbeat(): void {
    if (this.websocketState === ConnectionState.Offline || Date.now() - this.lastResponseTime > 30000) {
      this.websocketState = ConnectionState.Offline;
      this.reconnect();
    } else {
      this.send({ action: 'ping' });
    }
  }

  private handleOpen(): void {
    this.websocketState = ConnectionState.Connected;
    this.lastResponseTime = Date.now();
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    setInterval(() => { this.heartbeat(); }, 15000);
    while (this.outQueue.length && this.ws) {
      this.ws.send(this.outQueue.shift() as string);
    }
  }

  private handleClose(): void {
    this.websocketState = ConnectionState.Offline;
  }

  private handleResponse(msg: any): void {
    this.lastResponseTime = Date.now();
    const result = JSON.parse(msg);
    if (result['multi-address-transactions']) {
      this.handleMultiAddressTransactions(result['multi-address-transactions']);
    }
  }

  private handleMultiAddressTransactions(addressTransactions: AddressTransactionsResponse): void {
    for (const [address, events] of Object.entries(addressTransactions)) {
      for (const event in AddressTxEvent) {
        if (this.addressTxCallbacks[event as AddressTxEvent]) {
          for (const tx of events.mempool || []) {
            this.addressTxCallbacks[event as AddressTxEvent]?.(address, tx);
          }
        }
      }
    }
  }

  private send(data: any): void {
    if (this.ws && this.websocketState === ConnectionState.Connected) {
      this.ws.send(JSON.stringify(data));
    } else {
      this.outQueue.push(JSON.stringify(data));
    }
  }

  public on(event: AddressTxEvent, callback: (address: string, tx: Transaction) => void): void {
    this.addressTxCallbacks[event] = callback;
  }

  public off(event: AddressTxEvent): void {
    delete this.addressTxCallbacks[event];
  }

  public async trackAddresses(addresses: string[]): Promise<void> {
    this.connect();
    this.send({ 'track-addresses': addresses });
  }
}