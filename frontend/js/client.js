// client.js — lógica de la página pública de reservas

const dateInput = document.getElementById("date");
const slotsContainer = document.getElementById("slotsContainer");
const formCard = document.getElementById("formCard");
const loginPromptCard = document.getElementById("loginPromptCard");
const bookingForm = document.getElementById("bookingForm");
const toast = document.getElementById("toast");
const serviceSelect = document.getElementById("service");
const pricesCard = document.getElementById("pricesCard");
const pricesTbody = document.getElementById("pricesTbody");
const paymentInfo = document.getElementById("paymentInfo");
const bookingAsLabel = document.getElementById("bookingAsLabel");

let selectedSlotId = null;
let selectedSlotDate = null;
let selectedSlotTime = null;

renderAccountBar("accountBar");

function localTodayStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function localNowHHMM() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

const today = localTodayStr();
dateInput.min = today;
dateInput.value = today;

function showToast(msg, type = "") {
  toast.textContent = msg;
  toast.className = "toast show " + type;
  setTimeout(() => {
    toast.className = "toast";
  }, 3500);
}

function formatTime(t) {
  return t;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Precios y forma de pago
// ---------------------------------------------------------------------------
async function loadServices() {
  try {
    const res = await fetch("/api/public/services");
    const services = await res.json();

    if (Array.isArray(services) && services.length > 0) {
      pricesTbody.innerHTML = services
        .map((s) => `<tr><td>${escapeHtml(s.name)}</td><td class="price-col">${s.price.toFixed(2)} €</td></tr>`)
        .join("");
      pricesCard.style.display = "block";

      // El servicio es obligatorio (la tabla bookings lo exige), así que no
      // se ofrece opción "Sin especificar": se elige uno siempre.
      serviceSelect.innerHTML = services
        .map((s) => `<option value="${s.id}">${escapeHtml(s.name)} (${s.price.toFixed(2)} €)</option>`)
        .join("");
    }
  } catch (err) {
    // Si falla, simplemente no mostramos la tabla de precios
  }
}

async function loadPaymentInfo() {
  try {
    const res = await fetch("/api/public/settings");
    const settings = await res.json();
    paymentInfo.textContent = settings.cardPaymentEnabled
      ? "Formas de pago aceptadas: efectivo y tarjeta."
      : "Formas de pago aceptadas: solo efectivo.";
  } catch (err) {
    // silencioso
  }
}

// ---------------------------------------------------------------------------
// Huecos disponibles (el backend ya excluye los que ya han pasado)
// ---------------------------------------------------------------------------
async function loadSlots() {
  const date = dateInput.value;
  selectedSlotId = null;
  selectedSlotDate = null;
  selectedSlotTime = null;
  formCard.style.display = "none";
  loginPromptCard.style.display = "none";
  slotsContainer.innerHTML = '<p class="empty-msg">Cargando...</p>';

  if (!date) return;

  try {
    const res = await fetch(`/api/public/slots?date=${date}`);
    const slots = await res.json();

    if (!Array.isArray(slots) || slots.length === 0) {
      slotsContainer.classList.remove("slots-grid");
      slotsContainer.innerHTML = '<p class="empty-msg">No hay horas disponibles para este día. Prueba con otra fecha.</p>';
      return;
    }

    slotsContainer.classList.add("slots-grid");
    slotsContainer.innerHTML = "";
    slots.forEach((slot) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "slot-btn";
      btn.textContent = formatTime(slot.time);
      btn.addEventListener("click", () => selectSlot(slot.id, slot.date, slot.time, btn));
      slotsContainer.appendChild(btn);
    });
  } catch (err) {
    slotsContainer.innerHTML = '<p class="empty-msg">Error al cargar las horas disponibles.</p>';
  }
}

// Nota: comprobamos sesión con checkAuth() (consulta real al servidor) en
// vez de con el getCurrentUser() cacheado — si solo mirásemos la caché,
// alguien con sesión válida (cookie) pero sin caché en esta pestaña vería
// el aviso de "inicia sesión" de forma incorrecta.
async function selectSlot(slotId, slotDate, slotTime, btnEl) {
  if (slotDate === localTodayStr() && slotTime <= localNowHHMM()) {
    showToast("Esa hora ya ha pasado, elige otra", "error");
    loadSlots();
    return;
  }

  selectedSlotId = slotId;
  selectedSlotDate = slotDate;
  selectedSlotTime = slotTime;
  document.querySelectorAll(".slot-btn").forEach((b) => b.classList.remove("selected"));
  btnEl.classList.add("selected");

  const user = await checkAuth();
  if (!user) {
    formCard.style.display = "none";
    loginPromptCard.style.display = "block";
    loginPromptCard.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  loginPromptCard.style.display = "none";
  formCard.style.display = "block";
  if (bookingAsLabel) {
    bookingAsLabel.textContent = `Reservando como ${user.name} (${user.email})`;
  }

  formCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

bookingForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const user = await checkAuth();
  if (!user) {
    showToast("Tu sesión ha caducado. Inicia sesión de nuevo.", "error");
    window.location.href = "/login?return=" + encodeURIComponent("/");
    return;
  }

  if (!selectedSlotId) {
    showToast("Selecciona una hora primero", "error");
    return;
  }

  if (selectedSlotDate === localTodayStr() && selectedSlotTime <= localNowHHMM()) {
    showToast("Esa hora ya ha pasado, elige otra", "error");
    loadSlots();
    return;
  }

  if (!serviceSelect.value) {
    showToast("Selecciona un servicio", "error");
    return;
  }

  const payload = {
    slotId: selectedSlotId,
    notes: document.getElementById("notes").value.trim(),
    serviceId: serviceSelect.value,
  };

  const submitBtn = bookingForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  try {
    const res = await fetch("/api/bookings", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || "No se pudo completar la solicitud", "error");
      loadSlots();
      return;
    }

    showToast("¡Solicitud enviada! Te confirmaremos por email en cuanto se acepte.", "success");
    bookingForm.reset();
    formCard.style.display = "none";
    loadSlots();
  } catch (err) {
    console.error("Error creando reserva:", err);
    showToast("Error de conexión con el servidor", "error");
  } finally {
    submitBtn.disabled = false;
  }
});

dateInput.addEventListener("change", loadSlots);

loadSlots();
loadServices();
loadPaymentInfo();