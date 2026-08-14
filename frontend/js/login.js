// login.js — lógica de la página de login / registro

const tabLogin = document.getElementById("tabLogin");
const tabRegister = document.getElementById("tabRegister");
const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const toast = document.getElementById("toast");

function showToast(msg, type = "") {
  toast.textContent = msg;
  toast.className = "toast show " + type;
  setTimeout(() => {
    toast.className = "toast";
  }, 3500);
}

function getReturnTarget() {
  const params = new URLSearchParams(window.location.search);
  return params.get("return") || "/";
}

// Si ya hay una sesión válida (cookie), no tiene sentido quedarse en /login
(async function redirectIfLoggedIn() {
  const user = await checkAuth();
  if (user) window.location.href = getReturnTarget();
})();

tabLogin.addEventListener("click", () => {
  tabLogin.classList.add("active");
  tabRegister.classList.remove("active");
  loginForm.style.display = "block";
  registerForm.style.display = "none";
});

tabRegister.addEventListener("click", () => {
  tabRegister.classList.add("active");
  tabLogin.classList.remove("active");
  registerForm.style.display = "block";
  loginForm.style.display = "none";
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;

  const submitBtn = loginForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  try {
    await login(email, password);
    showToast("¡Bienvenido/a!", "success");
    window.location.href = getReturnTarget();
  } catch (err) {
    showToast(err.message || "No se pudo iniciar sesión", "error");
  } finally {
    submitBtn.disabled = false;
  }
});

registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("registerName").value.trim();
  const email = document.getElementById("registerEmail").value.trim();
  const phone = document.getElementById("registerPhone").value.trim();
  const password = document.getElementById("registerPassword").value;

  const submitBtn = registerForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  try {
    // El registro ya inicia sesión automáticamente (cookie de 7 días)
    await register({ name, email, phone, password });
    showToast("Cuenta creada. ¡Bienvenido/a!", "success");
    window.location.href = getReturnTarget();
  } catch (err) {
    showToast(err.message || "No se pudo crear la cuenta", "error");
  } finally {
    submitBtn.disabled = false;
  }
});