// auth.js
// Autenticación del usuario.
//
// La sesión NO se guarda en localStorage.
// El servidor la mantiene mediante una cookie HttpOnly de 7 días.
//
// El navegador envía automáticamente la cookie en las peticiones,
// pero JavaScript no puede leerla.

const AUTH_CACHE_KEY = "peluqueria_user_cache";

/**
 * Obtiene el usuario cacheado (solo para pintar la UI al instante).
 * IMPORTANTE: esto NO es una prueba de autenticación real. La autenticación
 * real la confirma siempre el servidor mediante /api/auth/me (checkAuth()).
 */
function getCurrentUser() {
  try {
    const raw = sessionStorage.getItem(AUTH_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setCurrentUser(user) {
  sessionStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(user));
}

function clearCurrentUser() {
  sessionStorage.removeItem(AUTH_CACHE_KEY);
}

/**
 * Comprueba contra el servidor si existe una sesión válida.
 */
async function checkAuth() {
  try {
    const response = await fetch("/api/auth/me", {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });

    if (response.status === 401) {
      clearCurrentUser();
      return null;
    }
    if (!response.ok) {
      throw new Error("Error comprobando sesión");
    }

    const data = await response.json();

    if (!data.authenticated || !data.user) {
      clearCurrentUser();
      return null;
    }

    setCurrentUser(data.user);
    return data.user;
  } catch (error) {
    console.error("Error comprobando autenticación:", error);
    return null;
  }
}

/**
 * Exige que exista una sesión. Si no la hay, redirige a /login?return=...
 */
async function requireAuth() {
  const user = await checkAuth();

  if (!user) {
    const returnUrl = window.location.pathname + window.location.search + window.location.hash;
    window.location.href = "/login?return=" + encodeURIComponent(returnUrl);
    return null;
  }

  return user;
}

async function login(email, password) {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "No se ha podido iniciar sesión");
  }
  if (data.user) setCurrentUser(data.user);
  return data;
}

async function register(userData) {
  const response = await fetch("/api/auth/register", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(userData),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "No se ha podido registrar");
  }
  if (data.user) setCurrentUser(data.user);
  return data;
}

async function logout() {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    console.error("Error cerrando sesión:", error);
  }
  clearCurrentUser();
  window.location.href = "/login";
}

/**
 * Pinta la barra de cuenta.
 */
async function renderAccountBar(elId) {
  const el = document.getElementById(elId);
  if (!el) return;

  const user = await checkAuth();

  if (user) {
    el.innerHTML = `
      <span>Hola, ${escapeHtmlAuth(user.name)}</span>
      <a href="/myreservations">Mis reservas</a>
      <button type="button" class="link-btn" id="logoutBtn">Cerrar sesión</button>
    `;
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) logoutBtn.addEventListener("click", logout);
    return;
  }

  el.innerHTML = `<a href="/login">Iniciar sesión</a>`;
}

function escapeHtmlAuth(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}