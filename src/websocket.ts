import WebSocket from 'isomorphic-ws';
import { MempoolOptions, addDefaultOptions, Transaction, AddressTransactionsResponse } from './interfaces';

export enum ConnectionState {
  connected,
  connecting,
  offline
}

export enum AddressTxEvent {
  removed = 'removed',
  mempool = 'mempool',
  confirmed = 'confirmed',
}

export type WebsocketEvent = AddressTxEvent | 'disconnected' | 'connected' | 'error';

export class MempoolSocket {
  private options: MempoolOptions;
  private wsUrl: string;

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastResponseTime = 0;
  private websocketState: ConnectionState = ConnectionState.offline;
  private ws: WebSocket | null = null;
  private eventCallbacks: {
    [event in WebsocketEvent]?: (args: { address?: string, tx?: Transaction, error?: any }) => void;
  } = {};
  private outQueue: string[] = [];

  constructor(options: MempoolOptions = {}) {
    this.options = addDefaultOptions(options);
    const networkPath = ['testnet', 'signet'].includes(this.options.network || '') ? ('/' + this.options.network) : '';
    this.wsUrl = `${this.options.secure ? 'wss' : 'ws'}://${this.options.hostname}${networkPath}/api/v1/ws`;
  }

  private async init(): Promise<WebSocket> {
    while (!this.ws || this.websocketState !== ConnectionState.connected) {
      if (this.websocketState === ConnectionState.offline) {
        if (this.ws) {
          this.ws.close();
          this.ws = null;
        }
        return new Promise((resolve, reject) => {
          this.websocketState = ConnectionState.connecting;
          const connectionTimeout = setTimeout(() => { reject('websocket connection timed out'); }, 5000);

          try {
            this.ws = new WebSocket(this.wsUrl);

            this.ws.onerror = (err) => {
              this.websocketState = ConnectionState.offline;
              if (this.eventCallbacks.error) {
                this.eventCallbacks['error']({ error: err });
              }
            }

            this.ws.onclose = () => {
              this.handleClose();
            };

            this.ws.onmessage = (msg: any) => {
              this.handleResponse(msg);
            };

            this.ws.onopen = () => {
              this.handleOpen();
              clearTimeout(connectionTimeout);
              resolve(this.ws as WebSocket);
            };
          } catch (e) {
            reject(e);
          }
        });
      } else {
        // try again in 5 seconds
        await new Promise((resolve) => {
          setTimeout(resolve, 5000);
        });
      }
    }
    return this.ws;
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
    if (this.websocketState === ConnectionState.offline || Date.now() - this.lastResponseTime > 180000) {
      this.websocketState = ConnectionState.offline;
      this.reconnect();
    } else {
      this.send({ action: 'ping' });
    }
  }

  private handleOpen(): void {
    this.websocketState = ConnectionState.connected;
    this.lastResponseTime = Date.now();
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    this.heartbeatTimer = setInterval(() => { this.heartbeat(); }, 15000);
    while (this.outQueue.length && this.ws) {
      this.ws.send(this.outQueue.shift() as string);
    }
    if (this.eventCallbacks.connected) {
      this.eventCallbacks.connected({});
    }
  }

  private handleClose(): void {
    this.websocketState = ConnectionState.offline;
    if (this.eventCallbacks.disconnected) {
      this.eventCallbacks.disconnected({});
    }
  }

  private handleResponse(msg: any): void {
    this.lastResponseTime = Date.now();
    try {
      const result = JSON.parse(msg.data);
      if (result['multi-address-transactions']) {
        this.handleMultiAddressTransactions(result['multi-address-transactions']);
      }
    } catch (err) {
      if (this.eventCallbacks.error) {
        this.eventCallbacks['error']({ error: err });
      }
    }
  }

  private handleMultiAddressTransactions(addressTransactions: AddressTransactionsResponse): void {
    for (const [address, events] of Object.entries(addressTransactions)) {
      for (const event in AddressTxEvent) {
        if (this.eventCallbacks[event as AddressTxEvent]) {
          for (const tx of events[event as AddressTxEvent] || []) {
            this.eventCallbacks[event as AddressTxEvent]?.({address, tx});
          }
        }
      }
    }
  }

  private send(data: any): void {
    if (this.ws && this.websocketState === ConnectionState.connected) {
      this.ws.send(JSON.stringify(data));
    } else {
      this.outQueue.push(JSON.stringify(data));
    }
  }

  public isConnected(): boolean {
    return this.websocketState === ConnectionState.connected;
  }

  public async connect(): Promise<WebSocket> {
    return this.init();
  }

  public disconnect(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    this.ws?.close();
  }

  public on(event: WebsocketEvent, callback: (args: {address?: string, tx?: Transaction, error?: any}) => void): void {
    this.eventCallbacks[event] = callback;
  }

  public off(event: WebsocketEvent): void {
    delete this.eventCallbacks[event];
  }

  public async trackAddresses(addresses: string[]): Promise<void> {
    this.send({ 'track-addresses': addresses });
  }
}