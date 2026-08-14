// server.js
// Backend de la app de reservas de peluquería.
// Sirve tanto la API REST (/api/...) como los ficheros estáticos del frontend.

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const {
  readData,
  writeData,
  deleteSlot,
  deleteBooking,
  registerUser,
  loginUser,
  getUserById,
  getUserBookings,
  uid,
  createSlots,
} = require("./supabase");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const DURACION_DEFECTO_MIN = 30; // duración por defecto de cada hueco, en minutos

app.use(cors());
app.use(express.json());
app.use(cookieParser());

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("Falta JWT_SECRET en las variables de entorno");
}


const SESSION_DURATION = "7d";
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

function getUserFromRequest(req) {
  const token = req.cookies?.peluqueria_session;
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Middleware de autenticación de administrador (simple, basado en contraseña
// enviada en la cabecera x-admin-password). Suficiente para una base inicial;
// se puede sustituir por JWT/sesiones más adelante.
// ---------------------------------------------------------------------------
function requireAdmin(req, res, next) {
  const password = req.header("x-admin-password");
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "No autorizado" });
  }
  next();
}

// Protege rutas de API que exigen sesión de cliente (cookie httpOnly).
async function requireUser(req, res, next) {
  const session = getUserFromRequest(req);

  if (!session || !session.userId) {
    return res.status(401).json({ error: "Debes iniciar sesión" });
  }

  const user = await getUserById(session.userId);

  if (!user) {
    return res.status(401).json({ error: "La sesión ya no es válida" });
  }

  req.user = user;
  next();
}

// Protege páginas HTML que exigen sesión de cliente. OJO: esto NO se usa en
// "/" a propósito -> la web de reservas se puede navegar sin cuenta (ver
// precios, horas...), solo hace falta login para completar una reserva.
// Se usa únicamente en "/myreservations".
async function requireUserPage(req, res, next) {
  try {
    const session = getUserFromRequest(req);

    if (!session || !session.userId) {
      return res.redirect(
        "/login?return=" + encodeURIComponent(req.originalUrl),
      );
    }

    const user = await getUserById(session.userId);

    if (!user) {
      res.clearCookie("peluqueria_session", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
      });
      return res.redirect(
        "/login?return=" + encodeURIComponent(req.originalUrl),
      );
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("Error comprobando página protegida:", error);
    res.redirect("/login");
  }
}

function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function createUserSession(res, user) {
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, {
    expiresIn: SESSION_DURATION,
  });

  res.cookie("peluqueria_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
}

// ---------------------------------------------------------------------------
// Fecha/hora "de ahora" en hora LOCAL del servidor, calculada sin pasar por
// toISOString()/UTC (para evitar desfases horarios). Se usa para impedir
// reservar/aceptar/cancelar huecos que ya han pasado.
// ---------------------------------------------------------------------------
function todayStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function nowHHMM() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function isPastSlot(date, time) {
  const today = todayStr();
  if (date < today) return true;
  if (date > today) return false;
  return time <= nowHHMM();
}

// Solo aplica a la cancelación hecha por el propio CLIENTE: no puede
// cancelar con menos de 1 hora de antelación. El admin no tiene esta
// restricción (puede rechazar/cancelar aunque sea de última hora).
function isCancellationTooLate(date, time) {
  const now = new Date();
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.substring(0, 5).split(":").map(Number);
  const appointment = new Date(year, month - 1, day, hours, minutes, 0, 0);
  const diffMs = appointment.getTime() - now.getTime();
  return diffMs < 60 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// LOGIN ADMIN
// ---------------------------------------------------------------------------
app.post("/api/admin/login", (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, error: "Contraseña incorrecta" });
});

// ---------------------------------------------------------------------------
// PÚBLICO: ajustes visibles para el cliente (métodos de pago aceptados)
// ---------------------------------------------------------------------------
app.get("/api/public/settings", async (req, res) => {
  try {
    const data = await readData();
    res.json(data.settings);
  } catch (error) {
    console.error("Error fetching settings:", error);
    res.status(500).json({ error: "Error al obtener los ajustes" });
  }
});

// ---------------------------------------------------------------------------
// PÚBLICO: listado de servicios y precios
// ---------------------------------------------------------------------------
app.get("/api/public/services", async (req, res) => {
  try {
    const data = await readData();
    res.json(data.services);
  } catch (error) {
    console.error("Error fetching services:", error);
    res.status(500).json({ error: "Error al obtener los servicios" });
  }
});

// ---------------------------------------------------------------------------
// PÚBLICO: consultar huecos libres de un día concreto.
// Nunca devuelve huecos ya pasados.
// GET /api/public/slots?date=YYYY-MM-DD
// ---------------------------------------------------------------------------
app.get("/api/public/slots", async (req, res) => {
  try {
    const { date } = req.query;
    if (!date)
      return res.status(400).json({ error: "Falta el parámetro date" });

    const data = await readData();
    const slots = data.slots
      .filter(
        (s) =>
          s.date === date &&
          s.status === "libre" &&
          !isPastSlot(s.date, s.time),
      )
      .sort((a, b) => a.time.localeCompare(b.time));

    res.json(slots);
  } catch (error) {
    console.error("Error fetching slots:", error);
    res.status(500).json({ error: "Error al obtener los huecos" });
  }
});

// ---------------------------------------------------------------------------
// CLIENTE (con sesión): solicitar una reserva sobre un hueco libre.
// Los datos de contacto (nombre/teléfono/email) se toman SIEMPRE de la
// cuenta autenticada (req.user), nunca del cuerpo de la petición: así no
// hace falta volver a validarlos aquí y no pueden falsificarse.
// POST /api/bookings  { slotId, notes, serviceId }
// ---------------------------------------------------------------------------
app.post("/api/bookings", requireUser, async (req, res) => {
  try {
    const { slotId, notes, serviceId } = req.body;

    if (!slotId) {
      return res.status(400).json({ error: "Falta el hueco a reservar" });
    }
    // La tabla bookings exige service_id (NOT NULL): hay que elegir un servicio.
    if (!serviceId) {
      return res.status(400).json({ error: "Debes seleccionar un servicio" });
    }

    const data = await readData();
    const slot = data.slots.find((s) => s.id === slotId);

    if (!slot) return res.status(404).json({ error: "El hueco no existe" });
    if (slot.status !== "libre") {
      return res.status(409).json({ error: "Ese hueco ya no está disponible" });
    }
    if (isPastSlot(slot.date, slot.time)) {
      return res
        .status(409)
        .json({ error: "No se puede reservar una hora que ya ha pasado" });
    }

    const service = data.services.find((sv) => sv.id === serviceId);
    if (!service) {
      return res
        .status(400)
        .json({ error: "El servicio seleccionado no existe" });
    }

    const booking = {
      id: uid(),
      slotId,
      name: req.user.name,
      phone: req.user.phone,
      email: req.user.email,
      notes: notes || "",
      serviceId: service.id,
      serviceName: service.name,
      userId: req.user.id,
      createdAt: new Date().toISOString(),
      status: "pendiente",
    };

    slot.status = "pendiente";
    data.bookings.push(booking);
    data.slots = data.slots.map((s) => (s.id === slotId ? slot : s));
    await writeData(data);

    res.status(201).json({ booking, slot });
  } catch (error) {
    console.error("Error creating booking:", error);
    res.status(500).json({ error: "Error al crear la reserva" });
  }
});

// ---------------------------------------------------------------------------
// ADMIN: listar todos los huecos en un rango de fechas
// ---------------------------------------------------------------------------
app.get("/api/admin/slots", requireAdmin, async (req, res) => {
  try {
    const { from, to } = req.query;
    const data = await readData();

    let slots = data.slots;
    if (from) slots = slots.filter((s) => s.date >= from);
    if (to) slots = slots.filter((s) => s.date <= to);

    const enriched = slots.map((s) => {
      if (s.status === "reservado" || s.status === "pendiente") {
        // Solo la reserva ACTIVA de este hueco (puede haber otras ya
        // canceladas en el histórico apuntando al mismo slot_id).
        const booking = data.bookings.find(
          (b) =>
            (b.slotId === s.id || b.slot_id === s.id) &&
            b.status !== "cancelada",
        );
        return { ...s, booking };
      }
      return s;
    });

    res.json(enriched);
  } catch (error) {
    console.error("Error fetching admin slots:", error);
    res.status(500).json({ error: "Error al obtener los huecos" });
  }
});

// ---------------------------------------------------------------------------
// ADMIN: histórico de cancelaciones
// ---------------------------------------------------------------------------
app.get("/api/admin/cancellations", requireAdmin, async (req, res) => {
  try {
    const data = await readData();

    const cancellations = data.bookings
      .filter((booking) => booking.status === "cancelada")
      .map((booking) => {
        const slot = data.slots.find(
          (s) => s.id === booking.slotId || s.id === booking.slot_id,
        );
        return {
          bookingId: booking.id,
          date: booking.appointmentDate || slot?.date || null,
          time: booking.appointmentTime || slot?.time || null,
          name: booking.name,
          email: booking.email,
          phone: booking.phone,
          serviceName: booking.serviceName,
          reason: booking.cancellationReason || "Sin motivo",
          cancelledAt: booking.cancelledAt || null,
          cancelledBy: booking.cancelledBy || null,
        };
      })
      .sort(
        (a, b) => new Date(b.cancelledAt || 0) - new Date(a.cancelledAt || 0),
      );

    res.json(cancellations);
  } catch (error) {
    console.error("Error fetching cancellations:", error);
    res.status(500).json({ error: "Error al obtener las cancelaciones" });
  }
});

// ---------------------------------------------------------------------------
// ADMIN: crear huecos disponibles.
// POST /api/admin/slots
//   { date, time, duration }               -> un único hueco
//   { date, startTime, endTime, duration } -> genera varios huecos
// ---------------------------------------------------------------------------
app.post("/api/admin/slots", requireAdmin, async (req, res) => {
  try {
    const { date, time, startTime, endTime, duration } = req.body;
    const dur = duration || DURACION_DEFECTO_MIN;

    if (!date) return res.status(400).json({ error: "Falta la fecha (date)" });

    const data = await readData();
    const created = [];

    function addSlot(hhmm) {
      const exists = data.slots.some((s) => s.date === date && s.time === hhmm);
      if (exists) return;
      const slot = {
        id: uid(),
        date,
        time: hhmm,
        duration: dur,
        status: "libre",
      };
      data.slots.push(slot);
      created.push(slot);
    }

    if (startTime && endTime) {
      let [h, m] = startTime.split(":").map(Number);
      const [endH, endM] = endTime.split(":").map(Number);
      const endTotal = endH * 60 + endM;

      while (h * 60 + m < endTotal) {
        const hh = String(h).padStart(2, "0");
        const mm = String(m).padStart(2, "0");
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
      return res
        .status(400)
        .json({ error: "Debes indicar time, o bien startTime y endTime" });
    }

    await writeData(data);
    res.status(201).json(created);
  } catch (error) {
    console.error("Error creating slots:", error);
    res.status(500).json({ error: "Error al crear los huecos" });
  }
});

// ---------------------------------------------------------------------------
// ADMIN: eliminar un hueco.
// Solo si está libre Y si nunca ha tenido ninguna reserva (ni siquiera
// cancelada): tu tabla "bookings" no borra el histórico y la FK a "slots"
// no tiene ON DELETE, así que borrar un hueco con historial rompería la
// referencia. Se comprueba aquí para dar un error claro en vez de un 500.
// ---------------------------------------------------------------------------
app.delete("/api/admin/slots/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const data = await readData();
    const slot = data.slots.find((s) => s.id === id);

    if (!slot) return res.status(404).json({ error: "Hueco no encontrado" });
    if (slot.status !== "libre") {
      return res.status(409).json({
        error:
          "No se puede borrar un hueco con una reserva. Rechaza o cancela la reserva primero.",
      });
    }

    const hasHistory = data.bookings.some(
      (b) => b.slotId === id || b.slot_id === id,
    );
    if (hasHistory) {
      return res.status(409).json({
        error:
          "Este hueco tiene reservas en su historial (aunque estén canceladas) y no se puede eliminar.",
      });
    }

    await deleteSlot(id);
    res.json({ ok: true });
  } catch (error) {
    console.error("Error deleting slot:", error);
    res.status(500).json({ error: "Error al eliminar el hueco" });
  }
});

// ---------------------------------------------------------------------------
// ADMIN: listar todas las reservas
// ---------------------------------------------------------------------------
app.get("/api/admin/bookings", requireAdmin, async (req, res) => {
  try {
    const data = await readData();
    const enriched = data.bookings
      .map((b) => ({
        ...b,
        slot: data.slots.find((s) => s.id === b.slotId || s.id === b.slot_id),
      }))
      .sort((a, b) =>
        (a.slot?.date + a.slot?.time).localeCompare(
          b.slot?.date + b.slot?.time,
        ),
      );
    res.json(enriched);
  } catch (error) {
    console.error("Error fetching bookings:", error);
    res.status(500).json({ error: "Error al obtener las reservas" });
  }
});

// ---------------------------------------------------------------------------
// ADMIN: aceptar una reserva pendiente -> el hueco pasa a "reservado"
// ---------------------------------------------------------------------------
app.put("/api/admin/bookings/:id/accept", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const data = await readData();
    const booking = data.bookings.find((b) => b.id === id);

    if (!booking)
      return res.status(404).json({ error: "Reserva no encontrada" });

    const slot = data.slots.find(
      (s) => s.id === booking.slotId || s.id === booking.slot_id,
    );
    if (!slot)
      return res.status(404).json({ error: "El hueco asociado no existe" });
    if (slot.status !== "pendiente") {
      return res
        .status(409)
        .json({ error: "Esta reserva ya no está pendiente de aceptación" });
    }
    if (isPastSlot(slot.date, slot.time)) {
      return res
        .status(409)
        .json({
          error: "No se puede aceptar una reserva cuya hora ya ha pasado",
        });
    }

    slot.status = "reservado";
    data.slots = data.slots.map((s) => (s.id === slot.id ? slot : s));
    await writeData(data);
    res.json({ booking, slot });
  } catch (error) {
    console.error("Error accepting booking:", error);
    res.status(500).json({ error: "Error al aceptar la reserva" });
  }
});

// ---------------------------------------------------------------------------
// ADMIN: rechazar una reserva pendiente, o cancelar una ya confirmada.
// El admin SÍ puede actuar incluso "de última hora" (no se le aplica la
// regla de 1 hora de antelación, que es solo para la cancelación del
// propio cliente). Solo se le impide tocar una cita cuya hora YA pasó.
// La reserva no se borra: se marca como "cancelada" (queda en el histórico).
// ---------------------------------------------------------------------------
app.delete("/api/admin/bookings/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};

    const data = await readData();
    const booking = data.bookings.find((b) => b.id === id);

    if (!booking)
      return res.status(404).json({ error: "Reserva no encontrada" });
    if (booking.status === "cancelada") {
      return res.status(409).json({ error: "Esta reserva ya está cancelada" });
    }

    const slot = data.slots.find(
      (s) => s.id === booking.slotId || s.id === booking.slot_id,
    );
    if (!slot)
      return res.status(404).json({ error: "El hueco asociado no existe" });

    if (isPastSlot(slot.date, slot.time)) {
      return res
        .status(409)
        .json({
          error:
            "No se puede cancelar o rechazar una cita cuya hora ya ha pasado",
        });
    }

    const cancellationReason =
      reason && reason.trim()
        ? reason.trim()
        : "Cancelada por el administrador";
    if (cancellationReason.length > 500) {
      return res
        .status(400)
        .json({ error: "El motivo no puede superar los 500 caracteres" });
    }

    booking.status = "cancelada";
    booking.cancellationReason = cancellationReason;
    booking.cancelledAt = new Date().toISOString();
    booking.cancelledBy = "admin";

    slot.status = "libre";

    data.bookings = data.bookings.map((b) =>
      b.id === booking.id ? booking : b,
    );
    data.slots = data.slots.map((s) => (s.id === slot.id ? slot : s));

    await writeData(data);

    res.json({ ok: true, booking, slot });
  } catch (error) {
    console.error("Error cancelling booking:", error);
    res.status(500).json({ error: "Error al cancelar la reserva" });
  }
});

// ---------------------------------------------------------------------------
// ADMIN: leer / actualizar ajustes (métodos de pago aceptados)
// ---------------------------------------------------------------------------
app.get("/api/admin/settings", requireAdmin, async (req, res) => {
  try {
    const data = await readData();
    res.json(data.settings);
  } catch (error) {
    console.error("Error fetching settings:", error);
    res.status(500).json({ error: "Error al obtener los ajustes" });
  }
});

app.put("/api/admin/settings", requireAdmin, async (req, res) => {
  try {
    const { cardPaymentEnabled } = req.body;
    if (typeof cardPaymentEnabled !== "boolean") {
      return res
        .status(400)
        .json({ error: "cardPaymentEnabled debe ser true o false" });
    }
    const data = await readData();
    data.settings.cardPaymentEnabled = cardPaymentEnabled;
    await writeData(data);
    res.json(data.settings);
  } catch (error) {
    console.error("Error updating settings:", error);
    res.status(500).json({ error: "Error al actualizar los ajustes" });
  }
});

// ---------------------------------------------------------------------------
// ADMIN: gestión del listado de precios / tipos de corte
// ---------------------------------------------------------------------------
app.get("/api/admin/services", requireAdmin, async (req, res) => {
  try {
    const data = await readData();
    res.json(data.services);
  } catch (error) {
    console.error("Error fetching services:", error);
    res.status(500).json({ error: "Error al obtener los servicios" });
  }
});

app.post("/api/admin/services", requireAdmin, async (req, res) => {
  try {
    const { name, price } = req.body;
    const numericPrice = Number(price);

    if (!name || !name.trim())
      return res.status(400).json({ error: "Falta el nombre del servicio" });
    if (Number.isNaN(numericPrice) || numericPrice < 0) {
      return res.status(400).json({ error: "El precio no es válido" });
    }

    const data = await readData();
    const service = { id: uid(), name: name.trim(), price: numericPrice };
    data.services.push(service);
    await writeData(data);
    res.status(201).json(service);
  } catch (error) {
    console.error("Error creating service:", error);
    res.status(500).json({ error: "Error al crear el servicio" });
  }
});

app.put("/api/admin/services/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, price } = req.body;
    const numericPrice = Number(price);

    if (!name || !name.trim())
      return res.status(400).json({ error: "Falta el nombre del servicio" });
    if (Number.isNaN(numericPrice) || numericPrice < 0) {
      return res.status(400).json({ error: "El precio no es válido" });
    }

    const data = await readData();
    const service = data.services.find((s) => s.id === id);
    if (!service)
      return res.status(404).json({ error: "Servicio no encontrado" });

    service.name = name.trim();
    service.price = numericPrice;
    data.services = data.services.map((s) => (s.id === id ? service : s));
    await writeData(data);
    res.json(service);
  } catch (error) {
    console.error("Error updating service:", error);
    res.status(500).json({ error: "Error al actualizar el servicio" });
  }
});

// Igual que con los huecos: si algún booking (incluso cancelado) referencia
// este servicio, borrarlo rompería la FK (NOT NULL, sin ON DELETE). Se
// comprueba antes para dar un error claro.
app.delete("/api/admin/services/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const data = await readData();
    const exists = data.services.some((s) => s.id === id);
    if (!exists)
      return res.status(404).json({ error: "Servicio no encontrado" });

    const hasHistory = data.bookings.some(
      (b) => b.serviceId === id || b.service_id === id,
    );
    if (hasHistory) {
      return res.status(409).json({
        error:
          "Este servicio tiene reservas en su historial y no se puede eliminar.",
      });
    }

    data.services = data.services.filter((s) => s.id !== id);
    await writeData(data);
    res.json({ ok: true });
  } catch (error) {
    console.error("Error deleting service:", error);
    res.status(500).json({ error: "Error al eliminar el servicio" });
  }
});

// =========================================================================
// AUTENTICACIÓN DE USUARIOS
// =========================================================================

app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password, name, phone } = req.body;

    if (!email || !password || !name || !phone) {
      return res
        .status(400)
        .json({ error: "Faltan email, contraseña, nombre o teléfono" });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "El email no es válido" });
    }
    if (password.length < 6) {
      return res
        .status(400)
        .json({ error: "La contraseña debe tener mínimo 6 caracteres" });
    }

    const user = await registerUser(email, password, name, phone);
    const publicUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
    };

    createUserSession(res, user);

    res.status(201).json({ ok: true, user: publicUser });
  } catch (error) {
    if (error.message && error.message.includes("duplicate")) {
      return res
        .status(400)
        .json({ error: "Ya existe una cuenta con ese email" });
    }
    console.error("Error registering user:", error);
    res.status(500).json({ error: "Error al registrar" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Faltan email o contraseña" });
    }

    const user = await loginUser(email, password);
    const publicUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
    };

    createUserSession(res, user);

    res.json({ ok: true, user: publicUser });
  } catch (error) {
    res.status(401).json({ error: error.message || "Credenciales inválidas" });
  }
});

app.get("/api/auth/me", async (req, res) => {
  try {
    const session = getUserFromRequest(req);
    if (!session || !session.userId) {
      return res.json({ authenticated: false, user: null });
    }

    const user = await getUserById(session.userId);
    if (!user) {
      res.clearCookie("peluqueria_session", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
      });
      return res.json({ authenticated: false, user: null });
    }

    res.json({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
      },
    });
  } catch (error) {
    console.error("Error comprobando sesión:", error);
    res.status(500).json({ error: "Error comprobando sesión" });
  }
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("peluqueria_session", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  res.json({ ok: true });
});

// GET /api/users/me/bookings -> las reservas del usuario autenticado
app.get("/api/users/me/bookings", requireUser, async (req, res) => {
  try {
    const bookings = await getUserBookings(req.user.id);
    res.json(bookings);
  } catch (error) {
    console.error("Error fetching user bookings:", error);
    res.status(500).json({ error: "Error al obtener reservas" });
  }
});

// ---------------------------------------------------------------------------
// USUARIO: cancelar una reserva propia (regla: mínimo 1h de antelación)
// POST /api/users/me/bookings/:bookingId/cancel  { reason }
// ---------------------------------------------------------------------------
app.post(
  "/api/users/me/bookings/:bookingId/cancel",
  requireUser,
  async (req, res) => {
    try {
      const { bookingId } = req.params;
      const { reason } = req.body;

      if (!reason || !reason.trim()) {
        return res
          .status(400)
          .json({ error: "Debes indicar un motivo de cancelación" });
      }
      const cancellationReason = reason.trim();
      if (cancellationReason.length > 500) {
        return res
          .status(400)
          .json({ error: "El motivo no puede superar los 500 caracteres" });
      }

      const data = await readData();
      const booking = data.bookings.find(
        (b) => b.id === bookingId && b.userId === req.user.id,
      );

      if (!booking)
        return res.status(404).json({ error: "Reserva no encontrada" });
      if (booking.status === "cancelada") {
        return res
          .status(409)
          .json({ error: "Esta reserva ya está cancelada" });
      }

      const slot = data.slots.find(
        (s) => s.id === booking.slotId || s.id === booking.slot_id,
      );
      if (!slot)
        return res.status(404).json({ error: "El hueco asociado no existe" });

      if (isCancellationTooLate(slot.date, slot.time)) {
        return res.status(409).json({
          error:
            "Esta cita ya no se puede cancelar. Las cancelaciones deben hacerse como mínimo una hora antes de la reserva.",
        });
      }

      booking.status = "cancelada";
      booking.cancellationReason = cancellationReason;
      booking.cancelledAt = new Date().toISOString();
      booking.cancelledBy = "usuario";

      slot.status = "libre";

      data.bookings = data.bookings.map((b) =>
        b.id === booking.id ? booking : b,
      );
      data.slots = data.slots.map((s) => (s.id === slot.id ? slot : s));

      await writeData(data);

      res.json({ ok: true, booking, slot });
    } catch (error) {
      console.error("Error cancelling user booking:", error);
      res.status(500).json({ error: "Error al cancelar la reserva" });
    }
  },
);

// ---------------------------------------------------------------------------
// Servir el frontend (ficheros estáticos)
// ---------------------------------------------------------------------------
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");
app.use(express.static(FRONTEND_DIR));

// "/" es pública a propósito: se puede ver precios/horas sin cuenta.
// Solo se exige login al intentar completar una reserva (POST /api/bookings).
app.get("/", (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "admin.html"));
});

app.get("/login", (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "login.html"));
});

// "/myreservations" sí exige sesión, tiene sentido: es la lista privada
// de reservas del cliente.
app.get("/myreservations", requireUserPage, (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "myreservations.html"));
});

app.listen(PORT, () => {
  console.log(`\n✅ Servidor de la peluquería arrancado`);
  console.log(`   Web clientes:  http://localhost:${PORT}/`);
  console.log(`   Panel admin:   http://localhost:${PORT}/admin`);
  console.log(`   Password admin (por defecto): ${ADMIN_PASSWORD}\n`);
});
