import WebSocket from 'isomorphic-ws';
import { MempoolOptions, addDefaultOptions, Transaction, AddressTransactionsResponse } from './interfaces';

export enum ConnectionState {
  Connected,
  Connecting,
  Offline
}

export enum AddressTxEvent {
  removed = 'removed',
  mempool = 'mempool',
  confirmed = 'confirmed',
}

export type WebsocketEvent = AddressTxEvent | 'disconnected' | 'connected';

export class MempoolSocket {
  private options: MempoolOptions;
  private wsUrl: string;

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastResponseTime = 0;
  private websocketState: ConnectionState = ConnectionState.Offline;
  private ws: WebSocket | null = null;
  private eventCallbacks: {
    [event in WebsocketEvent]?: (address?: string, tx?: Transaction) => void;
  } = {};
  private outQueue: string[] = [];

  constructor(options: MempoolOptions = {}) {
    this.options = addDefaultOptions(options);
    const networkPath = ['testnet', 'signet'].includes(this.options.network || '') ? ('/' + this.options.network) : '';
    this.wsUrl = `${this.options.secure ? 'wss' : 'ws'}://${this.options.hostname}${networkPath}/api/v1/ws`;
  }

  private async init(): Promise<WebSocket> {
    if (this.websocketState === ConnectionState.Offline) {
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
      return new Promise((resolve, reject) => {
        this.websocketState = ConnectionState.Connecting;
        const connectionTimeout = setTimeout(() => { reject('websocket connection timed out'); }, 5000);

        try {
          this.ws = this.ws = new WebSocket(this.wsUrl);

          this.ws.onerror = console.error;

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
    } else if (this.ws && this.websocketState === ConnectionState.Connected) {
      return Promise.resolve(this.ws);
    } else {
      await new Promise((resolve) => {
        setTimeout(resolve, 2000);
      });
      return this.init();
    }
  }

  public isConnected(): boolean {
    return this.websocketState === ConnectionState.Connected;
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

  private reconnect(): void {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.connect();
  }

  private heartbeat(): void {
    if (this.websocketState === ConnectionState.Offline || Date.now() - this.lastResponseTime > 180000) {
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
    this.heartbeatTimer = setInterval(() => { this.heartbeat(); }, 15000);
    while (this.outQueue.length && this.ws) {
      this.ws.send(this.outQueue.shift() as string);
    }
    if (this.eventCallbacks.connected) {
      this.eventCallbacks.connected();
    }
  }

  private handleClose(): void {
    this.websocketState = ConnectionState.Offline;
    if (this.eventCallbacks.disconnected) {
      this.eventCallbacks.disconnected();
    }
  }

  private handleResponse(msg: any): void {
    this.lastResponseTime = Date.now();
    const result = JSON.parse(msg.data);
    if (result['multi-address-transactions']) {
      this.handleMultiAddressTransactions(result['multi-address-transactions']);
    }
  }

  private handleMultiAddressTransactions(addressTransactions: AddressTransactionsResponse): void {
    for (const [address, events] of Object.entries(addressTransactions)) {
      for (const event in AddressTxEvent) {
        if (this.eventCallbacks[event as AddressTxEvent]) {
          for (const tx of events[event as AddressTxEvent] || []) {
            this.eventCallbacks[event as AddressTxEvent]?.(address, tx);
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

  public on(event: WebsocketEvent, callback: (address?: string, tx?: Transaction) => void): void {
    this.eventCallbacks[event] = callback;
  }

  public off(event: WebsocketEvent): void {
    delete this.eventCallbacks[event];
  }

  public async trackAddresses(addresses: string[]): Promise<void> {
    this.send({ 'track-addresses': addresses });
  }
}