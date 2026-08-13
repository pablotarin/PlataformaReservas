// server.js
// Backend de la app de reservas de peluquería.
// Sirve tanto la API REST (/api/...) como los ficheros estáticos del frontend.

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { readData, writeData, uid } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DURACION_DEFECTO_MIN = 30; // duración por defecto de cada hueco, en minutos

app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------------------
// Middleware de autenticación de administrador (simple, basado en contraseña
// enviada en la cabecera x-admin-password). Suficiente para una base inicial;
// se puede sustituir por JWT/sesiones más adelante.
// ---------------------------------------------------------------------------
function requireAdmin(req, res, next) {
  const password = req.header('x-admin-password');
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ---------------------------------------------------------------------------
// LOGIN ADMIN
// ---------------------------------------------------------------------------
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, error: 'Contraseña incorrecta' });
});

// ---------------------------------------------------------------------------
// PÚBLICO: ajustes visibles para el cliente (métodos de pago aceptados)
// GET /api/public/settings
// ---------------------------------------------------------------------------
app.get('/api/public/settings', (req, res) => {
  const data = readData();
  res.json(data.settings);
});

// ---------------------------------------------------------------------------
// PÚBLICO: listado de servicios y precios
// GET /api/public/services
// ---------------------------------------------------------------------------
app.get('/api/public/services', (req, res) => {
  const data = readData();
  res.json(data.services);
});

// ---------------------------------------------------------------------------
// PÚBLICO: consultar huecos libres de un día concreto
// GET /api/public/slots?date=YYYY-MM-DD
// ---------------------------------------------------------------------------
app.get('/api/public/slots', (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'Falta el parámetro date' });

  const data = readData();
  const slots = data.slots
    .filter((s) => s.date === date && s.status === 'libre')
    .sort((a, b) => a.time.localeCompare(b.time));

  res.json(slots);
});

// ---------------------------------------------------------------------------
// PÚBLICO: solicitar una reserva sobre un hueco libre.
// La reserva queda en estado "pendiente" hasta que el administrador la
// acepte desde el panel. El hueco deja de estar disponible para otros
// clientes mientras tanto.
// POST /api/public/bookings  { slotId, name, phone, email, notes, serviceId }
// ---------------------------------------------------------------------------
app.post('/api/public/bookings', (req, res) => {
  const { slotId, name, phone, email, notes, serviceId } = req.body;

  if (!slotId || !name || !phone || !email) {
    return res.status(400).json({ error: 'Faltan datos obligatorios (nombre, teléfono y email)' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'El email no es válido' });
  }

  const data = readData();
  const slot = data.slots.find((s) => s.id === slotId);

  if (!slot) return res.status(404).json({ error: 'El hueco no existe' });
  if (slot.status !== 'libre') return res.status(409).json({ error: 'Ese hueco ya no está disponible' });

  let service = null;
  if (serviceId) {
    service = data.services.find((sv) => sv.id === serviceId) || null;
  }

  const booking = {
    id: uid(),
    slotId,
    name,
    phone,
    email,
    notes: notes || '',
    serviceId: service ? service.id : null,
    serviceName: service ? service.name : null,
    createdAt: new Date().toISOString(),
  };

  slot.status = 'pendiente';
  data.bookings.push(booking);
  writeData(data);

  res.status(201).json({ booking, slot });
});

// ---------------------------------------------------------------------------
// ADMIN: listar todos los huecos (libres, pendientes y reservados) en un
// rango de fechas
// GET /api/admin/slots?from=YYYY-MM-DD&to=YYYY-MM-DD
// ---------------------------------------------------------------------------
app.get('/api/admin/slots', requireAdmin, (req, res) => {
  const { from, to } = req.query;
  const data = readData();

  let slots = data.slots;
  if (from) slots = slots.filter((s) => s.date >= from);
  if (to) slots = slots.filter((s) => s.date <= to);

  // Adjuntamos info de la reserva si el hueco está pendiente o reservado,
  // para pintarlo directamente en el calendario del admin.
  const enriched = slots.map((s) => {
    if (s.status === 'reservado' || s.status === 'pendiente') {
      const booking = data.bookings.find((b) => b.slotId === s.id);
      return { ...s, booking };
    }
    return s;
  });

  res.json(enriched);
});

// ---------------------------------------------------------------------------
// ADMIN: crear huecos disponibles.
// Soporta crear un único hueco o generar varios huecos consecutivos en un
// rango horario (para marcar, por ejemplo, "de 9:00 a 14:00 cada 30 min").
// POST /api/admin/slots
//   { date, time, duration }                      -> un único hueco
//   { date, startTime, endTime, duration }         -> genera varios huecos
// ---------------------------------------------------------------------------
app.post('/api/admin/slots', requireAdmin, (req, res) => {
  const { date, time, startTime, endTime, duration } = req.body;
  const dur = duration || DURACION_DEFECTO_MIN;

  if (!date) return res.status(400).json({ error: 'Falta la fecha (date)' });

  const data = readData();
  const created = [];

  function addSlot(hhmm) {
    // Evita duplicados: mismo día y misma hora
    const exists = data.slots.some((s) => s.date === date && s.time === hhmm);
    if (exists) return;
    const slot = { id: uid(), date, time: hhmm, duration: dur, status: 'libre' };
    data.slots.push(slot);
    created.push(slot);
  }

  if (startTime && endTime) {
    // Generar huecos entre startTime y endTime cada `dur` minutos
    let [h, m] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    const endTotal = endH * 60 + endM;

    while (h * 60 + m < endTotal) {
      const hh = String(h).padStart(2, '0');
      const mm = String(m).padStart(2, '0');
      addSlot(`${hh}:${mm}`);

      m += dur;
      while (m >= 60) {
        m -= 60;
        h += 1;
      }
    }
  } else if (time) {
    addSlot(time);
  } else {
    return res.status(400).json({ error: 'Debes indicar time, o bien startTime y endTime' });
  }

  writeData(data);
  res.status(201).json(created);
});

// ---------------------------------------------------------------------------
// ADMIN: eliminar un hueco (solo si está libre; si está pendiente o
// reservado hay que rechazar/cancelar la reserva antes)
// DELETE /api/admin/slots/:id
// ---------------------------------------------------------------------------
app.delete('/api/admin/slots/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const data = readData();
  const slot = data.slots.find((s) => s.id === id);

  if (!slot) return res.status(404).json({ error: 'Hueco no encontrado' });
  if (slot.status !== 'libre') {
    return res.status(409).json({ error: 'No se puede borrar un hueco con una reserva. Rechaza o cancela la reserva primero.' });
  }

  data.slots = data.slots.filter((s) => s.id !== id);
  writeData(data);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// ADMIN: listar todas las reservas
// GET /api/admin/bookings
// ---------------------------------------------------------------------------
app.get('/api/admin/bookings', requireAdmin, (req, res) => {
  const data = readData();
  const enriched = data.bookings
    .map((b) => ({ ...b, slot: data.slots.find((s) => s.id === b.slotId) }))
    .sort((a, b) => (a.slot?.date + a.slot?.time).localeCompare(b.slot?.date + b.slot?.time));
  res.json(enriched);
});

// ---------------------------------------------------------------------------
// ADMIN: aceptar una reserva pendiente -> el hueco pasa a "reservado"
// PUT /api/admin/bookings/:id/accept
// ---------------------------------------------------------------------------
app.put('/api/admin/bookings/:id/accept', requireAdmin, (req, res) => {
  const { id } = req.params;
  const data = readData();
  const booking = data.bookings.find((b) => b.id === id);

  if (!booking) return res.status(404).json({ error: 'Reserva no encontrada' });

  const slot = data.slots.find((s) => s.id === booking.slotId);
  if (!slot) return res.status(404).json({ error: 'El hueco asociado no existe' });
  if (slot.status !== 'pendiente') {
    return res.status(409).json({ error: 'Esta reserva ya no está pendiente de aceptación' });
  }

  slot.status = 'reservado';
  writeData(data);
  res.json({ booking, slot });
});

// ---------------------------------------------------------------------------
// ADMIN: rechazar una reserva pendiente, o cancelar una ya confirmada.
// En ambos casos se libera el hueco de nuevo.
// DELETE /api/admin/bookings/:id
// ---------------------------------------------------------------------------
app.delete('/api/admin/bookings/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const data = readData();
  const booking = data.bookings.find((b) => b.id === id);

  if (!booking) return res.status(404).json({ error: 'Reserva no encontrada' });

  const slot = data.slots.find((s) => s.id === booking.slotId);
  if (slot) slot.status = 'libre';

  data.bookings = data.bookings.filter((b) => b.id !== id);
  writeData(data);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// ADMIN: leer / actualizar ajustes (métodos de pago aceptados)
// GET  /api/admin/settings
// PUT  /api/admin/settings  { cardPaymentEnabled: boolean }
// ---------------------------------------------------------------------------
app.get('/api/admin/settings', requireAdmin, (req, res) => {
  const data = readData();
  res.json(data.settings);
});

app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const { cardPaymentEnabled } = req.body;
  if (typeof cardPaymentEnabled !== 'boolean') {
    return res.status(400).json({ error: 'cardPaymentEnabled debe ser true o false' });
  }
  const data = readData();
  data.settings.cardPaymentEnabled = cardPaymentEnabled;
  writeData(data);
  res.json(data.settings);
});

// ---------------------------------------------------------------------------
// ADMIN: gestión del listado de precios / tipos de corte
// GET    /api/admin/services
// POST   /api/admin/services   { name, price }
// PUT    /api/admin/services/:id  { name, price }
// DELETE /api/admin/services/:id
// ---------------------------------------------------------------------------
app.get('/api/admin/services', requireAdmin, (req, res) => {
  const data = readData();
  res.json(data.services);
});

app.post('/api/admin/services', requireAdmin, (req, res) => {
  const { name, price } = req.body;
  const numericPrice = Number(price);

  if (!name || !name.trim()) return res.status(400).json({ error: 'Falta el nombre del servicio' });
  if (Number.isNaN(numericPrice) || numericPrice < 0) {
    return res.status(400).json({ error: 'El precio no es válido' });
  }

  const data = readData();
  const service = { id: uid(), name: name.trim(), price: numericPrice };
  data.services.push(service);
  writeData(data);
  res.status(201).json(service);
});

app.put('/api/admin/services/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { name, price } = req.body;
  const numericPrice = Number(price);

  if (!name || !name.trim()) return res.status(400).json({ error: 'Falta el nombre del servicio' });
  if (Number.isNaN(numericPrice) || numericPrice < 0) {
    return res.status(400).json({ error: 'El precio no es válido' });
  }

  const data = readData();
  const service = data.services.find((s) => s.id === id);
  if (!service) return res.status(404).json({ error: 'Servicio no encontrado' });

  service.name = name.trim();
  service.price = numericPrice;
  writeData(data);
  res.json(service);
});

app.delete('/api/admin/services/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const data = readData();
  const exists = data.services.some((s) => s.id === id);
  if (!exists) return res.status(404).json({ error: 'Servicio no encontrado' });

  data.services = data.services.filter((s) => s.id !== id);
  writeData(data);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Servir el frontend (ficheros estáticos)
// ---------------------------------------------------------------------------
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
app.use(express.static(FRONTEND_DIR));

app.get('/', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'admin.html'));
});

app.listen(PORT, () => {
  console.log(`\n✅ Servidor de la peluquería arrancado`);
  console.log(`   Web clientes:  http://localhost:${PORT}/`);
  console.log(`   Panel admin:   http://localhost:${PORT}/admin`);
  console.log(`   Password admin (por defecto): ${ADMIN_PASSWORD}\n`);
});
