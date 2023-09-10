import { MempoolApi } from './api';
import { AddressTxEvent, MempoolSocket } from './websocket';
import { MempoolOptions, Transaction } from './interfaces';

type AddressEvent = 'added' | 'confirmed' | 'removed' | 'changed';

export class MempoolClient {
  private api: MempoolApi;
  private ws: MempoolSocket;
  private tracking: { [key: string]: Map<string, Transaction> } = {};

  private observerId = 0;
  private observers: {
    [event: string]: {
      [oid in number]: (args: any) => void
    }
  } = {
    added: {},
    confirmed: {},
    removed: {},
    changed: {},
  }

  constructor(options: MempoolOptions) {
    this.api = new MempoolApi(options);
    this.ws = new MempoolSocket(options);
    this.ws.on(AddressTxEvent.mempool, (address, tx) => { this.onTransactionUnconfirmed(address, tx); });
    this.ws.on(AddressTxEvent.confirmed, (address, tx) => { this.onTransactionConfirmed(address, tx); });
    this.ws.on(AddressTxEvent.removed, (address, tx) => { this.onTransactionRemoved(address, tx); });
  }

  public destroy(): void {
    this.ws.off(AddressTxEvent.mempool);
    this.ws.off(AddressTxEvent.confirmed);
    this.ws.off(AddressTxEvent.removed);
  }

  private onTransactionUnconfirmed(address: string, tx: Transaction): void {
    if (address in this.tracking) {
      Object.values(this.observers.added).forEach(observer => observer({address, tx}));
      Object.values(this.observers.changed).forEach(observer => observer({event: 'added', address, tx}));
      this.tracking[address].set(tx.txid, tx);
    }
  }

  private onTransactionConfirmed(address: string, tx: Transaction): void {
    if (address in this.tracking) {
      if (!this.tracking[address].has(tx.txid)) {
        Object.values(this.observers.added).forEach(observer => observer({address, tx}));
        Object.values(this.observers.changed).forEach(observer => observer({event: 'added', address, tx}));
      }
      Object.values(this.observers.confirmed).forEach(observer => observer({address, tx}));
      Object.values(this.observers.changed).forEach(observer => observer({event: 'confirmed', address, tx}));
      this.tracking[address].set(tx.txid, tx);
    }
  }

  private onTransactionRemoved(address: string, tx: Transaction): void {
    if (address in this.tracking) {
      Object.values(this.observers.removed).forEach(observer => observer({address, tx}));
      Object.values(this.observers.changed).forEach(observer => observer({event: 'removed', address, tx}));
      this.tracking[address].delete(tx.txid);
    }
  }

  // register a handler for an event type
  // returns an unsubscribe function
  public subscribe(event: AddressEvent, fn: (args: any) => void): () => void {
    const oid = this.observerId++;
    this.observers[event][oid] = fn;
    return () => { delete this.observers[event][oid]; };
  }

  public getTransactions(address: string): Transaction[] {
    return Array.from(this.tracking[address].values());
  }

  public getWalletState(): { [key: string]: Transaction[] } {
    const addresses: { [address: string]: Transaction[] } = {};
    Object.keys(this.tracking).forEach(address => {
      addresses[address] = Array.from(this.tracking[address].values());
    })
    return addresses;
  }

  public async trackAddresses(addresses: string[]): Promise<void> {
    console.log('starting to track addresses ', addresses)
    addresses = addresses.filter(address => !(address in this.tracking));
    if (!addresses.length) {
      return;
    }
    for (const address of addresses) {
      this.tracking[address] = new Map();
    }
    this.ws.trackAddresses(Object.keys(this.tracking));
    for (const address of addresses) {
      const initialTransactions = await this.api.getAddressTransactions(address);
      for (const tx of initialTransactions) {
        if (tx.status?.confirmed) {
          this.onTransactionUnconfirmed(address, tx);
        } else {
          this.onTransactionUnconfirmed(address, tx);
        }
      }
    }
  }

  public untrackAddresses(addresses: string[]): void {
    let anyDeleted = false;
    for (const address of addresses) {
      if (address in this.tracking) {
        delete this.tracking[address];
        anyDeleted = true;
      }
    }
    if (anyDeleted) {
      this.ws.trackAddresses(Object.keys(this.tracking));
    }
  }
}