const { MempoolWallet } = Mwck;

const wallet = new MempoolWallet({
  hostname: 'localhost:4200',
  secure: false,
});
window.wallet = wallet;

const addressMap = {};
const addressList = [];
const regexAddress = /^([a-km-zA-HJ-NP-Z1-9]{26,35}|[a-km-zA-HJ-NP-Z1-9]{80}|[A-z]{2,5}1[a-zA-HJ-NP-Z0-9]{39,59}|04[a-fA-F0-9]{128}|(02|03)[a-fA-F0-9]{64})$/;
const addressInput = document.getElementById('addressInput');

wallet.subscribe('addressReady', ({ address, state }) => {
  updateTableRow(address);
});

wallet.subscribe('txEvent', ({event, address, tx}) => {
  updateTableRow(address);
});

wallet.connect();

function trackAddress(address) {
  if (regexAddress.test(address)) {
    if (!addressMap[address]) {
      addressMap[address] = true;
      addTableRow(address);
      addressList.push(address);
      wallet.trackAddresses([address]);
    }
    return true;
  } else {
    alert(`${address} is not a valid bitcoin address!`);
    return false;
  }
}

function onTrackAddress(event) {
  const address = addressInput.value
  if (trackAddress(address)) {
    addressInput.value = '';
  }
}

function addTableRow(address) {
  const table = document.getElementById('addressTable');
  if (addressList.length === 0) {
    table.classList.remove('hidden');
  }
  const newRow = document.createElement('tr');
  const newCell = document.createElement('td');
  newCell.textContent = address;
  newRow.appendChild(newCell);
  for (let i = 0; i < 3; i++) {
    newRow.appendChild(document.createElement('td'));
  }
  table.querySelector('tbody').appendChild(newRow);
}

function updateTableRow(address) {
  const table = document.getElementById('addressTable');
  const i = addressList.indexOf(address);
  const addressData = wallet.getAddressState(address);
  const rows = table.querySelector('tbody').getElementsByTagName('tr');
  const row = rows[i];
  const cells = row.getElementsByTagName('td');
  if (addressData && addressData.ready) {
    const prevBalance = Number(cells[1].textContent.slice(0, -4)) * 100_000_000;
    cells[1].textContent = `${(addressData.balance.total / 100_000_000).toFixed(8)} BTC`;
    cells[2].textContent = `${addressData.transactions.length}`;
    cells[3].textContent = `${addressData.utxos.length}`;
    if (prevBalance != null && !isNaN(prevBalance) && addressData.balance.total && !row.className) {
      if (prevBalance < addressData.balance.total) {
        row.classList.add("credit");
        row.classList.add("flash-once");
      } else if (prevBalance > addressData.balance.total) {
        row.classList.add("debit");
        row.classList.add("flash-once");
      } else {
        row.classList.add("conf");
        row.classList.add("flash-once");
      }
      let onAnimationEnd = () => {
        row.className = "";
        row.removeEventListener("animationend", onAnimationEnd);
      }
      row.addEventListener("animationend", onAnimationEnd);
    } 
  }
}

function saveState() {
  const state = wallet.getWalletState();
  
  const openRequest = indexedDB.open('walletWatcher', 1);
  openRequest.onupgradeneeded = function(event) {
    const db = event.target.result;
    db.createObjectStore('objects');
  };

  document.getElementById('saveButton').textContent = '...';

  openRequest.onsuccess = function(event) {
    const db = event.target.result;

    const transaction = db.transaction(['objects'], 'readwrite');
    const objectStore = transaction.objectStore('objects');
    objectStore.put(JSON.stringify(state), 'addressState');

    document.getElementById('saveButton').textContent = 'Save';
  };
}

function restoreState() {
  const openRequest = indexedDB.open('walletWatcher', 1);
  openRequest.onupgradeneeded = function(event) {
    const db = event.target.result;
    db.createObjectStore('objects');
  };

  openRequest.onsuccess = function(event) {
    const db = event.target.result;

    const transaction = db.transaction(['objects'], 'readonly');
    const objectStore = transaction.objectStore('objects');
    const request = objectStore.get('addressState');

    request.onsuccess = function(event) {
      const state = JSON.parse(event.target.result);
      if (state && state.addresses) {
        for (const address of Object.keys(state.addresses)) {
          if (regexAddress.test(address) && !addressMap[address]) {
            addressMap[address] = true;
            addTableRow(address);
            addressList.push(address);
          }
        }
        wallet.restore(state);
      }
    };
  };
}

document.getElementById('watchButton').addEventListener('click', onTrackAddress);
document.getElementById('saveButton').addEventListener('click', saveState);
document.getElementById('restoreButton').addEventListener('click', restoreState);