export interface MempoolOptions {
  hostname?: string;
  network?: 'mainnet' | 'testnet' | 'signet';
  secure?: boolean;
}

export function addDefaultOptions(options: MempoolOptions): MempoolOptions {
  return {
    hostname: 'mempool.space',
    network: 'mainnet',
    secure: true,
    ...options
  };
}

export interface Transaction {
  txid: string;
  version: number;
  locktime: number;
  size: number;
  weight: number;
  fee: number;
  vin: Vin[];
  vout: Vout[];
  status: Status;
  firstSeen?: number;
  feePerVsize?: number;
  effectiveFeePerVsize?: number;
}

export interface Vin {
  txid: string;
  vout: number;
  is_coinbase: boolean;
  scriptsig: string;
  scriptsig_asm: string;
  inner_redeemscript_asm?: string;
  inner_witnessscript_asm?: string;
  sequence: any;
  witness?: string[];
  prevout: Vout;
}

export interface Vout {
  scriptpubkey: string;
  scriptpubkey_asm: string;
  scriptpubkey_type: string;
  scriptpubkey_address?: string;
  value: number;
}

export interface Status {
  confirmed: boolean;
  block_height?: number;
  block_hash?: string;
  block_time?: number;
}

export interface Utxo {
  txid: string,
  vout: number,
  value: number,
  confirmed: boolean,
}

export interface AddressState {
  address: string,
  transactions: Transaction[];
  balance: {
    total: number;
    confirmed: number;
    mempool: number;
  };
  utxos: Utxo[];
}

export interface WalletState extends AddressState {
  addresses: { [address: string]: AddressState };
}

export interface AddressTransactionsResponse {
  [address: string]: {
    mempool: Transaction[];
    confirmed: Transaction[];
    removed: Transaction[];
  }
}