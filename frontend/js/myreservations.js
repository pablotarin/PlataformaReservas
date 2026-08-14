// myreservations.js — lógica de "Mis reservas"

const reservationsContainer = document.getElementById("reservationsContainer");
const toast = document.getElementById("toast");
const cancelModal = document.getElementById("cancelModal");
const cancelReason = document.getElementById("cancelReason");
const cancelModalClose = document.getElementById("cancelModalClose");
const cancelConfirm = document.getElementById("cancelConfirm");

let bookingToCancel = null;

function showToast(msg, type = "") {
  toast.textContent = msg;
  toast.className = "toast show " + type;
  setTimeout(() => {
    toast.className = "toast";
  }, 3500);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function statusBadge(status) {
  if (status === "pendiente") return '<span class="badge-pendiente">Pendiente de aceptar</span>';
  if (status === "reservado") return '<span class="badge-reservado">Confirmada</span>';
  if (status === "cancelada") return '<span class="badge-cancelada">Cancelada</span>';
  return "";
}

function isPastBooking(booking) {
  if (!booking.slot) return true;
  const today = new Date();
  const [year, month, day] = booking.slot.date.split("-").map(Number);
  const [hour, minute] = booking.slot.time.substring(0, 5).split(":").map(Number);
  const slotDate = new Date(year, month - 1, day, hour, minute);
  return slotDate <= today;
}

// Regla de negocio: el cliente solo puede cancelar hasta 1h antes de la cita.
function canCancelBooking(b) {
  if (b.status === "cancelada") return false;
  if (!b.slot) return false;
  const appointment = new Date(`${b.slot.date}T${b.slot.time.substring(0, 5)}:00`);
  const diff = appointment.getTime() - Date.now();
  return diff >= 60 * 60 * 1000;
}

function openCancelModal(bookingId) {
  bookingToCancel = bookingId;
  cancelReason.value = "";
  cancelModal.classList.add("show");
  setTimeout(() => cancelReason.focus(), 50);
}

function closeCancelModal() {
  bookingToCancel = null;
  cancelReason.value = "";
  cancelModal.classList.remove("show");
}

cancelModalClose.addEventListener("click", closeCancelModal);
cancelModal.addEventListener("click", (event) => {
  if (event.target === cancelModal) closeCancelModal();
});

async function cancelBooking() {
  if (!bookingToCancel) return;

  const reason = cancelReason.value.trim();
  if (!reason) {
    showToast("Debes indicar un motivo de cancelación", "error");
    cancelReason.focus();
    return;
  }

  cancelConfirm.disabled = true;
  cancelConfirm.textContent = "Cancelando...";

  try {
    const res = await fetch(`/api/users/me/bookings/${bookingToCancel}/cancel`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });

    const result = await res.json();

    if (!res.ok) {
      showToast(result.error || "No se pudo cancelar la reserva", "error");
      return;
    }

    closeCancelModal();
    showToast("Reserva cancelada correctamente", "success");
    await loadReservations();
  } catch (error) {
    console.error(error);
    showToast("Error al cancelar la reserva", "error");
  } finally {
    cancelConfirm.disabled = false;
    cancelConfirm.textContent = "Cancelar reserva";
  }
}

cancelConfirm.addEventListener("click", cancelBooking);

async function loadReservations() {
  // requireAuth() consulta al servidor (cookie httpOnly) y redirige a
  // /login?return=... si no hay sesión válida.
  const user = await requireAuth();
  if (!user) return;

  renderAccountBar("accountBar");

  try {
    const res = await fetch("/api/users/me/bookings", { credentials: "include" });
    const bookings = await res.json();

    if (!res.ok) {
      reservationsContainer.innerHTML = '<p class="empty-msg">No se pudieron cargar tus reservas.</p>';
      return;
    }

    if (!Array.isArray(bookings) || bookings.length === 0) {
      reservationsContainer.innerHTML =
        '<p class="empty-msg">Todavía no tienes ninguna reserva. <a href="/">Reserva tu primera cita</a>.</p>';
      return;
    }

    reservationsContainer.innerHTML = bookings
      .map((b) => {
        const slot = b.slot;
        const dateLabel = slot ? `${slot.date} a las ${slot.time}` : "Hueco no disponible";
        const status = b.status === "cancelada" ? "cancelada" : slot ? slot.status : "desconocido";

        let cancellationHtml = "";
        if (b.status === "cancelada") {
          cancellationHtml = `
            <div class="cancellation-info">
              <p><b>Motivo de cancelación:</b> ${escapeHtml(b.cancellationReason || "Sin motivo especificado")}</p>
              ${b.cancelledBy ? `<p><b>Cancelada por:</b> ${b.cancelledBy === "admin" ? "Administrador" : "Usuario"}</p>` : ""}
              ${b.cancelledAt ? `<p><b>Fecha de cancelación:</b> ${escapeHtml(new Date(b.cancelledAt).toLocaleString("es-ES"))}</p>` : ""}
            </div>
          `;
        }

        const showCancelBtn = canCancelBooking(b) && !isPastBooking(b);

        return `
          <div class="reservation-item">
            <div class="res-top">
              <span class="res-date">${escapeHtml(dateLabel)}</span>
              ${statusBadge(status)}
            </div>
            <p><b>Servicio:</b> ${b.service ? escapeHtml(b.service.name) : "Sin especificar"}</p>
            <p><b>Notas:</b> ${b.notes ? escapeHtml(b.notes) : "-"}</p>
            ${cancellationHtml}
            ${showCancelBtn ? `<button type="button" class="btn-cancel-booking" data-booking-id="${escapeHtml(b.id)}">Cancelar reserva</button>` : ""}
          </div>
        `;
      })
      .join("");

    document.querySelectorAll(".btn-cancel-booking").forEach((button) => {
      button.addEventListener("click", () => openCancelModal(button.dataset.bookingId));
    });
  } catch (err) {
    console.error(err);
    reservationsContainer.innerHTML = '<p class="empty-msg">Error al cargar tus reservas.</p>';
  }
}

loadReservations();