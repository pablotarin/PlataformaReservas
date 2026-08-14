// supabase.js
// Almacenamiento en Supabase. Reemplaza a db.js con la misma interfaz.

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env file");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
console.log("🔗 Supabase URL:", SUPABASE_URL);
console.log(
  "🔑 Supabase key:",
  SUPABASE_ANON_KEY ? SUPABASE_ANON_KEY.substring(0, 20) + "..." : "NO KEY",
);

// Cache en memoria para evitar fetches excesivos
let cachedData = null;
let lastFetch = 0;
const CACHE_TTL = 0; // Desactivado: siempre obtener datos frescos

// ---------------------------------------------------------------------------
// Contraseñas: hash con salt usando scrypt (módulo nativo de Node, sin
// dependencias externas). Nunca se guarda la contraseña en texto plano.
// Formato almacenado: "salt:hash" (ambos en hex).
// ---------------------------------------------------------------------------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const hashToVerify = crypto.scryptSync(password, salt, 64).toString("hex");
  // Comparación en tiempo constante para evitar timing attacks
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(hashToVerify, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function readData() {
  const now = Date.now();
  if (cachedData && now - lastFetch < CACHE_TTL) {
    console.log("📦 Usando datos en caché");
    return cachedData;
  }

  try {
    console.log("📡 Leyendo datos de Supabase...");
    const [servicesRes, slotsRes, bookingsRes, settingsRes] = await Promise.all(
      [
        supabase.from("services").select("*"),
        supabase.from("slots").select("*"),
        supabase.from("bookings").select("*"),
        supabase.from("settings").select("*"),
      ],
    );

    if (servicesRes.error) {
      console.error("❌ SUPABASE services:", servicesRes.error);
      throw servicesRes.error;
    }

    if (slotsRes.error) {
      console.error("❌ SUPABASE slots:", slotsRes.error);
      throw slotsRes.error;
    }

    if (bookingsRes.error) {
      console.error("❌ SUPABASE bookings:", bookingsRes.error);
      throw bookingsRes.error;
    }

    if (settingsRes.error) {
      console.error("❌ SUPABASE settings:", settingsRes.error);
      throw settingsRes.error;
    }

    console.log(
      `✅ Datos leídos: ${slotsRes.data?.length || 0} slots, ${bookingsRes.data?.length || 0} bookings`,
    );

    // Normalizar bookings: convertir snake_case a camelCase
    const bookings = (bookingsRes.data || []).map((b) => ({
      id: b.id,
      slotId: b.slot_id,
      serviceId: b.service_id,
      serviceName: b.service_name || null,
      userId: b.user_id || null,
      name: b.name,
      phone: b.phone,
      email: b.email,
      notes: b.notes || "",
      createdAt: b.created_at,

      // Cancelación
      status: b.status || "activa",
      cancellationReason: b.cancellation_reason || null,
      cancelledAt: b.cancelled_at || null,
      cancelledBy: b.cancelled_by || null,
    }));

    // Normalizar slots: convertir tiempo a formato HH:MM
    const slots = (slotsRes.data || []).map((s) => ({
      id: s.id,
      date: s.date,
      time: s.time.substring(0, 5), // "09:00:00" -> "09:00"
      duration: s.duration,
      status: s.status,
      created_at: s.created_at,
    }));

    cachedData = {
      services: servicesRes.data || [],
      slots,
      bookings,
      settings: normalizeSettings(settingsRes.data),
    };

    lastFetch = now;
    return cachedData;
  } catch (error) {
    console.error("Error reading data from Supabase:", error);
    throw error;
  }
}

function normalizeSettings(rows) {
  const settings = {};

  for (const row of rows || []) {
    settings[row.key] = row.value;
  }

  return {
    cardPaymentEnabled: settings.card_payment_enabled === "true",
    cancellationLimitMinutes: Number(settings.cancellation_limit_minutes || 60),
    cancellationFee: Number(settings.cancellation_fee || 0),
  };
}

async function writeData(data) {
  try {
    console.log("💾 Iniciando escritura en Supabase...");

    // Actualizar servicios
    if (data.services && data.services.length > 0) {
      console.log(`  • Escribiendo ${data.services.length} servicios`);
      for (const service of data.services) {
        const { error } = await supabase
          .from("services")
          .upsert(
            { id: service.id, name: service.name, price: service.price },
            { onConflict: "id" },
          );
        if (error) {
          console.error(
            `    ❌ Error escribiendo servicio ${service.id}:`,
            error,
          );
          throw error;
        }
      }
      console.log("    ✅ Servicios escritos correctamente");
    }

    // Actualizar slots
    if (data.slots && data.slots.length > 0) {
      console.log(`  • Escribiendo ${data.slots.length} slots`);
      for (const slot of data.slots) {
        console.log(`    Slot: ${slot.date} ${slot.time} (${slot.id})`);
        const { error } = await supabase.from("slots").upsert(
          {
            id: slot.id,
            date: slot.date,
            time: slot.time,
            duration: slot.duration,
            status: slot.status,
          },
          { onConflict: "id" },
        );
        if (error) {
          console.error(`    ❌ Error escribiendo slot ${slot.id}:`, error);
          throw error;
        }
      }
      console.log("    ✅ Slots escritos correctamente");
    }

    // Actualizar bookings
    if (data.bookings && data.bookings.length > 0) {
      console.log(`  • Escribiendo ${data.bookings.length} reservas`);
      for (const booking of data.bookings) {
        const { error } = await supabase.from("bookings").upsert(
          {
            id: booking.id,
            slot_id: booking.slotId || booking.slot_id,
            service_id: booking.serviceId || booking.service_id,
            service_name: booking.serviceName || booking.service_name || null,
            user_id: booking.userId || booking.user_id || null,
            name: booking.name,
            phone: booking.phone,
            email: booking.email,
            notes: booking.notes || "",
            status: booking.status || "activa",
            cancellation_reason:
              booking.cancellationReason || booking.cancellation_reason || null,
            cancelled_at: booking.cancelledAt || booking.cancelled_at || null,
            cancelled_by: booking.cancelledBy || booking.cancelled_by || null,
          },
          { onConflict: "id" },
        );
        if (error) {
          console.error(
            `    ❌ Error escribiendo reserva ${booking.id}:`,
            error,
          );
          throw error;
        }
      }
      console.log("    ✅ Reservas escritas correctamente");
    }

    // Actualizar settings
    if (data.settings) {
      console.log("  • Escribiendo settings");

      const settingsToSave = {
        card_payment_enabled: data.settings.cardPaymentEnabled,
        cancellation_limit_minutes: data.settings.cancellationLimitMinutes,
        cancellation_fee: data.settings.cancellationFee,
      };

      for (const [key, value] of Object.entries(settingsToSave)) {
        if (value === undefined) continue;

        const { error } = await supabase.from("settings").upsert(
          {
            key,
            value: String(value),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "key" },
        );

        if (error) {
          console.error(`    ❌ Error escribiendo setting ${key}:`, error);
          throw error;
        }
      }

      console.log("    ✅ Settings escritos correctamente");
    }

    // Invalidar cache
    cachedData = null;
    console.log("✅ Escritura completada, cache invalidado");
  } catch (error) {
    console.error("❌ Error escribiendo datos en Supabase:", error);
    throw error;
  }
}

// Funciones específicas para DELETE
async function deleteSlot(slotId) {
  try {
    console.log(`  🗑️ Eliminando slot ${slotId}...`);
    const { error } = await supabase.from("slots").delete().eq("id", slotId);

    if (error) {
      console.error(`    ❌ Error eliminando slot ${slotId}:`, error);
      throw error;
    }
    console.log(`    ✅ Slot eliminado`);
    cachedData = null; // Invalidar cache
  } catch (error) {
    console.error("❌ Error en deleteSlot:", error);
    throw error;
  }
}

async function deleteBooking(bookingId) {
  try {
    console.log(`  🗑️ Eliminando reserva ${bookingId}...`);
    const { error } = await supabase
      .from("bookings")
      .delete()
      .eq("id", bookingId);

    if (error) {
      console.error(`    ❌ Error eliminando reserva ${bookingId}:`, error);
      throw error;
    }
    console.log(`    ✅ Reserva eliminada`);
    cachedData = null; // Invalidar cache
  } catch (error) {
    console.error("❌ Error en deleteBooking:", error);
    throw error;
  }
}

// ========== FUNCIONES PARA USUARIOS ==========

async function registerUser(email, password, name, phone) {
  try {
    console.log(`👤 Registrando usuario ${email}...`);

    // Comprobar si ya existe un usuario con ese email
    const { data: existing, error: findError } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (findError) throw findError;
    if (existing) {
      throw new Error("duplicate: ya existe una cuenta con ese email");
    }

    const hashedPassword = hashPassword(password);

    const { data, error } = await supabase
      .from("users")
      .insert([
        {
          email,
          password: hashedPassword,
          name,
          phone: phone || null,
        },
      ])
      .select();

    if (error) throw error;
    console.log(`✅ Usuario registrado`);
    return data[0];
  } catch (error) {
    console.error("❌ Error en registerUser:", error.message || error);
    throw error;
  }
}

async function loginUser(email, password) {
  try {
    console.log(`🔐 Login usuario ${email}...`);
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .maybeSingle();

    if (error) throw error;
    if (!data || !verifyPassword(password, data.password)) {
      console.log("❌ Credenciales inválidas");
      throw new Error("Email o contraseña incorrectos");
    }
    console.log(`✅ Login exitoso`);
    return data;
  } catch (error) {
    console.error("❌ Error en loginUser:", error.message);
    throw error;
  }
}

async function getUserById(userId) {
  const { data, error } = await supabase
    .from("users")
    .select("id, email, name, phone, is_admin")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;

  if (!data) return null;

  return {
    id: data.id,
    email: data.email,
    name: data.name,
    phone: data.phone,
    isAdmin: data.is_admin,
  };
}

async function getUserBookings(userId) {
  try {
    const { data, error } = await supabase
      .from("bookings")
      .select("*, slots:slot_id(*), services:service_id(*)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    // Normalizar datos
    return (data || []).map((b) => ({
      id: b.id,
      slotId: b.slot_id,
      serviceId: b.service_id,
      name: b.name,
      phone: b.phone,
      email: b.email,
      notes: b.notes || "",
      createdAt: b.created_at,
      userId: b.user_id,

      status: b.status || "activa",
      cancellationReason: b.cancellation_reason || null,
      cancelledAt: b.cancelled_at || null,
      cancelledBy: b.cancelled_by || null,

      slot: b.slots
        ? {
            id: b.slots.id,
            date: b.slots.date,
            time: b.slots.time.substring(0, 5),
            duration: b.slots.duration,
            status: b.slots.status,
          }
        : null,

      service: b.services
        ? {
            id: b.services.id,
            name: b.services.name,
            price: b.services.price,
          }
        : null,
    }));
  } catch (error) {
    console.error("❌ Error en getUserBookings:", error);
    throw error;
  }
}

function uid() {
  return crypto.randomUUID();
}

async function testSettingsWrite() {
  console.log("🧪 Probando escritura directa en settings...");

  const { data, error } = await supabase
    .from("settings")
    .upsert(
      {
        key: "card_payment_enabled",
        value: "false",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    )
    .select();

  console.log("🧪 Resultado settings:", { data, error });

  return { data, error };
}

async function createSlots(slots) {
  if (!slots || slots.length === 0) return [];

  const rows = slots.map((slot) => ({
    id: slot.id,
    date: slot.date,
    time: slot.time,
    duration: slot.duration,
    status: slot.status,
  }));

  const { data, error } = await supabase
    .from("slots")
    .insert(rows)
    .select();

  if (error) throw error;

  cachedData = null;
  return data;
}

module.exports = {
  readData,
  writeData,
  deleteSlot,
  deleteBooking,
  registerUser,
  loginUser,
  getUserById,
  getUserBookings,
  uid,
  supabase,
  createSlots
};
