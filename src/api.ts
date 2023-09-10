import fetch from 'cross-fetch';
import { MempoolOptions, Transaction, addDefaultOptions } from './interfaces';

export class MempoolApi {
  private options: MempoolOptions;
  private baseUrl: string;

  constructor(options: MempoolOptions) {
    this.options = addDefaultOptions(options);
    const networkPath = ['testnet', 'signet'].includes(this.options.network || '') ? ('/' + this.options.network) : '';
    this.baseUrl = `${this.options.secure ? 'https' : 'http'}://${this.options.hostname}${networkPath}/api`;
  }

  public async getAddressTransactions(address: string): Promise<Transaction[]> {
    let allTxs: Transaction[] = [];
    let lastTxid = null;
    let done = false;
    while (!done) {
      const result = await fetch(`${this.baseUrl}/address/${address}/txs${lastTxid ? '?after_txid=' + lastTxid : ''}`);
      const txs = await result.json();
      if (txs.length === 50) {
        lastTxid = txs[txs.length - 1].txid;
      } else {
        done = true;
      }
      allTxs = allTxs.concat(txs);
    }
    return allTxs.reverse();
  }
}