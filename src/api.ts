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

  /**
   * Fetch address transactions from the configured REST API
   *
   * `untilTxid` and `untilHeight` can be used to limit the number of API requests:
   *
   * If either is provided, the function will only fetch as much history as necessary to find
   *  - a transaction with the given txid.
   *  - a transaction confirmed at or below the given blockheight.
   *
   * If both are provided, history will be fetched until both conditions are met.
   */
  public async getAddressTransactions(address: string, untilTxid?: string, untilHeight?: number): Promise<Transaction[]> {
    let allTxs: Transaction[] = [];
    let lastTxid = null;
    let done = false;
    let limitRequests = untilTxid || (untilHeight != null);
    let foundTxid = untilTxid == null;
    let foundHeight = untilHeight == null;
    while (!done && !(limitRequests && foundTxid && foundHeight)) {
      const result = await fetch(`${this.baseUrl}/address/${address}/txs${lastTxid ? '?after_txid=' + lastTxid : ''}`);
      const txs = await result.json() as Transaction[];
      if (limitRequests) {
        if (!foundTxid && txs.findIndex(tx => tx.txid === untilTxid) >= 0) {
          foundTxid = true;
        }
        if (untilHeight
          && !foundHeight
          && txs.length
          && txs[txs.length - 1].status?.confirmed
          && (txs[txs.length - 1]?.status?.block_height || Infinity) < untilHeight
        ) {
          foundHeight = true;
        }
      }
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