# Mempool Wallet Connector Kit

*(**work in progress** - relies on the multi-address tracking feature from https://github.com/mempool/mempool/pull/4137)*

A lightweight utility library for efficiently syncing Bitcoin wallet history from an instance of The Mempool Open Source Project® backend.

Mwck uses websocket push notifications to discover new address transaction events, eliminating the need to constantly poll the REST API.

## Quick start

```typescript
const mwck = require('mwck');
const wallet = new mwck.MempoolWallet({
  hostname: 'mempool.space'
});
wallet.connect();

wallet.subscribe('addressReady', ({ address, state }) => {
  // finished loading address transactions
});

wallet.subscribe('txEvent', ({event, address, tx}) => {
  switch (event) {
    'added': {
      // discovered a new transaction related to this address
    } break;

    'confirmed': {
      // a transaction related to this address was included in a block
    } break;

    'removed': {
      // a transaction related to this address was dropped from the mempool
    } break;
  }
});

wallet.trackAddresses([
  'bc1p...xyz',
  '3AB...123'
]);
```

## API

### `MempoolWallet.connect()` (async)

Starts the websocket connection to the configured Mempool server.

Regular ping/pong messages are sent to maintain the connection, and the websocket will attempt to automatically recover from interruptions.

### `MempoolWallet.disconnect()`

Disconnect the websocket until `connect()` is called again

### `MempoolWallet.subscribe(event: WalletEvent, callback)`

Subscribe to event notifications.

When an event of the requested type occurs, the provided callback is invoked.

See [Events](#Events) for a list of valid event topics and callback signatures.

### `MempoolWallet.getAddressState(address: string)`

Returns an `AddressState` object representing the current state of an address.

If the address is invalid or not being tracked, returns null.

### `MempoolWallet.getWalletState(): WalletState`

Returns a `WalletState` object representing the state of all currently tracked addresses and combined balances for the whole wallet.

### `MempoolWallet.restore(state: WalletState)` (async)

Restores the state of a wallet from a snapshot previously obtained from `getWalletState()`.

Useful for persisting a session across restarts/refreshes, or switching between different wallets.

### `MempoolWallet.async trackAddresses(addresses: string[])` (async)

Adds the list of addresses to the wallet, and attempts to sync their transaction history.

Returns once all new addresses are in sync, or immediately if the websocket is offline.

### `MempoolWallet.untrackAddresses(addresses: string[])`

Removes the addresses from the wallet, unloads related state, and stops watching for new transaction activity involving these addresses.

### `MempoolWallet.destroy()`

Call before discarding the `MempoolWallet` object to disconnect the websocket and clean up event handlers etc.

## Events

The `MempoolWallet` class can either be used synchronously by fetching snapshots of address or wallet state, or via an observer-style subscription model.

Subscriptions are supported for the following event types:

### `wsConnected`
Emitted when the websocket succeeds in connecting (or reconnecting) to the configured Mempool server.

Callback takes no arguments

### `wsDisconnected`
Emitted when the websocket loses connection

Callback takes no arguments

### `addressReady`
Emitted after the wallet finishes loading transaction history, and a tracked address is now in sync with the server.

Callback invoked with an argument of the form
```typescript
{
  address: string,
  state: AddressState,
}
```

### `txAdded`
Emitted every time a new transaction related to a tracked address is received.

Callback invoked with an argument of the form
```typescript
{
  address: string,
  tx: Transaction,
}
```

### `txConfirmed`
Emitted every time a transaction related to a tracked address is found to be confirmed in a mined block.

Callback invoked with an argument of the form
```typescript
{
  address: string,
  tx: Transaction,
}
```

### `txRemoved`
Emitted every time a transaction related to a tracked address is dropped from the mempool.

Callback invoked with an argument of the form
```typescript
{
  address: string,
  tx: Transaction,
}
```

### `txEvent`
Emitted for all of the above `tx...` events.

Callback invoked with an argument of the form
```typescript
{
  event: 'added' | 'confirmed' | 'removed',
  address: string,
  tx: Transaction,
}
```

## Types/Interfaces

Check `src/interfaces.ts` for the structure of return types and arguments.