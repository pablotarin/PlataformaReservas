// admin.js — lógica del panel de administración

const loginBox = document.getElementById('loginBox');
const panel = document.getElementById('panel');
const adminPasswordInput = document.getElementById('adminPassword');
const loginBtn = document.getElementById('loginBtn');
const toast = document.getElementById('toast');
const pendingBanner = document.getElementById('pendingBanner');

const genDate = document.getElementById('genDate');
const genStart = document.getElementById('genStart');
const genEnd = document.getElementById('genEnd');
const genDuration = document.getElementById('genDuration');
const generateBtn = document.getElementById('generateBtn');

const bookingModal = document.getElementById('bookingModal');
const bookingDetail = document.getElementById('bookingDetail');
const bookingStatusBadge = document.getElementById('bookingStatusBadge');
const closeModalBtn = document.getElementById('closeModalBtn');
const acceptBookingBtn = document.getElementById('acceptBookingBtn');
const rejectBookingBtn = document.getElementById('rejectBookingBtn');

const confirmModal = document.getElementById('confirmModal');
const confirmModalTitle = document.getElementById('confirmModalTitle');
const confirmModalMessage = document.getElementById('confirmModalMessage');
const confirmYesBtn = document.getElementById('confirmYesBtn');
const confirmNoBtn = document.getElementById('confirmNoBtn');

const serviceEditModal = document.getElementById('serviceEditModal');
const serviceEditName = document.getElementById('serviceEditName');
const serviceEditPrice = document.getElementById('serviceEditPrice');
const serviceEditSaveBtn = document.getElementById('serviceEditSaveBtn');
const serviceEditCancelBtn = document.getElementById('serviceEditCancelBtn');

const payCashOnly = document.getElementById('payCashOnly');
const payCashCard = document.getElementById('payCashCard');
const savePaymentBtn = document.getElementById('savePaymentBtn');

const servicesTbody = document.getElementById('servicesTbody');
const newServiceName = document.getElementById('newServiceName');
const newServicePrice = document.getElementById('newServicePrice');
const addServiceBtn = document.getElementById('addServiceBtn');

let calendar = null;
let currentBookingId = null;
let currentBookingStatus = null;

function showToast(msg, type = '') {
  toast.textContent = msg;
  toast.className = 'toast show ' + type;
  setTimeout(() => { toast.className = 'toast'; }, 3500);
}

function getPassword() {
  return sessionStorage.getItem('adminPassword') || '';
}

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-admin-password': getPassword(),
  };
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });
  if (res.status === 401) {
    sessionStorage.removeItem('adminPassword');
    showLogin();
    throw new Error('No autorizado');
  }
  return res;
}

// ---------------------------------------------------------------------------
// MODALES GENÉRICOS (sustituyen a confirm()/prompt() nativos del navegador)
// ---------------------------------------------------------------------------

// Modal de confirmación. Devuelve una promesa que resuelve a true/false
// según el botón que pulse el usuario.
function showConfirmModal(message, opts = {}) {
  return new Promise((resolve) => {
    confirmModalTitle.textContent = opts.title || 'Confirmar acción';
    confirmModalMessage.textContent = message;
    confirmYesBtn.textContent = opts.confirmText || 'Confirmar';
    confirmModal.classList.add('show');

    function cleanup(result) {
      confirmModal.classList.remove('show');
      confirmYesBtn.removeEventListener('click', onYes);
      confirmNoBtn.removeEventListener('click', onNo);
      resolve(result);
    }
    function onYes() { cleanup(true); }
    function onNo() { cleanup(false); }

    confirmYesBtn.addEventListener('click', onYes);
    confirmNoBtn.addEventListener('click', onNo);
  });
}

// Modal para editar nombre/precio de un servicio. Devuelve una promesa que
// resuelve a { name, price } si se guarda, o null si se cancela.
function showServiceEditModal(currentName, currentPrice) {
  return new Promise((resolve) => {
    serviceEditName.value = currentName;
    serviceEditPrice.value = currentPrice;
    serviceEditModal.classList.add('show');
    serviceEditName.focus();

    function cleanup(result) {
      serviceEditModal.classList.remove('show');
      serviceEditSaveBtn.removeEventListener('click', onSave);
      serviceEditCancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    }
    function onSave() {
      const name = serviceEditName.value.trim();
      const price = serviceEditPrice.value.trim();
      if (!name || !price) {
        showToast('Indica nombre y precio', 'error');
        return;
      }
      cleanup({ name, price });
    }
    function onCancel() { cleanup(null); }

    serviceEditSaveBtn.addEventListener('click', onSave);
    serviceEditCancelBtn.addEventListener('click', onCancel);
  });
}

// ---------------------------------------------------------------------------
// LOGIN
// ---------------------------------------------------------------------------
function showLogin() {
  loginBox.style.display = 'block';
  panel.style.display = 'none';
}

function showPanel() {
  loginBox.style.display = 'none';
  panel.style.display = 'block';
  if (!calendar) initCalendar();
  else calendar.refetchEvents();
  loadPaymentSettings();
  loadServices();
  refreshPendingBanner();
}

async function tryLogin(password) {
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const data = await res.json();
  if (res.ok && data.ok) {
    sessionStorage.setItem('adminPassword', password);
    showPanel();
  } else {
    showToast('Contraseña incorrecta', 'error');
  }
}

loginBtn.addEventListener('click', () => {
  const pw = adminPasswordInput.value;
  if (!pw) return;
  tryLogin(pw);
});

adminPasswordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loginBtn.click();
});

// Si ya había sesión guardada, comprobamos que siga siendo válida
(async function checkSession() {
  const pw = getPassword();
  if (!pw) { showLogin(); return; }
  try {
    const res = await fetch('/api/admin/bookings', { headers: { 'x-admin-password': pw } });
    if (res.ok) showPanel();
    else { sessionStorage.removeItem('adminPassword'); showLogin(); }
  } catch {
    showLogin();
  }
})();

// ---------------------------------------------------------------------------
// AVISO DE SOLICITUDES PENDIENTES
// ---------------------------------------------------------------------------
async function refreshPendingBanner() {
  try {
    const res = await apiFetch('/api/admin/bookings');
    const bookings = await res.json();
    const pending = bookings.filter((b) => b.slot && b.slot.status === 'pendiente');
    if (pending.length > 0) {
      pendingBanner.textContent = `Tienes ${pending.length} solicitud${pending.length > 1 ? 'es' : ''} de cita pendiente${pending.length > 1 ? 's' : ''} de aceptar (en amarillo en el calendario).`;
      pendingBanner.classList.add('show');
    } else {
      pendingBanner.classList.remove('show');
    }
  } catch (err) {
    if (err.message !== 'No autorizado') console.error(err);
  }
}

// ---------------------------------------------------------------------------
// GENERAR HUECOS
// ---------------------------------------------------------------------------
const todayStr = new Date().toISOString().slice(0, 10);
genDate.value = todayStr;
genDate.min = todayStr;

generateBtn.addEventListener('click', async () => {
  const date = genDate.value;
  const startTime = genStart.value;
  const endTime = genEnd.value;
  const duration = parseInt(genDuration.value, 10) || 30;

  if (!date || !startTime || !endTime) {
    showToast('Rellena fecha, hora de inicio y hora de fin', 'error');
    return;
  }
  if (startTime >= endTime) {
    showToast('La hora de inicio debe ser anterior a la de fin', 'error');
    return;
  }

  try {
    const res = await apiFetch('/api/admin/slots', {
      method: 'POST',
      body: JSON.stringify({ date, startTime, endTime, duration }),
    });
    const created = await res.json();
    if (!res.ok) {
      showToast(created.error || 'Error al generar huecos', 'error');
      return;
    }
    showToast(`Se han creado ${created.length} huecos nuevos`, 'success');
    calendar.refetchEvents();
  } catch (err) {
    if (err.message !== 'No autorizado') showToast('Error de conexión', 'error');
  }
});

// ---------------------------------------------------------------------------
// CALENDARIO (FullCalendar)
// ---------------------------------------------------------------------------
function initCalendar() {
  const calendarEl = document.getElementById('calendar');

  calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'timeGridWeek',
    locale: 'es',
    height: 'auto',
    slotMinTime: '08:00:00',
    slotMaxTime: '21:00:00',
    nowIndicator: true,
    selectable: true,
    selectMirror: true,
    // Evita que las citas se solapen visualmente: cada una ocupa su propia
    // franja, apiladas una debajo de otra.
    slotEventOverlap: false,
    eventOverlap: false,
    selectOverlap: false,
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'timeGridWeek,timeGridDay',
    },
    buttonText: { today: 'Hoy', week: 'Semana', day: 'Día' },

    // Cargar eventos (huecos) desde el backend según el rango visible
    events: async (info, successCallback, failureCallback) => {
      try {
        const from = info.startStr.slice(0, 10);
        const to = info.endStr.slice(0, 10);
        const res = await apiFetch(`/api/admin/slots?from=${from}&to=${to}`);
        const slots = await res.json();

        const events = slots.map((s) => {
          const start = `${s.date}T${s.time}:00`;
          const end = addMinutesToSlotTime(s.date, s.time, s.duration || 30);
          let title = 'Libre';
          if (s.status === 'pendiente') title = `Pendiente: ${s.booking ? s.booking.name : ''}`;
          if (s.status === 'reservado') title = `Confirmada: ${s.booking ? s.booking.name : ''}`;
          return {
            id: s.id,
            title,
            start,
            end,
            classNames: [`evt-${s.status}`],
            extendedProps: { slot: s },
          };
        });
        successCallback(events);
      } catch (err) {
        failureCallback(err);
      }
    },

    // Seleccionar un rango en el calendario -> crear un hueco libre
    select: async (selectionInfo) => {
      const date = selectionInfo.startStr.slice(0, 10);
      const time = selectionInfo.startStr.slice(11, 16);
      const durationMin = Math.round((selectionInfo.end - selectionInfo.start) / 60000) || 30;

      calendar.unselect();

      try {
        const res = await apiFetch('/api/admin/slots', {
          method: 'POST',
          body: JSON.stringify({ date, time, duration: durationMin }),
        });
        const created = await res.json();
        if (!res.ok) {
          showToast(created.error || 'Error al crear el hueco', 'error');
          return;
        }
        showToast('Hueco libre creado', 'success');
        calendar.refetchEvents();
      } catch (err) {
        if (err.message !== 'No autorizado') showToast('Error de conexión', 'error');
      }
    },

    // Clic en un evento existente
    eventClick: async (clickInfo) => {
      const slot = clickInfo.event.extendedProps.slot;

      if (slot.status === 'libre') {
        const confirmDelete = await showConfirmModal(`¿Eliminar el hueco libre de las ${slot.time}?`, { title: 'Eliminar hueco', confirmText: 'Eliminar' });
        if (!confirmDelete) return;
        try {
          const res = await apiFetch(`/api/admin/slots/${slot.id}`, { method: 'DELETE' });
          const data = await res.json();
          if (!res.ok) {
            showToast(data.error || 'No se pudo eliminar', 'error');
            return;
          }
          showToast('Hueco eliminado', 'success');
          calendar.refetchEvents();
        } catch (err) {
          if (err.message !== 'No autorizado') showToast('Error de conexión', 'error');
        }
      } else {
        openBookingModal(slot);
      }
    },
  });

  calendar.render();
}

function addMinutes(isoStart, minutes) {
  const d = new Date(isoStart);
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString().slice(0, 19);
}

// Calcula la hora de fin de un hueco a partir de su fecha/hora de inicio y su
// duración en minutos, trabajando siempre con texto plano (sin pasar por
// Date/toISOString) para evitar desplazamientos por zona horaria: FullCalendar
// interpreta las cadenas "YYYY-MM-DDTHH:MM:SS" (sin "Z") como hora local, así
// que el cálculo también debe hacerse en "hora local de reloj", sin
// conversiones UTC de por medio.
function addMinutesToSlotTime(dateStr, timeStr, minutes) {
  let [h, m] = timeStr.split(':').map(Number);
  m += minutes;
  while (m >= 60) {
    m -= 60;
    h += 1;
  }
  h = h % 24; // por si algún hueco cruzase la medianoche
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return `${dateStr}T${hh}:${mm}:00`;
}

// ---------------------------------------------------------------------------
// MODAL DE RESERVA (pendiente -> aceptar/rechazar; confirmada -> cancelar)
// ---------------------------------------------------------------------------
function openBookingModal(slot) {
  const b = slot.booking;
  currentBookingId = b ? b.id : null;
  currentBookingStatus = slot.status;

  bookingStatusBadge.innerHTML = slot.status === 'pendiente'
    ? '<span class="badge-pendiente">Pendiente de aceptar</span>'
    : '<span class="badge-reservado">Cita confirmada</span>';

  bookingDetail.innerHTML = `
    <p><b>Fecha:</b> ${slot.date} a las ${slot.time}</p>
    <p><b>Cliente:</b> ${b ? b.name : '-'}</p>
    <p><b>Teléfono:</b> ${b ? b.phone : '-'}</p>
    <p><b>Email:</b> ${b ? b.email : '-'}</p>
    <p><b>Servicio:</b> ${b && b.serviceName ? b.serviceName : '-'}</p>
    <p><b>Notas:</b> ${b && b.notes ? b.notes : '-'}</p>
  `;

  // Mostrar los botones adecuados según el estado
  if (slot.status === 'pendiente') {
    acceptBookingBtn.style.display = 'inline-block';
    rejectBookingBtn.style.display = 'inline-block';
    rejectBookingBtn.textContent = 'Rechazar';
  } else {
    acceptBookingBtn.style.display = 'none';
    rejectBookingBtn.style.display = 'inline-block';
    rejectBookingBtn.textContent = 'Cancelar cita';
  }

  bookingModal.classList.add('show');
}

closeModalBtn.addEventListener('click', () => {
  bookingModal.classList.remove('show');
  currentBookingId = null;
  currentBookingStatus = null;
});

acceptBookingBtn.addEventListener('click', async () => {
  if (!currentBookingId) return;
  try {
    const res = await apiFetch(`/api/admin/bookings/${currentBookingId}/accept`, { method: 'PUT' });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'No se pudo aceptar la cita', 'error');
      return;
    }
    showToast('Cita aceptada y confirmada', 'success');
    bookingModal.classList.remove('show');
    calendar.refetchEvents();
    refreshPendingBanner();
  } catch (err) {
    if (err.message !== 'No autorizado') showToast('Error de conexión', 'error');
  }
});

rejectBookingBtn.addEventListener('click', async () => {
  if (!currentBookingId) return;
  const msg = currentBookingStatus === 'pendiente'
    ? '¿Rechazar esta solicitud de cita? El hueco quedará libre de nuevo.'
    : '¿Seguro que quieres cancelar esta cita confirmada? El hueco quedará libre de nuevo.';
  const confirmAction = await showConfirmModal(msg, {
    title: currentBookingStatus === 'pendiente' ? 'Rechazar solicitud' : 'Cancelar cita',
    confirmText: currentBookingStatus === 'pendiente' ? 'Rechazar' : 'Cancelar cita',
  });
  if (!confirmAction) return;

  try {
    const res = await apiFetch(`/api/admin/bookings/${currentBookingId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'No se pudo completar la acción', 'error');
      return;
    }
    showToast(currentBookingStatus === 'pendiente' ? 'Solicitud rechazada' : 'Cita cancelada', 'success');
    bookingModal.classList.remove('show');
    calendar.refetchEvents();
    refreshPendingBanner();
  } catch (err) {
    if (err.message !== 'No autorizado') showToast('Error de conexión', 'error');
  }
});

// ---------------------------------------------------------------------------
// FORMAS DE PAGO
// ---------------------------------------------------------------------------
async function loadPaymentSettings() {
  try {
    const res = await apiFetch('/api/admin/settings');
    const settings = await res.json();
    if (settings.cardPaymentEnabled) {
      payCashCard.checked = true;
    } else {
      payCashOnly.checked = true;
    }
  } catch (err) {
    if (err.message !== 'No autorizado') console.error(err);
  }
}

savePaymentBtn.addEventListener('click', async () => {
  const cardPaymentEnabled = payCashCard.checked;
  try {
    const res = await apiFetch('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({ cardPaymentEnabled }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'No se pudo guardar', 'error');
      return;
    }
    showToast('Formas de pago actualizadas', 'success');
  } catch (err) {
    if (err.message !== 'No autorizado') showToast('Error de conexión', 'error');
  }
});

// ---------------------------------------------------------------------------
// PRECIOS / SERVICIOS
// ---------------------------------------------------------------------------
async function loadServices() {
  try {
    const res = await apiFetch('/api/admin/services');
    const services = await res.json();
    renderServices(services);
  } catch (err) {
    if (err.message !== 'No autorizado') console.error(err);
  }
}

function renderServices(services) {
  servicesTbody.innerHTML = '';
  if (services.length === 0) {
    servicesTbody.innerHTML = '<tr><td colspan="3" class="empty-msg">Todavía no hay servicios definidos.</td></tr>';
    return;
  }
  services.forEach((s) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(s.name)}</td>
      <td class="price-col">${s.price.toFixed(2)} €</td>
      <td class="actions-col">
        <button class="secondary" data-action="edit" data-id="${s.id}">Editar</button>
        <button class="danger" data-action="delete" data-id="${s.id}">Borrar</button>
      </td>
    `;
    servicesTbody.appendChild(tr);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

servicesTbody.addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;

  if (action === 'delete') {
    const confirmDelete = await showConfirmModal('¿Eliminar este servicio del listado de precios?', { title: 'Eliminar servicio', confirmText: 'Eliminar' });
    if (!confirmDelete) return;
    try {
      const res = await apiFetch(`/api/admin/services/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'No se pudo eliminar', 'error');
        return;
      }
      showToast('Servicio eliminado', 'success');
      loadServices();
    } catch (err) {
      if (err.message !== 'No autorizado') showToast('Error de conexión', 'error');
    }
  }

  if (action === 'edit') {
    const row = btn.closest('tr');
    const currentName = row.children[0].textContent;
    const currentPrice = row.children[1].textContent.replace('€', '').trim();

    const result = await showServiceEditModal(currentName, currentPrice);
    if (!result) return;
    const { name: newName, price: newPrice } = result;

    try {
      const res = await apiFetch(`/api/admin/services/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: newName, price: newPrice }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'No se pudo actualizar', 'error');
        return;
      }
      showToast('Servicio actualizado', 'success');
      loadServices();
    } catch (err) {
      if (err.message !== 'No autorizado') showToast('Error de conexión', 'error');
    }
  }
});

addServiceBtn.addEventListener('click', async () => {
  const name = newServiceName.value.trim();
  const price = newServicePrice.value.trim();

  if (!name || !price) {
    showToast('Indica nombre y precio del servicio', 'error');
    return;
  }

  try {
    const res = await apiFetch('/api/admin/services', {
      method: 'POST',
      body: JSON.stringify({ name, price }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'No se pudo añadir', 'error');
      return;
    }
    showToast('Servicio añadido', 'success');
    newServiceName.value = '';
    newServicePrice.value = '';
    loadServices();
  } catch (err) {
    if (err.message !== 'No autorizado') showToast('Error de conexión', 'error');
  }
});