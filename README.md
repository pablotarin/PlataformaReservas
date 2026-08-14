# App de reservas para peluquería

Aplicación web completa (backend + frontend) para gestionar reservas de una
peluquería, con datos guardados en una base de datos **PostgreSQL en
Supabase** (en la nube, gratis) y cuentas de cliente para ver "mis reservas".

## Estructura del proyecto

```
peluqueria-app/
├── backend/
│   ├── server.js         Servidor Express (API + sirve el frontend)
│   ├── supabase.js       Acceso a datos (Supabase / PostgreSQL)
│   ├── db/schema.sql     Esquema SQL a ejecutar en Supabase
│   ├── package.json
│   └── .env.example
└── frontend/
    ├── index.html          Página pública de reservas
    ├── login.html          Iniciar sesión / crear cuenta
    ├── myreservations.html "Mis reservas" del cliente
    ├── admin.html          Panel de administración con calendario
    ├── css/style.css
    └── js/
        ├── auth.js             sesión de usuario (compartido)
        ├── client.js
        ├── login.js
        ├── myreservations.js
        └── admin.js
```

## 1. Crear la base de datos en Supabase

1. Crea una cuenta gratis en [supabase.com](https://supabase.com) y un
   proyecto nuevo.
2. En el proyecto, ve a **SQL Editor -> New query**.
3. Copia y pega **todo** el contenido de `backend/db/schema.sql` y pulsa
   "Run". Esto crea las tablas `users`, `services`, `slots`, `bookings` y
   `settings`, con algunos servicios de ejemplo ya cargados. Es seguro
   volver a ejecutarlo si hace falta (no duplica ni borra datos).
4. Ve a **Project Settings -> API** y copia:
   - **Project URL** → `SUPABASE_URL`
   - **anon public key** → `SUPABASE_ANON_KEY`

## 2. Configurar el backend

```bash
cd peluqueria-app/backend
cp .env.example .env
```

Edita `.env`:

```
PORT=3000
ADMIN_PASSWORD=pon-aqui-tu-contraseña
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_ANON_KEY=tu-anon-key-publica
```

## 3. Arrancar

```bash
npm install
npm start
```

```
✅ Servidor de la peluquería arrancado
   Web clientes:  http://localhost:3000/
   Panel admin:   http://localhost:3000/admin
   Password admin (por defecto): admin123
```

- **Clientes:** http://localhost:3000/
- **Login / registro:** http://localhost:3000/login
- **Mis reservas:** http://localhost:3000/myreservations
- **Administrador:** http://localhost:3000/admin (solo accesible conociendo
  esta URL directamente; no hay ningún enlace desde la web de clientes)

## Cómo funciona

### Cuentas de cliente
- Un cliente necesita **crear una cuenta** (nombre, email, teléfono,
  contraseña) para poder reservar. Las contraseñas se guardan siempre
  **hasheadas** (nunca en texto plano) usando `scrypt`.
- Tras iniciar sesión, sus datos se precargan al reservar y cada solicitud
  de cita queda **ligada a su cuenta**.
- En **"Mis reservas"** ve todas sus citas (pendientes y confirmadas) con su
  estado. El backend comprueba que el email de la cuenta coincide antes de
  devolver ese listado, para que no cualquiera pueda consultar las reservas
  de otro usuario solo adivinando su id.
- La sesión se guarda en el navegador (`localStorage`); es una base
  sencilla sin JWT — para producción real convendría añadir tokens de
  sesión con expiración.

### Horas pasadas
Nunca se puede reservar una hora que ya ha pasado:
- El listado público de huecos libres (`GET /api/public/slots`) excluye
  automáticamente, para el día de hoy, las horas anteriores a la hora
  actual del servidor.
- Al crear la reserva (`POST /api/public/bookings`) se vuelve a comprobar
  en el servidor, por si la lista llevaba un rato cargada en el navegador.
- El propio frontend hace una comprobación adicional en el momento de
  seleccionar la hora, para avisar al instante sin esperar al servidor.

### Para el cliente (`/`)
1. Ve el listado de precios y la forma de pago aceptada.
2. Elige fecha y hora (solo se muestran huecos libres y futuros).
3. Si no ha iniciado sesión, se le pide que lo haga antes de completar la
   reserva.
4. La cita queda como **solicitud pendiente** hasta que el administrador la
   acepta.

### Para el administrador (`/admin`)
1. Entra con la contraseña.
2. **Generar huecos rápido** por rango horario, o crearlos a mano
   arrastrando en el calendario.
3. **Calendario visual**, sin solapes: 🔵 libre · 🟡 pendiente de aceptar ·
   🟢 confirmada. Clicando cada hueco se puede eliminar / aceptar / rechazar
   / cancelar, todo mediante **modales propios** (no hay `alert`/`confirm`/
   `prompt` nativos del navegador en ningún sitio de la app).
4. **Formas de pago** (solo efectivo / efectivo y tarjeta) y **listado de
   precios** por tipo de corte, ambos visibles también para el cliente.

## Notas técnicas / siguientes pasos

- **Seguridad de la contraseña de admin:** sigue siendo una única
  contraseña compartida por cabecera HTTP; para un uso real conviene JWT o
  sesiones con expiración, igual que con las cuentas de cliente.
- **Row Level Security de Supabase:** el backend accede con la clave
  `anon` pero siempre desde el servidor Node (nunca desde el navegador), así
  que no es imprescindible activar RLS. El `schema.sql` incluye, comentadas,
  las políticas por si prefieres activarlo igualmente.
- **Notificaciones:** enviar email/SMS de confirmación al aceptar una cita.
- **Múltiples peluqueros/sillas:** añadir un campo "profesional" a los
  huecos para gestionar varias agendas en paralelo.
- **Despliegue:** el backend es una app Node/Express estándar (Render,
  Railway, un VPS...); Supabase ya está en la nube, así que no hace falta
  gestionar servidor de base de datos aparte.
