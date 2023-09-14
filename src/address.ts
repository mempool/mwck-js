import { AddressState, Transaction, Utxo, WalletState } from "./interfaces";

/**
 * Utility class for keeping track of address state
 * via idempotent "add" and "remove" transaction events
 */
export class AddressTracker {
  protected address: string;
  protected transactions: Map<string, Transaction>;
  protected balance: {
    total: number;
    confirmed: number;
    mempool: number;
  };
  protected utxos: Map<string, Utxo>;

  // Map of spent inputs for which we haven't yet seen 
  // the corresponding output.
  private spent: Set<string>;

  // While loadingApi=true, websocket events are withheld in a pending queue
  private loadingApi: boolean = true;
  private pending: { event: 'add' | 'remove', tx?: Transaction, txid?: string }[] = [];

  constructor(address: string) {
    this.address = address;
    this.transactions = new Map();
    this.balance = {
      total: 0,
      confirmed: 0,
      mempool: 0,
    };
    this.utxos = new Map();
    this.spent = new Set();
  }

  public static from(state: AddressState): AddressTracker {
    const tracker = new AddressTracker(state.address);
    state.transactions.forEach(tx => tracker.transactions.set(tx.txid, tx));
    state.utxos.forEach(utxo => tracker.utxos.set(`${utxo.txid}:${utxo.vout}`, utxo));
    tracker.balance = state.balance;
    return tracker;
  }

  /**
   * Returns the current state of the address in a JSON-friendly format
   */
  public getState(): AddressState {
    return {
      address: this.address,
      ready: !this.loadingApi,
      transactions: Array.from(this.transactions.values()),
      balance: {
        total: this.balance.total,
        mempool: this.balance.mempool,
        confirmed: this.balance.confirmed,
      },
      utxos: Array.from(this.utxos.values()),
    };
  }

  public hasTransaction(txid: string): boolean {
    return this.transactions.has(txid);
  }

  /**
   * Update the address state with the effect of a transaction
   * 
   * Idempotent, but the most recent confirmation status applies,
   * so ordering matters
   */
  public addTransaction(tx: Transaction, fromWs: boolean = false): void {
    // delay websocket events until we finished processing transactions from the REST API
    if (this.loadingApi && fromWs) {
      this.pending.push({ event: 'add', tx });
      return;
    }

    // if we already have this transaction
    // undo the effects of that version before applying this one
    if (this.transactions.has(tx.txid)) {
      this.removeTransaction(tx.txid);
    }
    for (const vin of tx.vin) {
      if (vin?.prevout?.scriptpubkey_address === this.address) {
        const key = `${vin.txid}:${vin.vout}`;
        const utxo = this.utxos.get(key);
        if (utxo) {
          this.utxos.delete(key);
          this.balance[utxo.confirmed ? 'confirmed' : 'mempool'] -= utxo.value;
          this.balance.total -= utxo.value;
        } else {
          // we're missing the utxo for this input
          // record that so we don't double count it later
          this.spent.add(key);
        }
      }
    }
    for (const [index, vout] of tx.vout.entries()) {
      if (vout?.scriptpubkey_address === this.address) {
        const key = `${tx.txid}:${index}`;
        // skip outputs we've already seen spent
        if (!this.spent.delete(key)) {
          this.balance[tx.status.confirmed ? 'confirmed' : 'mempool'] += vout.value;
          this.balance.total += vout.value;
          this.utxos.set(key, {
            txid: tx.txid,
            vout: index,
            value: vout.value,
            confirmed: tx.status.confirmed,
          })
        }
      }
    }
    this.transactions.set(tx.txid, tx);
  }

  /**
   * Undo the effect of a previously added transaction
   */
  public removeTransaction(txid: string, live: boolean = false): void {
    // delay processing 'live' transactions until we finished loading from the REST API
    if (this.loadingApi && live) {
      this.pending.push({ event: 'remove', txid });
      return;
    }
    
    const tx = this.transactions.get(txid);
    if (!tx) {
      return;
    }
    this.transactions.delete(txid);
    for (const vin of tx.vin) {
      if (vin?.prevout?.scriptpubkey_address === this.address) {
        const key = `${vin.txid}:${vin.vout}`;
        const prevTx = this.transactions.get(vin.txid);
        if (prevTx) {
          this.balance[prevTx.status.confirmed ? 'confirmed' : 'mempool'] += vin.prevout.value;
          this.balance.total += vin.prevout.value;
          this.utxos.set(key, {
            txid: vin.txid,
            vout: vin.vout,
            value: vin.prevout.value,
            confirmed: prevTx.status.confirmed,
          });
        }
        this.spent.delete(key);
      }
    }
    for (const [index, vout] of tx.vout.entries()) {
      if (vout?.scriptpubkey_address === this.address) {
        const key = `${tx.txid}:${index}`;
        if (this.utxos.delete(key)) {
          // this output was still unspent
          this.balance[tx.status.confirmed ? 'confirmed' : 'mempool'] -= vout.value;
          this.balance.total -= vout.value;
        } else {
          // record that the output is already spent
          this.spent.add(key);
        }
      }
    }
  }

  /**
   * Call after all API transactions have been processed
   * 
   * Drains any pending websocket events
   */
  public async onApiLoaded(): Promise<AddressState> {
    this.loadingApi = false;
    while (this.pending.length) {
      const event = this.pending.shift();
      if (event?.event === 'add' && event.tx) {
        this.addTransaction(event.tx);
      } else if (event?.event === 'remove' && event.txid) {
        this.removeTransaction(event.txid);
      }
    }
    return this.getState();
  }

  /**
   * Prepares for API transactions to be loaded
   */
  public onApiLoading(): void {
    this.loadingApi = true;
  }
}