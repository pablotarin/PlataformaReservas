# App de reservas para peluquería

Aplicación web completa (backend + frontend) para gestionar reservas de una
peluquería. Pensada como **punto de partida funcional**: arranca en un solo
comando y ya puedes probar el flujo completo (cliente reserva, admin gestiona
horarios).

## Estructura del proyecto

```
peluqueria-app/
├── backend/            Servidor Express (API + sirve el frontend)
│   ├── server.js
│   ├── db.js           Almacenamiento en fichero JSON (sin BD externa)
│   ├── package.json
│   └── data/db.json    Se genera solo al arrancar
└── frontend/
    ├── index.html      Página pública de reservas (para clientes)
    ├── admin.html       Panel de administración con calendario
    ├── css/style.css
    └── js/
        ├── client.js
        └── admin.js
```

## Cómo arrancar

Necesitas [Node.js](https://nodejs.org) instalado (v18 o superior).

```bash
cd peluqueria-app/backend
npm install
npm start
```

Verás algo así:

```
✅ Servidor de la peluquería arrancado
   Web clientes:  http://localhost:3000/
   Panel admin:   http://localhost:3000/admin
   Password admin (por defecto): admin123
```

- **Clientes:** abre http://localhost:3000/
- **Administrador:** abre http://localhost:3000/admin (contraseña por defecto `admin123`)

## Configuración

Copia `backend/.env.example` a `backend/.env` y cambia la contraseña de admin:

```
PORT=3000
ADMIN_PASSWORD=pon-aqui-tu-contraseña
```

## Cómo funciona

### Para el cliente (`/`)
1. Ve el listado de precios y la forma de pago aceptada (los define el admin).
2. Elige una fecha.
3. Ve las horas libres de ese día (solo se muestran las que el admin ha
   marcado como disponibles y que nadie ha solicitado todavía).
4. Rellena nombre, teléfono, **email (obligatorio)** y opcionalmente
   servicio/notas, y **solicita** la cita.
5. La cita queda como **solicitud pendiente**: no se confirma hasta que el
   administrador la acepta desde el panel.

Importante: la web de clientes y el panel de administrador **no tienen
ningún enlace entre sí**. Solo se puede entrar a `/admin` conociendo esa URL
directamente.

### Para el administrador (`/admin`)
1. Entra con la contraseña (accede solo quien conoce el link `/admin`).
2. **Generar huecos rápido:** elige un día, un rango horario (ej. 9:00–14:00)
   y la duración de cada cita (ej. 30 min), y se crean automáticamente todas
   las franjas.
3. **Calendario visual:** las citas se apilan una debajo de otra sin
   solaparse nunca. Se puede:
   - **Arrastrar/seleccionar** directamente sobre el calendario para crear un
     hueco suelto.
   - **Clicar un hueco libre** (verde) para eliminarlo.
   - **Clicar una solicitud pendiente** (amarillo) para ver los datos del
     cliente y **aceptarla** (pasa a confirmada, rojo) o **rechazarla**
     (el hueco vuelve a quedar libre).
   - **Clicar una cita confirmada** (rojo) para ver los datos y, si hace
     falta, cancelarla (el hueco vuelve a quedar libre).
4. Un aviso en la parte superior del panel indica cuántas solicitudes están
   pendientes de aceptar.
5. **Formas de pago:** elige si solo aceptas efectivo o también tarjeta;
   esto se muestra automáticamente en la web de clientes.
6. **Precios:** gestiona el listado de servicios/tipos de corte con su
   precio; también se muestra en la web de clientes y el cliente puede
   elegir uno al reservar (opcional).

## Notas técnicas / siguientes pasos

Esta es una base funcional, pensada para arrancar rápido y no necesitar
instalar una base de datos. Algunas mejoras naturales si quieres llevarlo a
producción:

- **Base de datos real:** sustituir `backend/db.js` (actualmente un JSON en
  disco) por SQLite/Postgres. El resto del backend no necesita cambios,
  solo reimplementar `readData`/`writeData`.
- **Autenticación admin más robusta:** ahora mismo es una contraseña única
  compartida (vía cabecera HTTP). Se podría pasar a JWT + usuarios.
- **Notificaciones:** enviar email/SMS de confirmación al reservar.
- **Servicios/duración variable:** añadir tipos de servicio (corte, tinte,
  etc.) con distinta duración cada uno.
- **Múltiples peluqueros/sillas:** añadir un campo "profesional" a los huecos
  para gestionar varias agendas en paralelo.
- **Despliegue:** el backend es una app Node/Express estándar, se puede
  desplegar en cualquier proveedor (Render, Railway, un VPS, etc.).
