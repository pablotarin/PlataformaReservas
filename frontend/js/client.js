// client.js — lógica de la página pública de reservas

const dateInput = document.getElementById('date');
const slotsContainer = document.getElementById('slotsContainer');
const formCard = document.getElementById('formCard');
const bookingForm = document.getElementById('bookingForm');
const toast = document.getElementById('toast');
const serviceSelect = document.getElementById('service');
const pricesCard = document.getElementById('pricesCard');
const pricesTbody = document.getElementById('pricesTbody');
const paymentInfo = document.getElementById('paymentInfo');

let selectedSlotId = null;

// Fecha mínima seleccionable: hoy
const today = new Date().toISOString().slice(0, 10);
dateInput.min = today;
dateInput.value = today;

function showToast(msg, type = '') {
  toast.textContent = msg;
  toast.className = 'toast show ' + type;
  setTimeout(() => {
    toast.className = 'toast';
  }, 3500);
}

function formatTime(t) {
  return t;
}

// ---------------------------------------------------------------------------
// Precios y forma de pago
// ---------------------------------------------------------------------------
async function loadServices() {
  try {
    const res = await fetch('/api/public/services');
    const services = await res.json();

    if (Array.isArray(services) && services.length > 0) {
      pricesTbody.innerHTML = services
        .map((s) => `<tr><td>${escapeHtml(s.name)}</td><td class="price-col">${s.price.toFixed(2)} €</td></tr>`)
        .join('');
      pricesCard.style.display = 'block';

      serviceSelect.innerHTML = '<option value="">Sin especificar</option>' +
        services.map((s) => `<option value="${s.id}">${escapeHtml(s.name)} (${s.price.toFixed(2)} €)</option>`).join('');
    }
  } catch (err) {
    // Si falla, simplemente no mostramos la tabla de precios
  }
}

async function loadPaymentInfo() {
  try {
    const res = await fetch('/api/public/settings');
    const settings = await res.json();
    paymentInfo.textContent = settings.cardPaymentEnabled
      ? 'Formas de pago aceptadas: efectivo y tarjeta.'
      : 'Formas de pago aceptadas: solo efectivo.';
  } catch (err) {
    // silencioso
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Huecos disponibles
// ---------------------------------------------------------------------------
async function loadSlots() {
  const date = dateInput.value;
  selectedSlotId = null;
  formCard.style.display = 'none';
  slotsContainer.innerHTML = '<p class="empty-msg">Cargando...</p>';

  if (!date) return;

  try {
    const res = await fetch(`/api/public/slots?date=${date}`);
    const slots = await res.json();

    if (!Array.isArray(slots) || slots.length === 0) {
      slotsContainer.innerHTML = '<p class="empty-msg">No hay horas disponibles para este día. Prueba con otra fecha.</p>';
      return;
    }

    slotsContainer.innerHTML = '';
    slots.forEach((slot) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'slot-btn';
      btn.textContent = formatTime(slot.time);
      btn.addEventListener('click', () => selectSlot(slot.id, btn));
      slotsContainer.appendChild(btn);
    });
  } catch (err) {
    slotsContainer.innerHTML = '<p class="empty-msg">Error al cargar las horas disponibles.</p>';
  }
}

function selectSlot(slotId, btnEl) {
  selectedSlotId = slotId;
  document.querySelectorAll('.slot-btn').forEach((b) => b.classList.remove('selected'));
  btnEl.classList.add('selected');
  formCard.style.display = 'block';
  formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

bookingForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!selectedSlotId) {
    showToast('Selecciona una hora primero', 'error');
    return;
  }

  const email = document.getElementById('email').value.trim();
  if (!email) {
    showToast('El email es obligatorio', 'error');
    return;
  }

  const payload = {
    slotId: selectedSlotId,
    name: document.getElementById('name').value.trim(),
    phone: document.getElementById('phone').value.trim(),
    email,
    notes: document.getElementById('notes').value.trim(),
    serviceId: serviceSelect.value || null,
  };

  const submitBtn = bookingForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  try {
    const res = await fetch('/api/public/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'No se pudo completar la solicitud', 'error');
      submitBtn.disabled = false;
      // Si el hueco ya no está disponible, recargamos la lista
      loadSlots();
      return;
    }

    showToast('¡Solicitud enviada! Te confirmaremos por email en cuanto se acepte.', 'success');
    bookingForm.reset();
    formCard.style.display = 'none';
    loadSlots();
  } catch (err) {
    showToast('Error de conexión con el servidor', 'error');
  } finally {
    submitBtn.disabled = false;
  }
});

dateInput.addEventListener('change', loadSlots);

loadSlots();
loadServices();
loadPaymentInfo();
