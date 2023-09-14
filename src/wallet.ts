import { MempoolApi } from './api';
import { AddressTxEvent, MempoolSocket } from './websocket';
import { MempoolOptions, Transaction, AddressState, Utxo, WalletState } from './interfaces';
import { AddressTracker } from './address';

type WalletEvent = 'addressReady' | 'txAdded' | 'txConfirmed' | 'txRemoved' | 'txEvent' | 'wsConnected' | 'wsDisconnected';

export class MempoolWallet {
  private api: MempoolApi;
  private ws: MempoolSocket;
  private tracking: { [key: string]: AddressTracker } = {};

  private observerId = 0;
  private observers: {
    [event: string]: {
      [oid in number]: (args: unknown) => void
    }
  } = {
    addressReady: {},
    txAdded: {},
    txConfirmed: {},
    txRemoved: {},
    txEvent: {},
    wsConnected: {},
    wsDisconnected: {},
  }

  constructor(options: MempoolOptions) {
    this.api = new MempoolApi(options);
    this.ws = new MempoolSocket(options);
    this.ws.on(AddressTxEvent.mempool, (address, tx) => { this.onTransactionUnconfirmed(address, tx, true); });
    this.ws.on(AddressTxEvent.confirmed, (address, tx) => { this.onTransactionConfirmed(address, tx, true); });
    this.ws.on(AddressTxEvent.removed, (address, tx) => { this.onTransactionRemoved(address, tx, true); });
    this.ws.on('disconnected', () => { this.onWebsocketDisconnected() });
    this.ws.on('connected', () => { this.onWebsocketConnected() });
  }

  public destroy(): void {
    this.ws.disconnect();
    this.ws.off(AddressTxEvent.mempool);
    this.ws.off(AddressTxEvent.confirmed);
    this.ws.off(AddressTxEvent.removed);
    this.ws.off('disconnected');
    this.ws.off('connected');
  }

  private onTransactionUnconfirmed(address?: string, tx?: Transaction, fromWs = false): void {
    if (tx && address && address in this.tracking) {
      this.tracking[address].addTransaction(tx, fromWs);
      Object.values(this.observers.txAdded).forEach(observer => observer({address, tx}));
      Object.values(this.observers.txEvent).forEach(observer => observer({event: 'added', address, tx}));
    }
  }

  private onTransactionConfirmed(address?: string, tx?: Transaction, fromWs = false): void {
    if (tx && address && address in this.tracking) {
      const isKnown = this.tracking[address].hasTransaction(tx.txid);
      this.tracking[address].addTransaction(tx, fromWs);
      if (!isKnown) {
        Object.values(this.observers.txAdded).forEach(observer => observer({address, tx}));
        Object.values(this.observers.txEvent).forEach(observer => observer({event: 'added', address, tx}));
      }
      Object.values(this.observers.txConfirmed).forEach(observer => observer({address, tx}));
      Object.values(this.observers.txEvent).forEach(observer => observer({event: 'confirmed', address, tx}));
    }
  }

  private onTransactionRemoved(address?: string, tx?: Transaction, fromWs = false): void {
    if (tx && address && address in this.tracking) {
      this.tracking[address].removeTransaction(tx.txid, fromWs);
      Object.values(this.observers.txRemoved).forEach(observer => observer({address, tx}));
      Object.values(this.observers.txEvent).forEach(observer => observer({event: 'removed', address, tx}));
    }
  }

  private onWebsocketDisconnected(): void {
    Object.values(this.observers.wsDisconnected).forEach(observer => observer({}));
  }

  private async onWebsocketConnected(): Promise<void> {
    Object.values(this.observers.wsConnected).forEach(observer => observer({}));
    this.ws.trackAddresses(Object.keys(this.tracking));
    for (const address of Object.keys(this.tracking)) {
      if (this.ws.isConnected()) {
        await this.fetchAddressBacklog(address);
      } else {
        // connection lost, we'll try again on reconnect
        return;
      }
    }
  }

  public async connect(): Promise<void> {
    await this.ws.connect();
  }

  public disconnect(): void {
    this.ws.disconnect();
  }

  // register a handler for an event type
  // returns an unsubscribe function
  public subscribe(event: WalletEvent, fn: (args: unknown) => void): () => void {
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
      address: 'wallet',
      ready: Object.values(addresses).reduce((ready, address) => ready && address.ready, true),
      addresses,
      balance,
      transactions: Array.from(transactions.values()),
      utxos,
    };
  }

  public async restore(state: WalletState): Promise<void> {
    this.tracking = {};
    for (const address of Object.keys(state.addresses)) {
      const addressState = state.addresses[address];
      this.tracking[address] = AddressTracker.from(addressState);
    }

    if (this.ws.isConnected()) {
      this.ws.trackAddresses(Object.keys(this.tracking));
      for (const address of Object.keys(state.addresses)) {
        // resync to known good height
        await this.fetchAddressBacklog(address);
        this.tracking[address].onApiLoaded()
        Object.values(this.observers.addressReady).forEach(observer => observer({address, state: state.addresses[address]}));
      }
    }
  }

  public async trackAddresses(addresses: string[]): Promise<void> {
    addresses = addresses.filter(address => !(address in this.tracking));
    if (!addresses.length) {
      return;
    }
    for (const address of addresses) {
      this.tracking[address] = new AddressTracker(address);
    }
    if (this.ws.isConnected()) {
      this.ws.trackAddresses(Object.keys(this.tracking));
      for (const address of addresses) {
        await this.fetchAddressBacklog(address);
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

  private async fetchAddressBacklog(address: string) {
    const addressState = this.tracking[address]?.getState();

    // fetch history back to the block before the last known confirmed transaction
    const lastConfirmed = (addressState?.transactions.slice().reverse() || []).find(tx => tx.status?.confirmed);
    let lastTxid;
    let lastHeight;
    if (lastConfirmed) {
      lastTxid = lastConfirmed.txid;
      lastHeight = (lastConfirmed.status?.block_height || 1) - 1;
    }
    const fetchedTxids = new Set();
    const initialTransactions = await this.api.getAddressTransactions(address, lastTxid, lastHeight);
    for (const tx of initialTransactions) {
      fetchedTxids.add(tx.txid);
    }

    // Clear transactions that were removed since our last good state
    for (const tx of addressState?.transactions.slice().reverse() || []) {
      // Only check as far back as our fresh data extends
      if (lastHeight && tx.status?.block_height && tx.status?.block_height < lastHeight) {
        break;
      }
      if (!fetchedTxids.has(tx.txid)) {
        this.onTransactionRemoved(address, tx);
      }
    }

    for (const tx of initialTransactions) {
      if (tx.status?.confirmed) {
        this.onTransactionConfirmed(address, tx);
      } else {
        this.onTransactionUnconfirmed(address, tx);
      }
    }
    const state = await this.tracking[address].onApiLoaded();

    // notify observers that the address is synced and ready
    Object.values(this.observers.addressReady).forEach(observer => observer({address, state}));
  }
}