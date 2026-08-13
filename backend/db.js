// db.js
// Almacenamiento sencillo en un fichero JSON. Suficiente para arrancar y
// probar la aplicación. El día de mañana esto se puede sustituir por una
// base de datos real (SQLite, Postgres...) sin tocar las rutas de server.js,
// basta con reimplementar las funciones exportadas aquí.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');

function defaultData() {
  return {
    slots: [],
    bookings: [],
    settings: {
      cardPaymentEnabled: false, // false = solo efectivo, true = efectivo y tarjeta
    },
    services: [
      { id: crypto.randomUUID(), name: 'Corte de pelo', price: 12 },
      { id: crypto.randomUUID(), name: 'Corte + barba', price: 18 },
      { id: crypto.randomUUID(), name: 'Tinte', price: 25 },
    ],
  };
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData(), null, 2));
  }
}

// Añade claves nuevas a ficheros db.json antiguos que no las tengan todavía,
// para que las actualizaciones de la app no rompan datos ya existentes.
function migrate(data) {
  let changed = false;
  if (!data.settings) {
    data.settings = { cardPaymentEnabled: false };
    changed = true;
  }
  if (typeof data.settings.cardPaymentEnabled !== 'boolean') {
    data.settings.cardPaymentEnabled = false;
    changed = true;
  }
  if (!Array.isArray(data.services)) {
    data.services = [];
    changed = true;
  }
  return { data, changed };
}

function readData() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  const parsed = JSON.parse(raw);
  const { data, changed } = migrate(parsed);
  if (changed) writeData(data);
  return data;
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function uid() {
  return crypto.randomUUID();
}

module.exports = {
  readData,
  writeData,
  uid,
};
