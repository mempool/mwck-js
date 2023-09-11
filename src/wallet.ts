import { MempoolApi } from './api';
import { AddressTxEvent, MempoolSocket } from './websocket';
import { MempoolOptions, Transaction, AddressState, Utxo, WalletState } from './interfaces';
import { AddressTracker } from './address';

type AddressEvent = 'added' | 'confirmed' | 'removed' | 'changed';

export class MempoolWallet {
  private api: MempoolApi;
  private ws: MempoolSocket;
  private tracking: { [key: string]: AddressTracker } = {};

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
    this.ws.on(AddressTxEvent.mempool, (address, tx) => { this.onTransactionUnconfirmed(address, tx, true); });
    this.ws.on(AddressTxEvent.confirmed, (address, tx) => { this.onTransactionConfirmed(address, tx, true); });
    this.ws.on(AddressTxEvent.removed, (address, tx) => { this.onTransactionRemoved(address, tx, true); });
  }

  public destroy(): void {
    this.ws.off(AddressTxEvent.mempool);
    this.ws.off(AddressTxEvent.confirmed);
    this.ws.off(AddressTxEvent.removed);
  }

  private onTransactionUnconfirmed(address: string, tx: Transaction, live: boolean = false): void {
    if (address in this.tracking) {
      this.tracking[address].addTransaction(tx, live);
      Object.values(this.observers.added).forEach(observer => observer({address, tx}));
      Object.values(this.observers.changed).forEach(observer => observer({event: 'added', address, tx}));
    }
  }

  private onTransactionConfirmed(address: string, tx: Transaction, live: boolean = false): void {
    if (address in this.tracking) {
      const isKnown = this.tracking[address].hasTransaction(tx.txid);
      this.tracking[address].addTransaction(tx, live);
      if (!isKnown) {
        Object.values(this.observers.added).forEach(observer => observer({address, tx}));
        Object.values(this.observers.changed).forEach(observer => observer({event: 'added', address, tx}));
      }
      Object.values(this.observers.confirmed).forEach(observer => observer({address, tx}));
      Object.values(this.observers.changed).forEach(observer => observer({event: 'confirmed', address, tx}));
    }
  }

  private onTransactionRemoved(address: string, tx: Transaction, live: boolean = false): void {
    if (address in this.tracking) {
      Object.values(this.observers.removed).forEach(observer => observer({address, tx}));
      Object.values(this.observers.changed).forEach(observer => observer({event: 'removed', address, tx}));
      this.tracking[address].removeTransaction(tx.txid, live);
    }
  }

  // register a handler for an event type
  // returns an unsubscribe function
  public subscribe(event: AddressEvent, fn: (args: any) => void): () => void {
    const oid = this.observerId++;
    this.observers[event][oid] = fn;
    return () => { delete this.observers[event][oid]; };
  }

  public getAddressState(address: string): AddressState | null {
    if (this.tracking[address]) {
      return this.tracking[address].getState();
    } else {
      return null;
    }
  }

  public getWalletState(): WalletState {
    const addresses: { [address: string]: AddressState } = {};
    const transactions = new Map();
    const balance = {
      total: 0,
      confirmed: 0,
      mempool: 0,
    };
    let utxos: Utxo[] = [];
    Object.keys(this.tracking).forEach(address => {
      if (this.tracking[address]) {
        const addressState = this.tracking[address].getState();
        addresses[address] = addressState;
        balance.total += addressState.balance.total;
        balance.confirmed += addressState.balance.confirmed;
        balance.mempool += addressState.balance.mempool;
        for (const tx of addressState.transactions) {
          transactions.set(tx.txid, tx);
        }
        utxos = utxos.concat(addressState.utxos);
      }
    })
    return {
      addresses,
      balance,
      transactions: Array.from(transactions.values()),
      utxos,
    };
  }

  public async trackAddresses(addresses: string[]): Promise<void> {
    addresses = addresses.filter(address => !(address in this.tracking));
    if (!addresses.length) {
      return;
    }
    for (const address of addresses) {
      this.tracking[address] = new AddressTracker(address);
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
      this.tracking[address].onApiLoaded();
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