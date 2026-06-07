/* ===================================================================
   app.js - GymPRO Frontend
   Vanilla JS SPA - Google Apps Script backend
   -------------------------------------------------------------------
    1.  CONFIG
    2.  CACHE
    3.  API CLIENT
    4.  ROLE PERMISSIONS
    5.  AUTH / LOGIN
    6.  NAVBAR SETUP
    7.  ROUTER
    8.  INITIALIZATION
    9.  VISTA: PERFIL
   10.  VISTA: ABONOS
   11.  VISTA: PERSONAS
   12.  VISTA: ASISTENCIA
   13.  VISTA: ADMIN
   14.  ACCIONES ADMIN: PAGO / NUEVA PERSONA / DEUDA MENSUAL
   15.  ACCIONES TABLA:  CONSUMO / SALDAR ACTIVIDAD
   16.  MODAL HELPER
   17.  UTILIDADES
=================================================================== */

/* =========================
   1. CONFIG
========================= */
const API_URL =
  "https://script.google.com/macros/s/AKfycbwdD5iMI01C32X1e5SEX3sc-pEwn7WTFvKVhJ0cwW6ULXHOwHZG7oqVXoVl3dNtfNHnyA/exec";
const API_KEY = "GYM_PRO_2026";

/*
 * Columnas reales:
 *   Personas : IDAsistencia | Fecha | Usuario | Documento | Mail | Direccion | Actividad
 *   Abonos   : IDCarga | Fecha y hora | TipoMovimiento | Persona | Servicio | Suplemento | monto
 *   Servicios: IDServicios | Nombre | Hora inicio | Hora fin | Precios
 *   Suplementos: IDSuplemento | Nombre | Marca | Precio
 *
 *   Abonos.Persona  = IDAsistencia  (ej: "Persona0001")
 *   Abonos.Servicio = IDServicios   (ej: "Servicio0001") cuando aplica
 *   Abonos.monto    = negativo para deudas/consumos, positivo para pagos
 */

let currentUser = null;
let currentRole = null;
let syncPendingChanges = 0;
let syncLastSuccessAt = Date.now();
let syncHasError = false;
let currentMovimientosVisible = [];

/* =========================
   2. CACHE
========================= */
const cache = {
  personas: null,
  abonos: null,
  movimientos: null,
  servicios: null,
  suplementos: null,
  asistencias: null,
  usuarios: null,
  clear() {
    this.personas =
      this.abonos =
      this.movimientos =
      this.servicios =
      this.suplementos =
      this.asistencias =
        null;
  },
};

function getMovimientosContables() {
  return cache.movimientos || [];
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function getMovimientoMonto(m) {
  const monto = parseFloat(m?.Monto ?? m?.monto ?? 0);
  return isNaN(monto) ? 0 : monto;
}

function getMovimientoFecha(m) {
  return String(m?.Fecha || "").split("T")[0];
}

function formatFechaLocal(valor) {
  const fecha = String(valor || "").split("T")[0];
  const [yyyy, mm, dd] = fecha.split("-");
  return yyyy && mm && dd ? `${dd}/${mm}/${yyyy}` : fecha || "-";
}

function getMovimientoTipo(m) {
  return String(
    m?.Tipo || m?.tipo || m?.TipoMovimiento || m?.tipoMovimiento || "",
  )
    .trim()
    .toLowerCase();
}

function isMovimientoPago(m) {
  return getMovimientoMonto(m) > 0 || getMovimientoTipo(m).includes("pago");
}

function isMovimientoConsumo(m) {
  return (
    getMovimientoMonto(m) < 0 ||
    getMovimientoTipo(m).includes("consumo") ||
    getMovimientoTipo(m).includes("deuda")
  );
}

function getClienteId(p) {
  return String(p?.IDCliente || p?.IDAsistencia || "").trim();
}

function getMovementClientId(m) {
  return String(m?.IDCliente ?? m?.Persona ?? "").trim();
}

function getMovementActivityId(m) {
  return String(m?.IDActividad ?? m?.Servicio ?? "").trim();
}

function getMovementSupplementId(m) {
  return String(m?.IDSuplemento ?? m?.Suplemento ?? "").trim();
}

function getDashboardMetrics() {
  const now = new Date();
  const hoy = localDateString(now);
  const mes = hoy.slice(0, 7);
  const hace60 = new Date(now);
  hace60.setDate(hace60.getDate() - 60);
  const hace60Str = localDateString(hace60);
  const movimientos = getMovimientosContables();
  const clientes = cache.personas || [];
  const inscripciones = cache.inscripciones || [];
  const saldosPorCliente = {};
  let cobradoHoy = 0;
  let cobradoMes = 0;
  let pagosMes = 0;
  let pagosTotales = 0;
  let consumosHoy = 0;
  let consumosMes = 0;
  let consumosTotales = 0;
  const movimientosRecientes = new Set();

  movimientos.forEach((m) => {
    const pid = getMovementClientId(m);
    const monto = getMovimientoMonto(m);
    const abs = Math.abs(monto);
    const fecha = getMovimientoFecha(m);
    if (pid) saldosPorCliente[pid] = (saldosPorCliente[pid] || 0) + monto;
    if (pid && fecha >= hace60Str) movimientosRecientes.add(pid);
    if (monto > 0) {
      pagosTotales += monto;
      if (fecha === hoy) cobradoHoy += monto;
      if (fecha.slice(0, 7) === mes) {
        cobradoMes += monto;
        pagosMes++;
      }
    } else if (monto < 0) {
      consumosTotales += abs;
      if (fecha === hoy) consumosHoy += abs;
      if (fecha.slice(0, 7) === mes) consumosMes += abs;
    }
  });

  const clientesActivosBase = clientes.filter((p) => {
    const estado = String(p.Estado || p.estado || "")
      .trim()
      .toUpperCase();
    return estado !== "INACTIVO" && estado !== "BAJA";
  });
  const clientesConActividad = new Set(
    inscripciones
      .filter((i) => String(i.Estado).toUpperCase() === "ACTIVO")
      .map((i) => String(i.IDCliente || "").trim())
      .filter(Boolean),
  );
  const clientesActivosReales = clientesActivosBase.filter((p) => {
    const pid = getClienteId(p);
    return clientesConActividad.has(pid) || movimientosRecientes.has(pid);
  });
  const deudasPendientes = clientesActivosBase.map((p) =>
    Math.abs(Math.min(saldosPorCliente[getClienteId(p)] || 0, 0)),
  );
  const clientesConDeuda = deudasPendientes.filter((deuda) => deuda > 0).length;
  const totalAdeudado = deudasPendientes.reduce((s, deuda) => s + deuda, 0);

  return {
    hoy,
    mes,
    movimientos,
    clientes: clientesActivosBase,
    clientesActivosReales,
    saldosPorCliente,
    totalClientes: clientesActivosBase.length,
    clientesConDeuda,
    totalAdeudado,
    cobradoHoy,
    cobradoMes,
    consumosHoy,
    consumosMes,
    consumosTotales,
    pagosTotales,
    deudaNeta: Math.max(consumosTotales - pagosTotales, 0),
    ingresosNetosMes: cobradoMes - consumosMes,
    morosidad: clientesActivosBase.length
      ? (clientesConDeuda / clientesActivosBase.length) * 100
      : 0,
    deudaPromedio: clientesConDeuda ? totalAdeudado / clientesConDeuda : 0,
    ticketPromedio: pagosMes ? cobradoMes / pagosMes : 0,
  };
}

function syncMovimientosFromAbonos() {
  cache.movimientos = [...(cache.abonos || [])];
  console.log("Movimientos:", cache.movimientos.length);
  console.log("Abonos:", (cache.abonos || []).length);
}

function addMovimientoLocal(movimiento, options = {}) {
  if (!cache.abonos) cache.abonos = [];
  if (!cache.movimientos) syncMovimientosFromAbonos();

  if (options.unshift) {
    cache.abonos.unshift(movimiento);
    cache.movimientos.unshift(movimiento);
  } else {
    cache.abonos.push(movimiento);
    cache.movimientos.push(movimiento);
  }

  console.log("Movimientos:", cache.movimientos.length);
  console.log("Abonos:", cache.abonos.length);
}

function removeMovimientoLocal(idMovimiento) {
  const id = String(idMovimiento || "");
  if (!id) return;
  cache.abonos = (cache.abonos || []).filter(
    (a) => String(a.IDMovimiento ?? a.IDCarga ?? "") !== id,
  );
  cache.movimientos = (cache.movimientos || []).filter(
    (a) => String(a.IDMovimiento ?? a.IDCarga ?? "") !== id,
  );
}

function refreshFinancialUI(idCliente = null, nombre = "") {
  renderPersonas();
  if (canAccessAdmin()) renderAdmin();
  if (
    document.getElementById("cajaView") &&
    !document.getElementById("cajaView").classList.contains("hidden")
  )
    renderCaja();
  if (canViewAbonos()) renderAbonos();
  if (
    idCliente &&
    estadoCuentaActivo.idCliente &&
    String(estadoCuentaActivo.idCliente) === String(idCliente)
  ) {
    if (estadoCuentaActivo.vista === "movimientos") {
      openEstadoCuentaModal(idCliente);
      renderEstadoCuentaMovimientos(
        idCliente,
        nombre || estadoCuentaActivo.nombre,
      );
    } else {
      openEstadoCuentaModal(idCliente);
    }
  }
}

function beginSyncChange(count = 1) {
  syncPendingChanges += count;
  syncHasError = false;
  updateSyncStatusDisplay();
}

function finishSyncChange(success = true, count = 1) {
  syncPendingChanges = Math.max(0, syncPendingChanges - count);
  syncHasError = !success;
  if (success && syncPendingChanges === 0) syncLastSuccessAt = Date.now();
  updateSyncStatusDisplay();
}

function setAbonosLocal(abonos) {
  cache.abonos = abonos || [];
  syncMovimientosFromAbonos();
}

/* =========================
   3. API CLIENT
========================= */
async function apiGet(action, params = {}) {
  const url = new URL(API_URL);
  url.searchParams.set("action", action);
  url.searchParams.set("key", API_KEY);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  });
  const res = await fetch(url.toString());
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "Error GET " + action);
  return json.data;
}

async function apiPost(action, data = {}) {
  const res = await fetch(API_URL, {
    method: "POST",
    body: JSON.stringify({ action, key: API_KEY, ...data }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "Error POST " + action);
  return json.data;
}

async function withLoader(fn) {
  showLoader(true);
  try {
    return await fn();
  } catch (e) {
    console.error("[API]", e);
    showErrorModal("Error", "Error: " + e.message);
    return null;
  } finally {
    showLoader(false);
  }
}

/* =========================
   4. ROLE PERMISSIONS
========================= */
const isAdminRole = () => currentRole === "ADMIN";
const isProfesorRole = () => currentRole === "PROFESOR";
const canViewMovimientos = () => isAdminRole();
const canViewAbonos = canViewMovimientos;
const canViewPersonas = () => isAdminRole() || isProfesorRole();
const canAccessAdmin = () => isAdminRole();
const canViewCaja = () => isAdminRole();
const canRegisterConsumo = () => isAdminRole() || isProfesorRole();
const canRegisterPago = () => isAdminRole() || isProfesorRole();
const canRegisterAsistencia = () => isAdminRole() || isProfesorRole();
const canSaldarActividad = () => isAdminRole() || isProfesorRole();
const canAgregarPersona = () => isAdminRole() || isProfesorRole();

function displayRole(role) {
  return String(role || "")
    .trim()
    .toUpperCase();
}

function updateActiveUserBadge() {
  const badge = document.getElementById("activeUserBadge");
  if (!badge) return;

  const rol = displayRole(currentRole);
  const idUsuario = String(currentUser?.IDUsuario || "").trim();
  const mostrar =
    currentUser && idUsuario && (rol === "ADMIN" || rol === "PROFESOR");

  badge.classList.toggle("hidden", !mostrar);
  badge.classList.remove("active-user-admin", "active-user-profesor");

  if (!mostrar) return;

  document.getElementById("activeUserRole").textContent = rol;
  document.getElementById("activeUserId").textContent = idUsuario;
  badge.classList.add(
    rol === "ADMIN" ? "active-user-admin" : "active-user-profesor",
  );
}

/* =========================
   5. AUTH / LOGIN
========================= */
function goToLoginChoice() {
  showOnlyView("loginChoiceView");
}

async function ensureClientesCache() {
  if (!cache.personas || cache.personas.length === 0) {
    cache.personas = (await apiGet("getClientes")) || [];
  }
  return cache.personas || [];
}

async function buscarClientePorDni(dni) {
  const documento = String(dni || "").trim();
  if (!documento) return null;
  const personas = await ensureClientesCache();
  return (
    personas.find((p) => String(p.Documento || "").trim() === documento) || null
  );
}

async function handleLoginCliente(e) {
  if (e) e.preventDefault();

  const dni = document.getElementById("clienteDniInput").value.trim();
  if (!dni) return showErrorModal("DNI requerido", "Ingresá DNI");

  let cliente = null;
  try {
    cliente = await buscarClientePorDni(dni);
  } catch (err) {
    console.error(err);
    showErrorModal("Error", "Error cargando clientes");
    return;
  }

  if (!cliente) {
    showErrorModal("DNI no encontrado", "DNI no encontrado");
    return;
  }

  currentUser = cliente;
  currentRole = "CLIENTE";

  setupNavbar();
  renderProfile();
  enterApp("perfilView");

  (async () => {
    try {
      const data = await apiGet("getFullDataByDocumento", { documento: dni });
      if (data) {
        setAbonosLocal(data.abonos || []);
        cache.asistencias = data.asistencias || [];
        renderProfile();
      }
    } catch (e) {
      console.error(e);
    }
  })();
}

function resetAsistenciaPublica() {
  const dniInput = document.getElementById("asistenciaPublicaDni");
  const msgEl = document.getElementById("asistenciaPublicaMsg");
  const descEl = document.querySelector("#asistenciaPublicaView .section-desc");
  if (dniInput) dniInput.value = "";
  if (msgEl) {
    msgEl.className = "hidden";
    msgEl.textContent = "";
    msgEl.style.opacity = "1";
  }
  if (descEl) descEl.textContent = "AGUARDANDO DNI...";
}

function playAsistenciaTerminalSound(freq, type) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);

  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start();
  osc.stop(ctx.currentTime + 0.3);
}

function renderTerminalDniNoEncontrado(msgEl) {
  msgEl.className = `asistencia-bienvenida res-danger`;
  msgEl.innerHTML = `
        <div class="bienvenida-content">
            <h1>DNI NO ENCONTRADO</h1>
        </div>
    `;
  msgEl.classList.remove("hidden");
}

function resetTerminalAsistencia(dniInput, msgEl, descEl, delayMs) {
  setTimeout(() => {
    msgEl.style.opacity = "0";
    msgEl.style.transition = "opacity 0.25s ease";

    setTimeout(() => {
      msgEl.classList.add("hidden");
      msgEl.style.opacity = "1";

      dniInput.value = "";
      dniInput.disabled = false;
      dniInput.focus();

      if (descEl) descEl.textContent = "AGUARDANDO DNI...";
    }, 250);
  }, delayMs);
}

function renderTerminalAcceso(cliente, msgEl) {
  const pidCliente = getClienteId(cliente);
  const asistenciasCliente = (cache.asistencias || [])
    .filter((a) => String(a.IDCliente || "").trim() === pidCliente)
    .sort((a, b) =>
      `${a.Fecha || ""} ${a.Hora || ""}`.localeCompare(
        `${b.Fecha || ""} ${b.Hora || ""}`,
      ),
    );
  const ultimaAsistencia = asistenciasCliente[asistenciasCliente.length - 1];
  const ultimaAsistenciaText = ultimaAsistencia
    ? `${formatFechaLocal(ultimaAsistencia.Fecha)} ${formatHoraMovimiento(ultimaAsistencia.Hora)}`
    : "Sin asistencias registradas";
  const actividadActiva = (cache.inscripciones || []).find(
    (i) =>
      String(i.IDCliente || "").trim() === pidCliente &&
      String(i.Estado || "").toUpperCase() === "ACTIVO",
  );
  const actividadText = actividadActiva
    ? getNombreActividad(actividadActiva.Actividad)
    : "";
  const suplementosPendientes = Object.values(
    getMovimientosContables()
      .filter(
        (m) =>
          getMovementClientId(m) === pidCliente && getMovementSupplementId(m),
      )
      .reduce((acc, m) => {
        const sid = getMovementSupplementId(m);
        if (!acc[sid]) acc[sid] = { id: sid, saldo: 0 };
        acc[sid].saldo += getMovimientoMonto(m);
        return acc;
      }, {}),
  )
    .filter((s) => s.saldo < 0)
    .slice(0, 3);

  const abonosCliente = (cache.abonos || []).filter(
    (a) => String(a.IDCliente) === String(cliente.IDCliente),
  );

  const saldoTotal = abonosCliente.reduce(
    (s, a) => s + (parseFloat(a.Monto ?? a.monto ?? 0) || 0),
    0,
  );

  let statusText = "DEUDA AL DIA";
  let cls = "res-success";

  if (saldoTotal < 0) {
    statusText = `DEUDA: ${formatMonto(saldoTotal)}`;
    cls = "res-danger";
  } else if (saldoTotal > 0) {
    statusText = `SALDO A FAVOR: ${formatMonto(saldoTotal)}`;
    cls = "res-info";
  }

  const now = new Date();
  const fecha = now
    .toLocaleDateString("es-AR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    })
    .toUpperCase();
  const hora = now.toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  msgEl.className = `asistencia-bienvenida ${cls}`;
  msgEl.innerHTML = `
        <div class="bienvenida-content">
            <h1>${escHtml(cliente.Nombre.toUpperCase())}</h1>
            <h2 class="status-badge">${statusText}</h2>
            <div class="terminal-extra">
                <p><strong>Ultima asistencia:</strong> ${escHtml(ultimaAsistenciaText)}</p>
                <p><strong>Asistencias totales:</strong> ${asistenciasCliente.length}</p>
                ${actividadText ? `<p><strong>Actividad:</strong> ${escHtml(actividadText)}</p>` : ""}
                ${
                  suplementosPendientes.length
                    ? `
                    <div class="terminal-pending-list">
                        <strong>Suplementos pendientes:</strong>
                        ${suplementosPendientes.map((s) => `<span>${escHtml(getNombreConcepto("", s.id))}</span>`).join("")}
                    </div>
                `
                    : ""
                }
            </div>
            <div class="welcome-footer">
                <p>${fecha} | ${hora}</p>
            </div>
        </div>
    `;
  msgEl.classList.remove("hidden");
  return now;
}

function guardarAsistenciaTerminalLocal(cliente, now) {
  if (!cache.asistencias) cache.asistencias = [];

  const pad = (n) => String(n).padStart(2, "0");

  cache.asistencias.push({
    IDAsistencia: "ASI-" + Date.now(),
    IDCliente: cliente.IDCliente || cliente.IDAsistencia || "",
    Fecha: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    Hora: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
  });
}

async function handleRegistrarAsistenciaPublica(e) {
  if (e) e.preventDefault();

  const dniInput = document.getElementById("asistenciaPublicaDni");
  const msgEl = document.getElementById("asistenciaPublicaMsg");
  const descEl = document.querySelector("#asistenciaPublicaView .section-desc");
  const dni = dniInput ? dniInput.value.trim() : "";

  if (!dni || dniInput.disabled) return;
  msgEl.classList.add("hidden");
  msgEl.style.opacity = "1";
  dniInput.disabled = true;

  let cliente = null;
  try {
    cliente = await buscarClientePorDni(dni);
  } catch (err) {
    console.error(err);
    playAsistenciaTerminalSound(220, "square");
    renderTerminalDniNoEncontrado(msgEl);
    resetTerminalAsistencia(dniInput, msgEl, descEl, 1500);
    return;
  }

  if (!cliente) {
    playAsistenciaTerminalSound(220, "square");
    renderTerminalDniNoEncontrado(msgEl);
    resetTerminalAsistencia(dniInput, msgEl, descEl, 1500);
    return;
  }

  const now = renderTerminalAcceso(cliente, msgEl);
  playAsistenciaTerminalSound(880, "sine");
  guardarAsistenciaTerminalLocal(cliente, now);
  apiPost("registrarAsistencia", { IDCliente: cliente.IDCliente });
  resetTerminalAsistencia(dniInput, msgEl, descEl, 2500);
}

/**
 * Carga los datos pesados (abonos, asistencias, etc.) sin bloquear la UI.
 */
async function fetchBackgroundData(dni) {
  try {
    const data = await apiGet("getFullDataByDocumento", { documento: dni });
    if (data) {
      if (Array.isArray(data.abonos)) {
        const nuevos = data.abonos;

        const resto = (cache.abonos || []).filter(
          (a) =>
            !nuevos.some(
              (n) =>
                String(n.IDCliente || n.Persona) ===
                String(a.IDCliente || a.Persona),
            ),
        );

        setAbonosLocal([...resto, ...nuevos]);
      }
      cache.asistencias = data.asistencias || [];
      cache.actividades = data.actividades || [];
      cache.suplementos = data.suplementos || [];
      cache.inscripciones = data.inscripciones || [];

      // Refrescar la vista de perfil para mostrar la nueva data cargada
      renderProfile();
    }
  } catch (e) {
    console.error("Error cargando datos en segundo plano:", e);
  }
}

/* -- STAFF -- */
/* -- STAFF (Login Local y Pantalla Asistencia Reparada) -- */

async function handleLoginStaff(e) {
  if (e) e.preventDefault();

  const claveInput = document.getElementById("staffClaveInput");
  const clave = claveInput ? claveInput.value.trim() : "";
  const errorEl = document.getElementById("loginStaffError");
  if (errorEl) errorEl.classList.add("hidden");

  //  ASEGURA USUARIOS EN CACHE (PRIMER LOGIN)
  if (!cache.usuarios || cache.usuarios.length === 0) {
    try {
      cache.usuarios = (await apiGet("getUsuarios")) || [];
    } catch (e) {
      console.error(e);
      if (errorEl) {
        errorEl.textContent = "Error cargando usuarios";
        errorEl.classList.remove("hidden");
      }
      return;
    }
  }

  //  LOGIN DESDE SHEET (NO MAS HARDCODE)
  const user = (cache.usuarios || []).find(
    (u) =>
      String(u.Clave || "") === clave &&
      String(u.Activo).toUpperCase() === "TRUE",
  );

  if (!user) {
    if (errorEl) {
      errorEl.textContent = "Clave no autorizada";
      errorEl.classList.remove("hidden");
    }
    return;
  }

  currentRole = displayRole(user.Rol);
  currentUser = {
    Nombre: currentRole,
    Mail: "",
    IDUsuario: String(user.IDUsuario || "").trim(),
  };

  //  ENTRADA INMEDIATA
  setupNavbar();

  if (currentRole === "ADMIN") {
    renderAdmin();
    enterApp("adminPanelView");
  } else {
    renderPersonas();
    enterApp("personasView");
  }

  //  CARGA EN SEGUNDO PLANO
  (async () => {
    try {
      const [pers, abos, acts, sups, users, asis, insc] = await Promise.all([
        apiGet("getClientes"),
        apiGet("getMovimientos"),
        apiGet("getActividades"),
        apiGet("getSuplementos"),
        apiGet("getUsuarios"),
        apiGet("getAsistencia"),
        apiGet("getInscripciones"),
      ]);

      cache.personas = pers || [];
      setAbonosLocal(abos || []);
      cache.servicios = acts || [];
      cache.actividades = acts || [];
      cache.suplementos = sups || [];
      cache.usuarios = users || [];
      cache.asistencias = asis || [];
      cache.inscripciones = insc || []; //  FIX

      renderPersonas();
      if (canAccessAdmin()) renderAdmin();
      if (
        document.getElementById("cajaView") &&
        !document.getElementById("cajaView").classList.contains("hidden")
      )
        renderCaja();
    } catch (e) {
      console.error(e);
    }
  })();
}

/**
 * Registra asistencia rapida utilizando loginCliente (validacion ligera).
 */
async function handleRegistrarAsistencia(e) {
  if (e) e.preventDefault();
  if (!canRegisterAsistencia()) return;

  const dniInput = document.getElementById("asistenciaDni");
  const msgEl = document.getElementById("asistenciaMsg");
  const descEl = document.querySelector(".asistencia-card-large .section-desc");
  const dni = dniInput ? dniInput.value.trim() : "";

  if (!dni || dniInput.disabled) return;
  //  LIMPIA ESTADO ANTERIOR
  msgEl.classList.add("hidden");
  msgEl.style.opacity = "1";

  dniInput.disabled = true;

  //  CLIENTE LOCAL (INSTANTANEO)
  const cliente = (cache.personas || []).find(
    (p) => String(p.Documento || "").trim() === dni,
  );

  if (!cliente) {
    playAsistenciaTerminalSound(220, "square");
    renderTerminalDniNoEncontrado(msgEl);

    resetTerminalAsistencia(dniInput, msgEl, descEl, 1500);
    return;
  }

  //  UI INSTANTANEA REAL
  const now = renderTerminalAcceso(cliente, msgEl);
  playAsistenciaTerminalSound(880, "sine");

  //  BACKEND EN SEGUNDO PLANO (NO BLOQUEA)
  //  GUARDAR EN CACHE INSTANTANEO
  guardarAsistenciaTerminalLocal(cliente, now);

  //  BACKEND EN SEGUNDO PLANO
  //apiPost('registrarAsistencia', {
  //    IDCliente: cliente.IDCliente || cliente.IDAsistencia || ''
  //});

  //  BACKEND
  apiPost("registrarAsistencia", { IDCliente: cliente.IDCliente });

  // reset UI
  resetTerminalAsistencia(dniInput, msgEl, descEl, 2500);
}

/**
 * Muestra el mensaje gigante de asistencia.
 */
function showAsistenciaMsg(el, title, sub, cls) {
  el.className = `asistencia-result-large ${cls}`;
  el.innerHTML = `
        <div style="transform: translateY(-20px)">
            <h1 style="text-shadow: 0 10px 30px rgba(0,0,0,0.2)">${escHtml(title)}</h1>
            <p>${escHtml(sub)}</p>
        </div>
    `;
  el.classList.remove("hidden");
}

/**
 * Resetea la pantalla de asistencia despues de 2 segundos.
 */
function startAsistenciaReset(input, msg) {
  input.value = "";
  // Reducimos a 2 segundos exactos para agilidad
  setTimeout(() => {
    msg.style.opacity = "0"; // Efecto fade out
    msg.style.transition = "opacity 0.3s ease";

    setTimeout(() => {
      msg.classList.add("hidden");
      msg.style.opacity = "1";
      input.focus();
    }, 300);
  }, 2000);
}

// Mejora UX: Si el usuario hace click afuera, el foco vuelve al input automaticamente
document.addEventListener("click", () => {
  const publicView = document.getElementById("asistenciaPublicaView");
  if (publicView && !publicView.classList.contains("hidden")) {
    document.getElementById("asistenciaPublicaDni")?.focus();
    return;
  }

  const input = document.getElementById("asistenciaDni");
  const view = document.getElementById("asistenciaView");
  if (view && !view.classList.contains("hidden")) {
    input.focus();
  }
});

//async function postLogin(userObj) {
//    await apiPost('registrarLogin', {
//        idLog: 'LOG-' + Date.now(),
//        documento: userObj.Documento || '',
//        usuario: userObj.Usuario || userObj.Mail
//    });
//}

function enterApp(viewId) {
  document.getElementById("mainHeader").classList.remove("hidden");
  showView(viewId);
}

/* =========================
   6. NAVBAR SETUP
========================= */
function setupNavbar() {
  ["btnAbonos", "btnPersonas", "btnAsistencia", "btnCaja", "btnAdmin"].forEach(
    (id) => document.getElementById(id).classList.add("hidden"),
  );
  if (canViewAbonos())
    document.getElementById("btnAbonos").classList.remove("hidden");
  if (canViewPersonas())
    document.getElementById("btnPersonas").classList.remove("hidden");
  if (canRegisterAsistencia())
    document.getElementById("btnAsistencia").classList.remove("hidden");
  if (canViewCaja())
    document.getElementById("btnCaja").classList.remove("hidden");
  if (canAccessAdmin())
    document.getElementById("btnAdmin").classList.remove("hidden");
  document
    .getElementById("btnNewAbono")
    .classList.toggle("hidden", !(canViewMovimientos() && canRegisterPago()));

  const nombre =
    currentUser.Nombre || currentUser.Usuario || currentUser.Mail || "Usuario";
  document.getElementById("userNameDisplay").textContent = nombre;
  document.getElementById("userMailDisplay").textContent =
    currentUser.Mail || "";
  document.getElementById("userRoleBadge").textContent =
    displayRole(currentRole);
  document.getElementById("userAvatar").textContent = nombre
    .charAt(0)
    .toUpperCase();
  updateActiveUserBadge();
}

/* =========================
   7. ROUTER
========================= */
const ROUTE_GUARDS = {
  perfilView: () => true,
  abonosView: canViewAbonos,
  personasView: canViewPersonas,
  asistenciaView: canRegisterAsistencia,
  cajaView: canViewCaja,
  adminPanelView: canAccessAdmin,
  accessDeniedView: () => true,
};

function showView(viewId) {
  const guard = ROUTE_GUARDS[viewId];
  if (guard && !guard()) {
    showOnlyView("accessDeniedView");
    return;
  }
  showOnlyView(viewId);
}
function showOnlyView(viewId) {
  const guard = ROUTE_GUARDS[viewId];
  if (guard && !guard() && viewId !== "accessDeniedView") {
    viewId = "accessDeniedView";
  }
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  const t = document.getElementById(viewId);
  if (t) t.classList.remove("hidden");
}

/* =========================
   8. INITIALIZATION
========================= */
document.addEventListener("DOMContentLoaded", () => {
  /* Inicializar tema */
  const savedTheme = localStorage.getItem("gymTheme") || "dark";
  document.documentElement.setAttribute("data-theme", savedTheme);

  const btnTheme = document.getElementById("btnTheme");
  if (btnTheme) {
    btnTheme.textContent = savedTheme === "dark" ? "🌙" : "☀️";
  }

  /* Login choice */
  document
    .getElementById("btnChoiceAlumno")
    .addEventListener("click", () => showOnlyView("loginClienteView"));
  document
    .getElementById("btnChoiceStaff")
    .addEventListener("click", () => showOnlyView("loginStaffView"));
  document
    .getElementById("btnChoiceAsistenciaPublica")
    .addEventListener("click", () => {
      resetAsistenciaPublica();
      showOnlyView("asistenciaPublicaView");
      setTimeout(
        () => document.getElementById("asistenciaPublicaDni")?.focus(),
        0,
      );
    });
  document
    .getElementById("btnBackFromCliente")
    .addEventListener("click", goToLoginChoice);
  document
    .getElementById("btnBackFromStaff")
    .addEventListener("click", goToLoginChoice);
  document
    .getElementById("btnBackFromAsistenciaPublica")
    .addEventListener("click", goToLoginChoice);
  document
    .getElementById("loginClienteForm")
    .addEventListener("submit", handleLoginCliente);
  document
    .getElementById("loginStaffForm")
    .addEventListener("submit", handleLoginStaff);
  document
    .getElementById("asistenciaPublicaForm")
    .addEventListener("submit", handleRegistrarAsistenciaPublica);

  /* Logout (CORREGIDO) */
  document.getElementById("btnLogout").addEventListener("click", () => {
    //  Limpiar sesion
    currentUser = null;
    currentRole = null;
    updateActiveUserBadge();

    //  Limpiar cache SIN reasignar
    if (cache) {
      setAbonosLocal([]);
      cache.asistencias = [];
      cache.actividades = [];
      cache.suplementos = [];
      cache.inscripciones = [];
      //cache.personas = [];
      cache.usuarios = [];
    }

    //  Limpiar inputs
    const dInput = document.getElementById("clienteDniInput");
    const eInput = document.getElementById("staffClaveInput");
    if (dInput) dInput.value = "";
    if (eInput) eInput.value = "";

    //  Reset UI
    document.getElementById("mainHeader").classList.add("hidden");

    //  Bloquear acceso visual (opcional pero util)
    document.querySelectorAll("[data-view]").forEach((btn) => {
      btn.classList.remove("active");
    });

    //  Volver al inicio SIEMPRE
    enterApp("loginChoiceView");
  });

  /* Navegacion */
  document.getElementById("btnPerfil").addEventListener("click", () => {
    //  BLOQUEO REAL
    if (!currentUser) {
      enterApp("loginChoiceView");
      return;
    }

    renderProfile();
    showView("perfilView");
  });

  document.getElementById("btnAbonos").addEventListener("click", () => {
    if (!canViewAbonos()) return;

    fillClienteAbonosFilter(); //  cargar clientes

    filterAbonos();
    showView("abonosView");
  });

  document.getElementById("btnPersonas").addEventListener("click", () => {
    if (!canViewPersonas()) return;
    filterPersonas();
    showView("personasView");
  });

  document.getElementById("btnAsistencia").addEventListener("click", () => {
    if (!canRegisterAsistencia()) return;
    resetAsistencia();
    showView("asistenciaView");
  });

  document.getElementById("btnCaja").addEventListener("click", () => {
    if (!canViewCaja()) return;
    renderCaja();
    showView("cajaView");
  });

  document.getElementById("btnAdmin").addEventListener("click", () => {
    if (!canAccessAdmin()) return;
    renderAdmin();
    showView("adminPanelView");
  });

  /* Busqueda y filtros */
  document
    .getElementById("searchPersonas")
    .addEventListener("input", filterPersonas);
  document
    .getElementById("saldoFilter")
    .addEventListener("change", filterPersonas);

  document
    .getElementById("searchAbonos")
    .addEventListener("input", filterAbonos);
  document
    .getElementById("tipoAbonosFilter")
    .addEventListener("change", filterAbonos);
  document
    .getElementById("ordenAbonosFilter")
    .addEventListener("change", filterAbonos);
  document
    .getElementById("clienteAbonosFilter")
    .addEventListener("change", filterAbonos);
  document
    .getElementById("fechaDesde")
    .addEventListener("change", filterAbonos);
  document
    .getElementById("fechaHasta")
    .addEventListener("change", filterAbonos);
  document
    .getElementById("btnExportExcel")
    .addEventListener("click", exportMovimientosExcel);
  document
    .getElementById("btnExportCsv")
    .addEventListener("click", exportMovimientosCsv);
  document
    .getElementById("cajaPeriodoFilter")
    .addEventListener("change", renderCaja);
  document.getElementById("cajaDesde").addEventListener("change", renderCaja);
  document.getElementById("cajaHasta").addEventListener("change", renderCaja);

  /* Asistencia */
  document
    .getElementById("asistenciaForm")
    .addEventListener("submit", handleRegistrarAsistencia);

  /* Admin */
  document
    .getElementById("btnNewAbono")
    .addEventListener("click", openPagoModal);
  document
    .getElementById("btnGenDeudas")
    .addEventListener("click", handleGenerarDeudas);
  document
    .getElementById("btnAddUser")
    .addEventListener("click", openNuevaPersonaModal);
  document
    .getElementById("btnDemoData")
    .addEventListener("click", generarDatosDemo);
  document
    .getElementById("btnClearDemoData")
    .addEventListener("click", limpiarDatosDemo);

  /* Modal */
  document
    .getElementById("btnModalClose")
    .addEventListener("click", closeModal);

  /* ===== FULLSCREEN ===== */
  const btnFs = document.getElementById("btnFullscreen");

  if (btnFs) {
    btnFs.addEventListener("click", () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
      } else {
        document.exitFullscreen();
      }
    });
  }

  /* ESC para salir */
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.fullscreenElement) {
      document.exitFullscreen();
    }
  });
  updateSyncStatusDisplay();
  setInterval(updateSyncStatusDisplay, 15000);

  //  PRECARGA TOTAL (BIEN HECHA)
  (async () => {
    //  BLOQUEAR UI HASTA CARGA COMPLETA
    //document.body.style.opacity = 0;

    try {
      const [
        personas,
        abonos,
        usuarios,
        asistencias,
        inscripciones,
        actividades,
      ] = await Promise.all([
        apiGet("getClientes"),
        apiGet("getMovimientos"),
        apiGet("getUsuarios"),
        apiGet("getAsistencia"),
        apiGet("getInscripciones"),
        apiGet("getActividades"),
      ]);

      cache.personas = personas || [];
      setAbonosLocal(abonos || []);
      cache.usuarios = usuarios || [];
      cache.asistencias = asistencias || [];
      cache.inscripciones = inscripciones || [];
      cache.servicios = actividades || [];

      //  UN SOLO RENDER
      renderPersonas();
      if (canAccessAdmin()) renderAdmin();
      if (
        document.getElementById("cajaView") &&
        !document.getElementById("cajaView").classList.contains("hidden")
      )
        renderCaja();

      //  MOSTRAR UI YA LISTA
      //document.body.style.opacity = 1;
    } catch (e) {
      console.error(e);
      //document.body.style.opacity = 1;
    }
  })();
});

/* =========================
   9. VISTA: PERFIL
========================= */
function renderProfile() {
  //  PROTECCION DE SESION
  if (!currentUser) return enterApp("loginChoiceView");

  document.getElementById("userActivityDisplay").textContent =
    currentUser.Actividad || "Ninguna";

  const saldoStat = document.getElementById("saldoStat");
  const movCard = document.getElementById("movimientosCard");
  const asisCard = document.getElementById("asistenciasCard");

  if (currentRole === "PROFESOR") {
    saldoStat.classList.add("hidden");
    movCard.classList.add("hidden");
    if (asisCard) asisCard.classList.add("hidden");
    return;
  }

  saldoStat.classList.remove("hidden");
  movCard.classList.remove("hidden");
  if (asisCard) asisCard.classList.remove("hidden");

  const pid = String(
    currentUser.IDCliente ||
      currentUser.idcliente ||
      currentUser.IDAsistencia ||
      "",
  ).trim();

  //  ABONOS (ROBUSTO)
  const misAbonos = (cache.abonos || []).filter(
    (a) => String(a.IDCliente ?? a.Persona ?? "").trim() === pid,
  );

  const saldo = misAbonos.reduce(
    (s, a) => s + (parseFloat(a.Monto ?? a.monto ?? 0) || 0),
    0,
  );

  const balEl = document.getElementById("userBalanceDisplay");
  balEl.textContent = formatMonto(saldo);
  balEl.className = saldo >= 0 ? "balance-positive" : "balance-negative";

  const tbody = document.querySelector("#userMovementsTable tbody");

  tbody.innerHTML = misAbonos.length
    ? [...misAbonos]
        .reverse()
        .map(
          (a) => `
            <tr>
                <td>${formatFechaHora(a["Fecha y hora"] || a.Fecha)}</td>
                <td>${escHtml(getNombreConcepto(a.Servicio, a.Suplemento))}</td>
                <td class="${parseFloat(a.Monto ?? a.monto ?? 0) < 0 ? "balance-negative" : "balance-positive"}">
                    ${formatMonto(parseFloat(a.Monto ?? a.monto ?? 0))}
                </td>
            </tr>`,
        )
        .join("")
    : '<tr><td colspan="3" class="empty-row">Sin movimientos registrados</td></tr>';

  const asisTbody = document.querySelector("#userAsistenciasTable tbody");

  if (asisTbody) {
    const misAsistencias = (cache.asistencias || [])
      .filter((a) => String(a.IDCliente ?? "").trim() === pid)
      .sort((a, b) => {
        function fix(x) {
          let f = String(x.Fecha || "");
          let h = String(x.Hora || "");

          //  formato viejo (1/3/2026)
          if (f.includes("/")) {
            let [d, m, y] = f.split("/");
            f = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
          }

          return `${f} ${h}`;
        }

        return fix(b).localeCompare(fix(a)); //  ORDEN CORRECTO
      })
      .slice(0, 5);

    asisTbody.innerHTML = misAsistencias.length
      ? misAsistencias
          .map(
            (a) =>
              `<tr><td>${formatFechaHora(getFechaAsistencia(a))}</td></tr>`,
          )
          .join("")
      : '<tr><td class="empty-row">Sin asistencias registradas</td></tr>';
  }
}

/* =========================
   10. VISTA: ABONOS
========================= */
function renderAbonos(lista = null) {
  if (!canViewAbonos()) {
    showView("accessDeniedView");
    return;
  }

  const tbody = document.querySelector("#abonosTable tbody");

  let data = lista || cache.abonos || [];

  if (!lista) {
    data = [...data].reverse();
  }
  currentMovimientosVisible = [...data];

  tbody.innerHTML = data.length
    ? data
        .map((a) => {
          const id = escHtml(a.IDMovimiento || "-");

          //  LIMPIEZA FECHA
          let fecha = String(a.Fecha || "");
          if (fecha.includes("T")) {
            fecha = fecha.split("T")[0];
          }

          //  LIMPIEZA HORA (maneja ISO y caso 1899)
          let hora = String(a.Hora || "").trim();

          if (hora.includes("T")) {
            // caso ISO completo
            hora = hora.split("T")[1].split(".")[0];
          } else if (hora.includes("1899")) {
            // caso Excel
            const d = new Date(a.Hora);
            const hh = String(d.getHours()).padStart(2, "0");
            const mm = String(d.getMinutes()).padStart(2, "0");
            const ss = String(d.getSeconds()).padStart(2, "0");
            hora = `${hh}:${mm}:${ss}`;
          }

          const fechaHora = fecha ? `${fecha} ${hora}`.trim() : "";

          const persona = escHtml(getNombrePersona(a.IDCliente));

          const concepto = escHtml(
            getNombreConcepto(a.IDActividad, a.IDSuplemento),
          );

          const monto = Number(a.Monto || 0);

          return `
        <tr>
            <td class="mono">${id}</td>
            <td>${formatFechaHora(fechaHora)}</td>
            <td class="mono">${persona}</td>
            <td>${concepto} (${a.Tipo || ""})</td>
            <td class="${monto < 0 ? "balance-negative" : "balance-positive"}">
                ${formatMonto(monto)}
            </td>
        </tr>
    `;
        })
        .join("")
    : '<tr><td colspan="5" class="empty-row">Sin movimientos</td></tr>';
}

function filterAbonos() {
  const q = document.getElementById("searchAbonos").value.toLowerCase();
  const type = document.getElementById("tipoAbonosFilter").value;
  const order = document.getElementById("ordenAbonosFilter").value;
  const cliente = document.getElementById("clienteAbonosFilter").value;
  const desde = document.getElementById("fechaDesde").value;
  const hasta = document.getElementById("fechaHasta").value;

  let lista = [...(cache.abonos || [])];

  if (type === "actividad") {
    lista = lista.filter((a) => !!a.IDActividad);
  } else if (type === "suplementos") {
    lista = lista.filter((a) => !!a.IDSuplemento);
  }

  if (q) {
    lista = lista.filter((a) => {
      const nomPer = getNombrePersona(a.IDCliente).toLowerCase();
      const nomCon = getNombreConcepto(
        a.IDActividad,
        a.IDSuplemento,
      ).toLowerCase();
      return nomPer.includes(q) || nomCon.includes(q);
    });
  }

  if (cliente) {
    lista = lista.filter((a) => String(a.IDCliente) === String(cliente));
  }

  if (desde || hasta) {
    lista = lista.filter((a) => {
      const f = `${a.Fecha}`; // YYYY-MM-DD

      if (!f) return false;

      if (desde && f < desde) return false;
      if (hasta && f > hasta) return false;

      return true;
    });
  }

  lista.sort((a, b) => {
    const d1 = new Date(`${a.Fecha} ${a.Hora}`);
    const d2 = new Date(`${b.Fecha} ${b.Hora}`);
    return order === "recientes" ? d2 - d1 : d1 - d2;
  });

  renderAbonos(lista);
}

function getMovimientoExportRows(
  lista = currentMovimientosVisible,
  options = {},
) {
  return (lista || []).map((m) => ({
    Fecha: getMovimientoFecha(m),
    Hora: formatHoraMovimiento(m.Hora),
    Cliente: getNombrePersona(getMovementClientId(m)),
    Concepto: getNombreConcepto(
      getMovementActivityId(m),
      getMovementSupplementId(m),
    ),
    Tipo: String(m.Tipo || m.tipo || m.TipoMovimiento || ""),
    Monto: options.montoNumerico
      ? getMovimientoMonto(m)
      : formatMonto(getMovimientoMonto(m)),
  }));
}

function downloadBlob(filename, content, mime) {
  const blob =
    content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportMovimientosCsv() {
  if (!canViewMovimientos()) {
    showView("accessDeniedView");
    return;
  }
  const rows = getMovimientoExportRows();
  const headers = ["Fecha", "Hora", "Cliente", "Concepto", "Tipo", "Monto"];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [
    headers.join(";"),
    ...rows.map((r) => headers.map((h) => esc(r[h])).join(";")),
  ].join("\r\n");
  downloadBlob(
    `Movimientos_${localDateString()}.csv`,
    "\ufeff" + csv,
    "text/csv;charset=utf-8",
  );
}

function exportMovimientosExcel() {
  if (!canViewMovimientos()) {
    showView("accessDeniedView");
    return;
  }
  if (!window.XLSX) {
    showErrorModal(
      "Exportar Excel",
      "No se pudo cargar la libreria de exportacion.",
    );
    return;
  }

  const rows = getMovimientoExportRows(currentMovimientosVisible, {
    montoNumerico: true,
  });
  const headers = ["Fecha", "Hora", "Cliente", "Concepto", "Tipo", "Monto"];
  const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
  ws["!cols"] = [
    { wch: 12 },
    { wch: 10 },
    { wch: 28 },
    { wch: 32 },
    { wch: 14 },
    { wch: 14 },
  ];
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Movimientos");
  XLSX.writeFile(wb, `Movimientos_${localDateString()}.xlsx`);
}

/* =========================
   11. VISTA: PERSONAS
========================= */

function renderPersonas(lista = null) {
  if (!currentUser) return enterApp("loginChoiceView");
  if (!canViewPersonas()) {
    showView("accessDeniedView");
    return;
  }
  const data = lista || cache.personas || [];
  const tbody = document.querySelector("#personasTable tbody");
  const headerTr = document.querySelector("#personasTableHeaders");
  const actividades = cache.servicios || [];
  // 1. DIBUJAR CABECERAS DINAMICAMENTE (th identicos a las td)
  if (headerTr) {
    let ths = `<th>Documento</th><th>Nombre</th><th class="saldo-total-head">Saldo Total</th>`;
    actividades.forEach((a) => {
      ths += `<th>${escHtml(a.Nombre)}</th>`;
    });
    ths += `<th>Acciones</th>`;
    headerTr.innerHTML = ths;
  }
  // 2. DIBUJAR FILAS
  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="${5 + actividades.length}" class="empty-row">Sin personas registradas</td></tr>`;
    return;
  }
  tbody.innerHTML = data
    .map((p) => {
      const pid = String(p.IDCliente || p.IDAsistencia || "").trim();
      const usu = escHtml(p.Nombre || p.Usuario || "");
      const dni = escHtml(String(p.Documento || ""));
      // MAPEO DE ACTIVIDADES ACTIVAS
      const insc = (cache.inscripciones || []).filter(
        (i) =>
          String(i.IDCliente) === pid &&
          String(i.Estado).toUpperCase() === "ACTIVO",
      );
      const actText = insc.length
        ? insc.map((i) => getNombreActividad(i.Actividad)).join(", ")
        : "-";
      // COLUMNAS DE SALDOS (Match exacto 1:1)
      const saldosMap = getSaldosPorActividad(pid);
      let saldoTotal = 0;

      const columnasSaldosHtml = actividades
        .map((s) => {
          const idAct = String(s.IDActividad || s.IDServicios);

          //  ver si esta inscripto
          const estaInscripto = (cache.inscripciones || []).some(
            (i) =>
              String(i.IDCliente) === pid &&
              String(i.Actividad) === idAct &&
              String(i.Estado).toUpperCase() === "ACTIVO",
          );

          //  saldo
          let val = saldosMap[idAct];

          if (val === undefined) {
            const serv = (cache.servicios || []).find(
              (s) => String(s.IDActividad || s.IDServicios) === idAct,
            );

            if (serv) {
              val = -Math.abs(parseFloat(serv.Precios || serv.Precio || 0));
            } else {
              val = 0;
            }
          }

          if (!estaInscripto) {
            return `<td style="opacity:0.2;">-</td>`;
          }

          saldoTotal += val;

          let color = "";
          if (val < 0) color = "color:#ff6b6b;";
          else if (val > 0) color = "color:#4cd137;";
          else color = "color:#4cd137;";

          const saldoActividadTexto = val === 0 ? "Al dia" : formatMonto(val);

          return `
                <td class="actividad-saldo-cell">
                    <span class="actividad-check">

                    <span style="${color} margin-left:6px;">
                        ${saldoActividadTexto}
                    </span>

                    ${
                      val < 0
                        ? `
                        <button 
                            class="btn-item btn-item-warn btn-saldar-mini"
                            onclick="saldarActividad('${pid}','${idAct}')"
                        >Saldar</button>
                    `
                        : ""
                    }
                </td>
            `;
        })
        .join("");

      const saldoActividades = saldoTotal;
      const saldoSuplementos = (cache.abonos || []).reduce((sum, a) => {
        const aPid = String(a.IDCliente ?? a.Persona ?? "").trim();
        const idSup = String(a.IDSuplemento ?? a.Suplemento ?? "").trim();
        if (aPid !== pid || !idSup) return sum;

        const monto = parseFloat(a.Monto ?? a.monto ?? 0);
        return sum + (isNaN(monto) ? 0 : monto);
      }, 0);

      saldoTotal = saldoActividades + saldoSuplementos;

      const detalleSaldo = (valor) => `
            <span class="${valor < 0 ? "saldo-total-detail-deuda" : valor > 0 ? "saldo-total-detail-favor" : "saldo-total-detail-cero"}">
                ${formatMonto(Math.abs(valor))}
            </span>
        `;

      let saldoTotalHtml = "";
      if (saldoTotal < 0) {
        saldoTotalHtml = `
                <span class="saldo-total-pill saldo-total-deuda"> ${formatMonto(Math.abs(saldoTotal))}</span>
                <span class="saldo-total-detail">Actividades: ${detalleSaldo(saldoActividades)}</span>
                <span class="saldo-total-detail">Suplementos: ${detalleSaldo(saldoSuplementos)}</span>
            `;
      } else if (saldoTotal > 0) {
        saldoTotalHtml = `
                <span class="saldo-total-pill saldo-total-favor"> ${formatMonto(saldoTotal)}</span>
                <span class="saldo-total-detail">Actividades: ${detalleSaldo(saldoActividades)}</span>
                <span class="saldo-total-detail">Suplementos: ${detalleSaldo(saldoSuplementos)}</span>
            `;
      } else {
        saldoTotalHtml = `
                <span class="saldo-total-pill saldo-total-favor"> Al dia</span>
                <span class="saldo-total-detail">Actividades: ${detalleSaldo(saldoActividades)}</span>
                <span class="saldo-total-detail">Suplementos: ${detalleSaldo(saldoSuplementos)}</span>
            `;
      }

      // BOTONES CON SANITIZACION PARA COMILLAS EN JS INLINE
      const strUsu = p.Nombre || p.Usuario || "";
      const btnEscapado = strUsu.replace(/'/g, "\\'");

      const btnConsumo = canRegisterConsumo()
        ? `<button class="btn-item" onclick="openConsumoModal('${btnEscapado}','${pid}')">Consumo</button>`
        : "";
      //const btnSaldar = canSaldarActividad() ? `<button class="btn-item btn-item-warn" onclick="saldarActividad('${pid}','')">Saldar</button>` : '';
      const btnAsistencia = canRegisterAsistencia()
        ? `<button class="btn-item btn-item-info" onclick="verUltimaAsistencia('${dni}','${btnEscapado}')">Ultima Asist.</button>`
        : "";
      const btnNuevaActividad = canAgregarPersona()
        ? `<button class="btn-item btn-item-info" onclick="openNuevaActividadModal('${pid}', '${btnEscapado}')">+ Act</button>`
        : "";
      return `
            <tr>
                <td class="mono">${dni || "-"}</td>
                <td>${usu}</td>
                <td class="saldo-total-cell" onclick="openEstadoCuentaModal('${pid}')" role="button" tabindex="0">
                    <button type="button" class="saldo-total-btn" tabindex="-1">
                        ${saldoTotalHtml}
                    </button>
                </td>

                ${columnasSaldosHtml}
                <td class="actions-cell">
                    ${btnConsumo}
                    
                    ${btnAsistencia}
                    ${btnNuevaActividad}
                </td>
            </tr>
        `;
    })
    .join("");
}

function saldarActividad(idCliente, idActividad) {
  const saldarT0 = performance.now();
  const logSaldar = (label) => {
    console.log(
      `[SALDAR] ${label}: ${(performance.now() - saldarT0).toFixed(1)} ms`,
    );
  };
  console.log("[SALDAR] Inicio");
  logSaldar("Click boton Saldar");

  //  calcular deuda actual de esa actividad
  const deuda = (cache.abonos || [])
    .filter(
      (a) =>
        String(a.IDCliente) === String(idCliente) &&
        String(a.IDActividad) === String(idActividad),
    )
    .reduce((acc, a) => acc + Number(a.Monto ?? a.monto ?? 0), 0);

  // si no hay deuda, no hace nada
  if (deuda >= 0) return;

  const montoPago = Math.abs(deuda);

  //  UI inmediata (optimistic)
  buildModal(
    "Confirmar Pago",
    `
        <p class="section-desc" style="margin-bottom:18px;">Desea saldar esta actividad?</p>
        <div class="stat-item" style="margin:0;">
            <label>Monto a pagar</label>
            <p class="balance-positive">${formatMonto(montoPago)}</p>
        </div>
    `,
    async () => false,
  );
  logSaldar("Apertura modal");

  document.getElementById("btnModalClose").textContent = "Cancelar";
  document.getElementById("btnModalSubmit").textContent = "Saldar";
  document.getElementById("btnModalSubmit").onclick = async () => {
    logSaldar("Confirmacion");
    const submitBtn = document.getElementById("btnModalSubmit");
    submitBtn.disabled = true;
    const now = new Date();
    const idMovimiento = "PAGO-LOCAL-" + Date.now();
    const movimientoLocal = {
      IDMovimiento: idMovimiento,
      IDCliente: idCliente,
      IDActividad: idActividad,
      IDSuplemento: "",
      Tipo: "Pago",
      Fecha: now.toISOString().split("T")[0],
      Hora: now.toTimeString().split(" ")[0],
      Monto: montoPago,
    };

    addMovimientoLocal(movimientoLocal);
    console.log(
      `[SALDAR] Cache actualizada: ${(performance.now() - saldarT0).toFixed(1)} ms`,
    );

    const renderPersonasT0 = performance.now();
    refreshFinancialUI(idCliente);
    logSaldar(
      `renderPersonas() terminado (${(performance.now() - renderPersonasT0).toFixed(1)} ms)`,
    );
    console.log(
      `[SALDAR] Render terminado: ${(performance.now() - saldarT0).toFixed(1)} ms`,
    );

    closeModal();
    logSaldar("Cierre total del flujo");
    setSyncStatus("saving");

    setTimeout(async () => {
      try {
        console.log(
          `[SALDAR] API enviada: ${(performance.now() - saldarT0).toFixed(1)} ms`,
        );
        await apiPost("registrarPagoActividad", {
          idCliente: idCliente,
          idActividad: idActividad,
          monto: montoPago,
        });
        console.log(
          `[SALDAR] API respondida: ${(performance.now() - saldarT0).toFixed(1)} ms`,
        );
        setSyncStatus("success");
      } catch (e) {
        console.error("Error al saldar:", e);
        removeMovimientoLocal(idMovimiento);
        refreshFinancialUI(idCliente);
        setSyncStatus("error");
        showErrorModal("Error", "Error guardando el pago.");
      }
    }, 0);
  };
}

function filterPersonas() {
  const q = document.getElementById("searchPersonas").value.toLowerCase();
  const sf = document.getElementById("saldoFilter").value;

  renderPersonas(
    (cache.personas || []).filter((p) => {
      const textMatch =
        (p.Nombre || p.Usuario || "").toLowerCase().includes(q) ||
        String(p.Documento || "").includes(q);
      if (!textMatch) return false;

      if (sf !== "todos") {
        const saldo = getSaldoPersona(p.IDCliente || p.IDAsistencia);
        if (sf === "deuda" && saldo >= 0) return false;
        if (sf === "al_dia" && saldo !== 0) return false;
        if (sf === "favor" && saldo <= 0) return false;
      }
      return true;
    }),
  );
}

/* =========================
   12. VISTA: ASISTENCIA
========================= */
function resetAsistencia() {
  document.getElementById("asistenciaDni").value = "";
  const el = document.getElementById("asistenciaMsg");
  el.className = "hidden";
  el.innerHTML = "";
}

/* =========================
   13. VISTA: ADMIN
========================= */
function renderAdmin() {
  //  PROTECCION DE SESION
  if (!currentUser) return enterApp("loginChoiceView");

  if (!canAccessAdmin()) {
    showView("accessDeniedView");
    return;
  }
  const metrics = getDashboardMetrics();

  document.getElementById("totalPersonasCount").textContent =
    metrics.totalClientes;
  document.getElementById("totalAbonosCount").textContent =
    metrics.clientesConDeuda;
  document.getElementById("totalRevenueMonth").textContent = formatMonto(
    metrics.totalAdeudado,
  );
  const cobradoHoyEl = document.getElementById("totalCobradoHoy");
  const cobradoMesEl = document.getElementById("totalCobradoMes");
  if (cobradoHoyEl) cobradoHoyEl.textContent = formatMonto(metrics.cobradoHoy);
  if (cobradoMesEl) cobradoMesEl.textContent = formatMonto(metrics.cobradoMes);
  setText("totalConsumosHoy", formatMonto(metrics.consumosHoy));
  setText("totalConsumosMes", formatMonto(metrics.consumosMes));
  setText("totalDeudaNeta", formatMonto(metrics.deudaNeta));
  setText("totalClientesActivos", metrics.clientesActivosReales.length);
  setText("ticketPromedio", formatMonto(metrics.ticketPromedio));
  setText("ingresosNetosMes", formatMonto(metrics.ingresosNetosMes));
  setText("morosidad", `${metrics.morosidad.toFixed(1)}%`);
  setText("deudaPromedio", formatMonto(metrics.deudaPromedio));
  renderAdminAlertas(metrics);
  renderAdminRankings();
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function getLastAsistenciaDate(pid) {
  return (
    (cache.asistencias || [])
      .filter((a) => String(a.IDCliente || "").trim() === String(pid))
      .map((a) => String(a.Fecha || "").split("T")[0])
      .filter(Boolean)
      .sort()
      .pop() || ""
  );
}

function getAdminAlertData(metrics = getDashboardMetrics()) {
  const [yy, mm, dd] = metrics.hoy.split("-").map(Number);
  const hoy = new Date(yy, mm - 1, dd);
  const hace30 = new Date(hoy);
  hace30.setDate(hace30.getDate() - 30);
  const hace30Str = localDateString(hace30);
  const deudaAlta = [];
  const sinAsistencia = [];
  const deudaSinAsistencia = [];

  metrics.clientes.forEach((p) => {
    const pid = getClienteId(p);
    const deuda = Math.abs(Math.min(metrics.saldosPorCliente[pid] || 0, 0));
    const ultima = getLastAsistenciaDate(pid);
    const faltaAsistencia = !ultima || ultima < hace30Str;
    const nombre = p.Nombre || p.Usuario || pid;
    if (deuda > 50000) deudaAlta.push(nombre);
    if (faltaAsistencia) sinAsistencia.push(nombre);
    if (deuda > 0 && faltaAsistencia) deudaSinAsistencia.push(nombre);
  });

  const actividadesConInscriptos = new Set(
    (cache.inscripciones || [])
      .filter((i) => String(i.Estado).toUpperCase() === "ACTIVO")
      .map((i) => String(i.Actividad || "").trim()),
  );
  const actividadesSinInscriptos = (cache.servicios || [])
    .filter(
      (s) =>
        !actividadesConInscriptos.has(
          String(s.IDActividad || s.IDServicios).trim(),
        ),
    )
    .map((s) => s.Nombre || s.IDActividad || s.IDServicios);

  return {
    deudaAlta: {
      titulo: "Clientes con deuda superior a $50.000",
      texto: `Alerta Clientes con deuda superior a $50.000: ${deudaAlta.length}`,
      items: deudaAlta,
    },
    sinAsistencia: {
      titulo: "Clientes sin asistencia hace mas de 30 dias",
      texto: `Alerta Clientes sin asistencia hace mas de 30 dias: ${sinAsistencia.length}`,
      items: sinAsistencia,
    },
    deudaSinAsistencia: {
      titulo: "Clientes con deuda y sin asistencia",
      texto: `Alerta Clientes con deuda y sin asistencia: ${deudaSinAsistencia.length}`,
      items: deudaSinAsistencia,
    },
    actividadesSinInscriptos: {
      titulo: "Actividades sin inscriptos",
      texto: `Alerta Actividades sin inscriptos: ${actividadesSinInscriptos.length}`,
      items: actividadesSinInscriptos,
    },
  };

  const alertas = [];
  if (deudaAlta.length)
    alertas.push(
      `Alerta Clientes con deuda superior a $50.000: ${deudaAlta.length}`,
    );
  if (sinAsistencia.length)
    alertas.push(
      `Alerta Clientes sin asistencia hace mas de 30 dias: ${sinAsistencia.length}`,
    );
  if (deudaSinAsistencia.length)
    alertas.push(
      `Alerta Clientes con deuda y sin asistencia: ${deudaSinAsistencia.length}`,
    );
  if (actividadesSinInscriptos.length)
    alertas.push(
      `Alerta Actividades sin inscriptos: ${actividadesSinInscriptos.length}`,
    );

  el.innerHTML = alertas.length
    ? alertas
        .map((a) => `<div class="admin-list-item alert">${escHtml(a)}</div>`)
        .join("")
    : `<div class="admin-list-item ok"> Sin alertas pendientes</div>`;
}

function renderAdminAlertas(metrics = getDashboardMetrics()) {
  const el = document.getElementById("adminAlertas");
  if (!el) return;
  const alertas = Object.entries(getAdminAlertData(metrics)).filter(
    ([, alerta]) => alerta.items.length,
  );
  el.innerHTML = alertas.length
    ? alertas
        .map(
          ([key, alerta]) =>
            `<button type="button" class="admin-list-item alert alert-clickable" onclick="openAdminAlertModal('${key}')">${escHtml(alerta.texto)}</button>`,
        )
        .join("")
    : `<div class="admin-list-item ok"> Sin alertas pendientes</div>`;
}

function openAdminAlertModal(tipo) {
  const alerta = getAdminAlertData()[tipo];
  if (!alerta) return;
  const content = alerta.items.length
    ? `<div class="admin-list">${alerta.items.map((item) => `<div class="admin-list-item">${escHtml(item)}</div>`).join("")}</div>`
    : '<p class="gympro-modal-message">Sin resultados.</p>';
  buildModal(alerta.titulo, content, async () => true);
  document.getElementById("btnModalClose").classList.add("hidden");
  document.getElementById("btnModalSubmit").textContent = "Cerrar";
}

function renderAdminRankings() {
  const actividadCounts = {};
  const suplementoCounts = {};
  getMovimientosContables().forEach((m) => {
    if (!isMovimientoConsumo(m)) return;
    const act = getMovementActivityId(m);
    const sup = getMovementSupplementId(m);
    if (act) actividadCounts[act] = (actividadCounts[act] || 0) + 1;
    if (sup) suplementoCounts[sup] = (suplementoCounts[sup] || 0) + 1;
  });
  renderRankingList("topActividades", actividadCounts, (id) =>
    getNombreActividad(id),
  );
  renderRankingList("topSuplementos", suplementoCounts, (id) =>
    getNombreConcepto("", id),
  );
}

function renderRankingList(id, counts, getName) {
  const el = document.getElementById(id);
  if (!el) return;
  const items = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  el.innerHTML = items.length
    ? items
        .map(
          ([key, count]) =>
            `<li><span>${escHtml(getName(key))}</span><strong>${count}</strong></li>`,
        )
        .join("")
    : `<li class="empty-row">Sin datos</li>`;
}

function getCajaDateRange() {
  const now = new Date();
  const hoy = localDateString(now);
  const periodo = document.getElementById("cajaPeriodoFilter")?.value || "mes";
  if (periodo === "hoy") return { desde: hoy, hasta: hoy };
  if (periodo === "semana") {
    const desde = new Date(now);
    desde.setDate(desde.getDate() - 6);
    return { desde: localDateString(desde), hasta: hoy };
  }
  if (periodo === "personalizado") {
    return {
      desde: document.getElementById("cajaDesde")?.value || "",
      hasta: document.getElementById("cajaHasta")?.value || "",
    };
  }
  return { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy };
}

function filterMovimientosByRange(movimientos, rango) {
  return (movimientos || []).filter((m) => {
    const fecha = getMovimientoFecha(m);
    if (!fecha) return false;
    if (rango.desde && fecha < rango.desde) return false;
    if (rango.hasta && fecha > rango.hasta) return false;
    return true;
  });
}

function renderCaja() {
  if (!canAccessAdmin()) {
    showView("accessDeniedView");
    return;
  }
  const metrics = getDashboardMetrics();
  const rango = getCajaDateRange();
  const movimientosFiltrados = filterMovimientosByRange(
    getMovimientosContables(),
    rango,
  );
  const ingresosPeriodo = movimientosFiltrados.reduce(
    (sum, m) => sum + Math.max(getMovimientoMonto(m), 0),
    0,
  );
  const consumosPeriodo = movimientosFiltrados.reduce(
    (sum, m) => sum + Math.abs(Math.min(getMovimientoMonto(m), 0)),
    0,
  );

  setText("cajaIngresosHoy", formatMonto(ingresosPeriodo));
  setText("cajaIngresosMes", formatMonto(ingresosPeriodo));
  setText("cajaConsumosHoy", formatMonto(consumosPeriodo));
  setText("cajaConsumosMes", formatMonto(consumosPeriodo));
  setText("cajaDeudaTotal", formatMonto(metrics.totalAdeudado));
  setText("cajaClientesDeuda", metrics.clientesConDeuda);

  const tbody = document.querySelector("#cajaMovimientosTable tbody");
  if (!tbody) return;
  const movimientos = [...movimientosFiltrados]
    .sort((a, b) =>
      `${getMovimientoFecha(b)} ${b.Hora || ""}`.localeCompare(
        `${getMovimientoFecha(a)} ${a.Hora || ""}`,
      ),
    )
    .slice(0, 25);
  tbody.innerHTML = movimientos.length
    ? movimientos
        .map((m) => {
          const monto = getMovimientoMonto(m);
          return `
                <tr>
                    <td>${escHtml(getMovimientoFecha(m))}</td>
                    <td>${escHtml(formatHoraMovimiento(m.Hora))}</td>
                    <td>${escHtml(getNombrePersona(getMovementClientId(m)))}</td>
                    <td>${escHtml(getNombreConcepto(getMovementActivityId(m), getMovementSupplementId(m)))}</td>
                    <td class="${monto < 0 ? "balance-negative" : "balance-positive"}">${formatMonto(monto)}</td>
                </tr>
            `;
        })
        .join("")
    : '<tr><td colspan="5" class="empty-row">Sin movimientos</td></tr>';
}

function generarDatosDemo() {
  if (!canAccessAdmin()) return;
  const hoy = localDateString();
  const hora = new Date().toTimeString().split(" ")[0];
  if (!cache.personas) cache.personas = [];
  if (!cache.inscripciones) cache.inscripciones = [];
  if (!cache.suplementos) cache.suplementos = [];
  if (!cache.servicios) cache.servicios = [];

  const demoClientes = [
    {
      IDCliente: "DEMO-CLI-1",
      Nombre: "Demo Valentina Ruiz",
      Documento: "900001",
      Mail: "demo1@gympro.local",
      Demo: true,
    },
    {
      IDCliente: "DEMO-CLI-2",
      Nombre: "Demo Bruno Castro",
      Documento: "900002",
      Mail: "demo2@gympro.local",
      Demo: true,
    },
    {
      IDCliente: "DEMO-CLI-3",
      Nombre: "Demo Lara Mendez",
      Documento: "900003",
      Mail: "demo3@gympro.local",
      Demo: true,
    },
  ];
  const demoActividad = {
    IDActividad: "DEMO-ACT-1",
    IDServicios: "DEMO-ACT-1",
    Nombre: "Demo Funcional",
    Precios: 30000,
    Demo: true,
  };
  const demoSuplemento = {
    IDSuplemento: "DEMO-SUP-1",
    Nombre: "Demo Proteina",
    Precio: 18000,
    Demo: true,
  };

  demoClientes.forEach((c) => {
    if (!cache.personas.some((p) => getClienteId(p) === c.IDCliente))
      cache.personas.push(c);
  });
  if (
    !cache.servicios.some(
      (s) =>
        String(s.IDActividad || s.IDServicios) === demoActividad.IDActividad,
    )
  )
    cache.servicios.push(demoActividad);
  if (
    !cache.suplementos.some(
      (s) => String(s.IDSuplemento) === demoSuplemento.IDSuplemento,
    )
  )
    cache.suplementos.push(demoSuplemento);
  demoClientes.forEach((c, idx) => {
    if (
      !cache.inscripciones.some(
        (i) =>
          String(i.IDCliente) === c.IDCliente &&
          String(i.Actividad) === demoActividad.IDActividad,
      )
    ) {
      cache.inscripciones.push({
        IDInscripcion: `DEMO-INS-${idx + 1}`,
        IDCliente: c.IDCliente,
        Actividad: demoActividad.IDActividad,
        FechaInicio: hoy,
        Estado: "ACTIVO",
        Demo: true,
      });
    }
  });

  [
    {
      IDMovimiento: "DEMO-MOV-1",
      IDCliente: "DEMO-CLI-1",
      IDActividad: "DEMO-ACT-1",
      Tipo: "Consumo",
      Fecha: hoy,
      Hora: hora,
      Monto: -30000,
      Demo: true,
    },
    {
      IDMovimiento: "DEMO-MOV-2",
      IDCliente: "DEMO-CLI-1",
      IDActividad: "DEMO-ACT-1",
      Tipo: "Pago",
      Fecha: hoy,
      Hora: hora,
      Monto: 15000,
      Demo: true,
    },
    {
      IDMovimiento: "DEMO-MOV-3",
      IDCliente: "DEMO-CLI-2",
      IDSuplemento: "DEMO-SUP-1",
      Tipo: "CONSUMO",
      Fecha: hoy,
      Hora: hora,
      Monto: -18000,
      Demo: true,
    },
    {
      IDMovimiento: "DEMO-MOV-4",
      IDCliente: "DEMO-CLI-3",
      IDActividad: "DEMO-ACT-1",
      Tipo: "Pago",
      Fecha: hoy,
      Hora: hora,
      Monto: 30000,
      Demo: true,
    },
  ].forEach((m) => {
    if (
      !getMovimientosContables().some(
        (x) => String(x.IDMovimiento) === m.IDMovimiento,
      )
    )
      addMovimientoLocal(m);
  });

  refreshFinancialUI();
  renderCaja();
  showInfoModal("Datos demo", "Datos demo generados localmente.");
}

function limpiarDatosDemo() {
  if (!canAccessAdmin()) return;
  cache.personas = (cache.personas || []).filter(
    (x) => !String(x.IDCliente || "").startsWith("DEMO-"),
  );
  cache.inscripciones = (cache.inscripciones || []).filter(
    (x) =>
      !String(x.IDInscripcion || "").startsWith("DEMO-") &&
      !String(x.IDCliente || "").startsWith("DEMO-"),
  );
  cache.servicios = (cache.servicios || []).filter(
    (x) => !String(x.IDActividad || x.IDServicios || "").startsWith("DEMO-"),
  );
  cache.suplementos = (cache.suplementos || []).filter(
    (x) => !String(x.IDSuplemento || "").startsWith("DEMO-"),
  );
  cache.abonos = (cache.abonos || []).filter(
    (x) =>
      !String(x.IDMovimiento || x.IDCarga || "").startsWith("DEMO-") &&
      !String(x.IDCliente || "").startsWith("DEMO-"),
  );
  cache.movimientos = (cache.movimientos || []).filter(
    (x) =>
      !String(x.IDMovimiento || x.IDCarga || "").startsWith("DEMO-") &&
      !String(x.IDCliente || "").startsWith("DEMO-"),
  );
  refreshFinancialUI();
  renderCaja();
  showInfoModal("Datos demo", "Datos demo eliminados.");
}

/* =========================
   14. ACCIONES ADMIN
========================= */

/* Registrar Pago */

function openPagoModal() {
  if (!canViewMovimientos() || !canRegisterPago()) return;

  const personas = cache.personas || [];
  const servicios = cache.servicios || [];

  buildModal(
    "Registrar Pago",
    `
        <div class="form-group">
            <label>Persona</label>
            <select id="pagoPersonaSelect">
                ${personas
                  .map(
                    (p) =>
                      `<option value="${escHtml(p.IDCliente || p.IDAsistencia)}">
            ${escHtml(p.Nombre || p.Usuario)} (DNI: ${escHtml(String(p.Documento))})
        </option>`,
                  )
                  .join("")}
            </select>
        </div>

        <div class="form-group">
            <label>Servicio / Concepto</label>
            <select id="pagoServicioSelect">
                <option value="">- Sin servicio especifico -</option>
                ${servicios
                  .map(
                    (s) =>
                      `<option value="${escHtml(s.IDServicios)}">${escHtml(s.Nombre)} ($${s.Precios})</option>`,
                  )
                  .join("")}
            </select>
        </div>

        <div class="form-group">
            <label>Monto (positivo)</label>
            <input type="number" id="pagoMontoInput" min="1" step="100" placeholder="Ej: 32000" required>
        </div>
    `,
    () => {
      const pid = document.getElementById("pagoPersonaSelect").value;
      const servId = document.getElementById("pagoServicioSelect").value;
      const monto = parseFloat(document.getElementById("pagoMontoInput").value);

      if (!pid) {
        showErrorModal("Persona requerida", "Selecciona una persona.");
        return false;
      }
      if (!monto || monto <= 0) {
        showErrorModal("Monto invalido", "Ingresa un monto valido.");
        return false;
      }

      const idMovimiento = "PAGO-" + Date.now();
      const now = new Date();

      if (!cache.abonos) cache.abonos = [];

      //  INSERTAR ARRIBA (mejor UX)
      addMovimientoLocal(
        {
          IDMovimiento: idMovimiento,
          IDCliente: pid,
          IDActividad: servId,
          Servicio: servId,
          Monto: monto,
          Tipo: "Pago",
          Fecha: now.toISOString().split("T")[0],
          Hora: now.toTimeString().split(" ")[0],
        },
        { unshift: true },
      );

      renderAdmin();
      renderAbonos();
      if (typeof renderPersonas === "function") renderPersonas();

      setSyncStatus("saving");
      apiPost("registrarMovimiento", {
        idCarga: idMovimiento,
        tipoMovimiento: "Pago",
        idCliente: pid,
        servicio: servId,
        suplemento: "",
        monto: monto,
      })
        .then(() => {
          console.log(" Pago guardado");
          setSyncStatus("success");
        })
        .catch((e) => {
          console.error(e);

          removeMovimientoLocal(idMovimiento);

          renderAdmin();
          renderAbonos();
          if (typeof renderPersonas === "function") renderPersonas();

          setSyncStatus("error");
          showErrorModal("Error", "Error guardando pago");
        });

      return true;
    },
  );
}

/* Generar Deuda Mensual */
async function handleGenerarDeudas() {
  if (!canAccessAdmin()) return;

  const personas = cache.personas || [];
  const servicios = cache.servicios || [];
  const movimientos = getMovimientosContables();
  const inscripciones = cache.inscripciones || [];

  if (!personas.length) {
    showErrorModal("Sin personas", "No hay personas cargadas en el sistema.");
    return;
  }
  if (!servicios.length) {
    showErrorModal("Sin servicios", "No hay servicios cargados en el sistema.");
    return;
  }

  const now = new Date();
  const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const fecha = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const hora = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

  const pendientes = [];
  const omitidas = [];
  const sinServicio = [];

  for (const persona of personas) {
    const pid = String(persona.IDCliente || persona.IDAsistencia || "");

    const inscPersona = inscripciones.filter(
      (i) =>
        String(i.IDCliente) === pid &&
        String(i.Estado).toUpperCase() === "ACTIVO",
    );

    if (!inscPersona.length) continue;

    for (const insc of inscPersona) {
      const servicio = servicios.find(
        (s) =>
          String(s.IDActividad || s.IDServicios) === String(insc.Actividad),
      );

      if (!servicio) {
        sinServicio.push(persona.Nombre || persona.Usuario);
        continue;
      }

      const idMovimiento = `DEUDA-${yyyymm}-${pid}-${servicio.IDActividad || servicio.IDServicios}`;
      const yaExiste = movimientos.some(
        (a) => String(a.IDMovimiento ?? a.IDCarga ?? "") === idMovimiento,
      );

      if (yaExiste) {
        omitidas.push(persona.Nombre || persona.Usuario);
      } else {
        pendientes.push({ persona, servicio, idMovimiento });
      }
    }
  }

  if (!pendientes.length) {
    showInfoModal(
      "Deudas ya generadas",
      `Deudas de ${yyyymm} ya generadas para todas las personas activas.\n(${omitidas.length} omitidas, ${sinServicio.length} sin servicio)`,
    );
    return;
  }

  showConfirmModal(
    "Generar deuda mensual",
    `Generar deuda mensual ${yyyymm}?\n\n` +
      `- ${pendientes.length} nuevas deudas a generar\n` +
      `- ${omitidas.length} ya existentes (se omiten)\n` +
      `- ${sinServicio.length} sin servicio asignado\n\n` +
      `Esta accion registrara un cargo por actividad en Movimientos.`,
    () =>
      withLoader(async () => {
        let generadas = 0;
        const idsGenerados = [];

        try {
          setSyncStatus("saving");
          for (const { persona, servicio, idMovimiento } of pendientes) {
            const pid = String(persona.IDCliente || persona.IDAsistencia || "");
            const precio = parseFloat(servicio.Precios || 0);

            addMovimientoLocal({
              IDMovimiento: idMovimiento,
              IDCliente: pid,
              IDActividad: servicio.IDActividad || servicio.IDServicios,
              IDSuplemento: "",
              Tipo: "Consumo",
              Fecha: fecha,
              Hora: hora,
              Monto: -Math.abs(precio),
            });
            idsGenerados.push(idMovimiento);

            await apiPost("registrarMovimiento", {
              idMovimiento,
              tipo: "Consumo",
              idCliente: pid,
              idActividad: servicio.IDActividad || servicio.IDServicios,
              idSuplemento: "",
              monto: -Math.abs(precio),
            });

            generadas++;
          }

          renderAdmin();
          renderPersonas();
          if (canViewAbonos()) renderAbonos();
          setSyncStatus("success");

          showInfoModal(
            "Deuda mensual generada",
            `Deuda mensual generada.\n${generadas} registros creados, ${omitidas.length} omitidos (ya existian).`,
          );
          return false;
        } catch (e) {
          console.error("Error generando deuda mensual:", e);
          idsGenerados.forEach((id) => removeMovimientoLocal(id));
          renderAdmin();
          renderPersonas();
          if (canViewAbonos()) renderAbonos();
          setSyncStatus("error");
          showErrorModal("Error", "Error generando deuda mensual.");
          return false;
        }
      }),
  );
}

/* Nueva Persona */

async function openNuevaPersonaModal() {
  if (!canAgregarPersona()) return;

  //  Asegurar actividades en cache
  let servicios = cache.servicios;
  if (!servicios || !servicios.length) {
    servicios = await apiGet("getActividades");
    cache.servicios = servicios || [];
  }

  buildModal(
    "Nueva Persona",
    `
        <div class="form-group">
            <label>Nombre / Usuario *</label>
            <input type="text" id="npUsuario" placeholder="Ej: Juan Perez" required>
        </div>
        <div class="form-group">
            <label>Documento *</label>
            <input type="text" id="npDocumento" placeholder="Ej: 47001" required inputmode="numeric">
        </div>
        <div class="form-group">
            <label>Email *</label>
            <input type="email" id="npMail" placeholder="juan@email.com" required>
        </div>
        <div class="form-group">
            <label>Direccion</label>
            <input type="text" id="npDireccion" placeholder="Ej: Argentina">
        </div>
        <div class="form-group">
            <label>Actividad *</label>
            <select id="npActividad">
                <option value="">- Seleccionar -</option>
                ${servicios
                  .map(
                    (s) => `
                    <option value="${escHtml(String(s.IDActividad || s.IDServicios))}">
                        ${escHtml(s.Nombre)}
                    </option>
                `,
                  )
                  .join("")}
            </select>
        </div>
    `,
    async () => {
      const usuario = document.getElementById("npUsuario").value.trim();
      const documento = document.getElementById("npDocumento").value.trim();
      const mail = document.getElementById("npMail").value.trim().toLowerCase();
      const direccion = document.getElementById("npDireccion").value.trim();
      const actividad = document.getElementById("npActividad").value;

      //  Validaciones con feedback
      if (!usuario || !documento || !mail) {
        showErrorModal(
          "Campos obligatorios",
          "Completa los campos obligatorios",
        );
        return false;
      }

      const personas = cache.personas || [];

      if (
        personas.some((p) => String(p.Documento || "").trim() === documento)
      ) {
        showErrorModal(
          "Documento existente",
          "Ya existe una persona con ese documento",
        );
        return false;
      }

      if (personas.some((p) => (p.Mail || "").toLowerCase() === mail)) {
        showErrorModal(
          "Email existente",
          "Ya existe una persona con ese email",
        );
        return false;
      }

      if (!actividad) {
        showErrorModal("Actividad requerida", "Selecciona una actividad");
        return false;
      }

      //  Buscar servicio por ID (NO por nombre)
      const servicio = servicios.find(
        (s) => String(s.IDActividad || s.IDServicios) === String(actividad),
      );

      if (!servicio) {
        showErrorModal("Actividad invalida", "Actividad invalida");
        return false;
      }

      const idCliente = generateId();

      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const fechaHoy = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

      //  Objetos
      const nuevaPersona = {
        IDCliente: idCliente,
        Nombre: usuario,
        Documento: documento,
        Mail: mail,
        Direccion: direccion,
        Activo: "VERDADERO",
      };

      const nuevaInscripcion = {
        IDInscripcion: "INS-" + Date.now(),
        IDCliente: idCliente,
        Actividad: servicio.IDActividad || servicio.IDServicios,
        FechaInicio: fechaHoy,
        Estado: "ACTIVO",
        FechaFin: "",
      };

      //  Cache inmediato
      if (!cache.personas) cache.personas = [];
      cache.personas.push(nuevaPersona);

      if (!cache.inscripciones) cache.inscripciones = [];
      cache.inscripciones.push(nuevaInscripcion);

      //  Inyectar deuda local inmediata para que renderPersonas muestre el rojo al instante
      const montoDeuda = -Math.abs(
        parseFloat(servicio.Precios || servicio.Precio || 0),
      );
      if (montoDeuda < 0) {
        addMovimientoLocal({
          IDMovimiento: "TMP-" + Date.now(),
          IDCliente: idCliente,
          IDActividad: servicio.IDActividad || servicio.IDServicios,
          Monto: montoDeuda,
        });
      }

      //  Backend refresh asincrono silencioso (redibujara cuando termine)
      syncAbonosSilent().then(() => renderPersonas());

      //  UI Inmediata
      renderAdmin();
      renderPersonas();

      //  Backend async
      (async () => {
        try {
          await apiPost("agregarPersona", {
            idCliente,
            nombre: usuario,
            documento,
            mail,
            direccion,
            activo: "VERDADERO",
          });

          await apiPost("agregarInscripcion", {
            idInscripcion: nuevaInscripcion.IDInscripcion,
            idCliente: idCliente,
            actividad: nuevaInscripcion.Actividad,
            fechaInicio: fechaHoy,
            estado: "ACTIVO",
          });
        } catch (e) {
          console.error("Error backend:", e);
        }
      })();

      return true;
    },
  );
}

/* =========================
   15. ACCIONES TABLA
========================= */

/* Consumo de suplemento */
function openConsumoModal(userName, idCliente) {
  if (!canRegisterConsumo()) return;

  const sups = cache.suplementos || [];

  buildModal(
    `Consumo: ${userName}`,
    `
        <div class="form-group">
            <label>Suplemento</label>
            <select id="consumoSelect">
                ${sups
                  .map(
                    (s) => `
                    <option 
                        value="${s.IDSuplemento}" 
                        data-precio="${s.Precio}"
                        data-nombre="${s.Nombre}">
                        ${s.Nombre} ($${s.Precio})
                    </option>
                `,
                  )
                  .join("")}
            </select>
        </div>
    `,
    async () => {
      const sel = document.getElementById("consumoSelect");
      const idSup = sel.value;
      const suplemento = sel.selectedOptions[0];
      const precio = parseFloat(sel.selectedOptions[0].dataset.precio);

      console.log("Consumo seleccionado", suplemento);

      if (!idSup || isNaN(precio)) {
        showErrorModal("Error", "Error en suplemento");
        return false;
      }

      //  CREAR OBJETO LOCAL (INSTANTANEO)
      const nuevo = {
        IDMovimiento: "MOV-" + Date.now(),
        IDCliente: idCliente,
        IDActividad: "",
        IDSuplemento: idSup,
        Tipo: "CONSUMO",
        Fecha: new Date().toISOString().split("T")[0],
        Hora: new Date().toTimeString().split(" ")[0],
        Monto: -Math.abs(precio),
      };

      //  ACTUALIZAR CACHE INMEDIATO
      console.log("Movimiento generado", nuevo);
      console.log("MOVIMIENTO CREADO", nuevo);

      addMovimientoLocal(nuevo);

      console.log("Cache movimientos", cache.movimientos.length);

      //  REFRESCAR UI AL INSTANTE
      refreshFinancialUI(idCliente);

      //  BACKEND EN SEGUNDO PLANO
      setSyncStatus("saving");
      setTimeout(async () => {
        try {
          await apiPost("registrarMovimiento", nuevo);
          setSyncStatus("success");
        } catch (e) {
          console.error("Error registrando consumo:", e);
          removeMovimientoLocal(nuevo.IDMovimiento);
          refreshFinancialUI(idCliente);
          setSyncStatus("error");
          showErrorModal("Error", "Error registrando consumo.");
        }
      }, 0);

      return true;
    },
  );
}

/* Saldar actividad */

let estadoCuentaActivo = { idCliente: null, nombre: "", vista: "estado" };

function setSyncStatus(status) {
  if (status === "saving") {
    beginSyncChange();
  } else if (status === "error") {
    finishSyncChange(false);
  } else {
    finishSyncChange(true);
  }
}

function getRelativeSyncTime() {
  const diff = Math.max(0, Date.now() - syncLastSuccessAt);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60)
    return `hace ${seconds || 1} segundo${seconds === 1 ? "" : "s"}`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} minuto${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  return `hace ${hours} hora${hours === 1 ? "" : "s"}`;
}

function updateSyncStatusDisplay() {
  const el = document.getElementById("syncStatus");
  if (!el) return;
  el.classList.remove("sync-success", "sync-saving", "sync-error");
  if (syncPendingChanges > 0) {
    el.textContent =
      syncPendingChanges === 1
        ? " Cambios pendientes"
        : ` ${syncPendingChanges} cambios pendientes`;
    el.classList.add("sync-saving");
  } else if (syncHasError) {
    el.textContent = " Error de sincronizacion";
    el.classList.add("sync-error");
  } else {
    el.textContent = ` Sincronizado ${getRelativeSyncTime()}`;
    el.classList.add("sync-success");
  }
}

function getMovimientoTime(a) {
  const fecha = String(a.Fecha || "").split("T")[0];
  const hora = String(a.Hora || "");
  return `${fecha} ${hora}`;
}

function formatHoraMovimiento(horaValor) {
  const hora = String(horaValor || "").trim();
  if (!hora) return "";
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(hora)) return hora;
  if (hora.includes("1899")) {
    const d = new Date(hora);
    if (!isNaN(d.getTime())) {
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      const ss = String(d.getSeconds()).padStart(2, "0");
      return `${hh}:${mm}:${ss}`;
    }
  }
  if (hora.includes("T")) return hora.split("T")[1].split(".")[0];
  return hora;
}

function getCuentaCorrienteCliente(idCliente) {
  const pid = String(idCliente || "").trim();
  const saldosMap = getSaldosPorActividad(pid);

  const actividades = (cache.inscripciones || [])
    .filter(
      (i) =>
        String(i.IDCliente) === pid &&
        String(i.Estado).toUpperCase() === "ACTIVO",
    )
    .map((i) => {
      const idAct = String(i.Actividad || "").trim();
      const serv = (cache.servicios || []).find(
        (s) => String(s.IDActividad || s.IDServicios).trim() === idAct,
      );
      let saldo = saldosMap[idAct];

      if (saldo === undefined) {
        saldo = serv
          ? -Math.abs(parseFloat(serv.Precios || serv.Precio || 0))
          : 0;
      }

      const movimientos = (cache.abonos || []).filter(
        (a) =>
          String(a.IDCliente ?? a.Persona ?? "").trim() === pid &&
          String(a.IDActividad ?? a.Servicio ?? "").trim() === idAct,
      );

      const fechaOrden = movimientos.length
        ? movimientos.map(getMovimientoTime).sort()[0]
        : String(i.FechaInicio || "");

      return {
        id: idAct,
        nombre: serv ? serv.Nombre : getNombreActividad(idAct),
        saldo: saldo,
        fechaOrden: fechaOrden,
      };
    })
    .sort((a, b) => String(a.fechaOrden).localeCompare(String(b.fechaOrden)));

  const suplementosMap = {};
  (cache.abonos || []).forEach((a) => {
    const aPid = String(a.IDCliente ?? a.Persona ?? "").trim();
    const idSup = String(a.IDSuplemento ?? a.Suplemento ?? "").trim();
    if (aPid !== pid || !idSup) return;

    const monto = parseFloat(a.Monto ?? a.monto ?? 0);
    if (isNaN(monto)) return;

    if (!suplementosMap[idSup]) {
      suplementosMap[idSup] = {
        id: idSup,
        nombre: getNombreConcepto("", idSup),
        saldo: 0,
        fechaOrden: getMovimientoTime(a),
      };
    }
    suplementosMap[idSup].saldo += monto;
    if (getMovimientoTime(a) < suplementosMap[idSup].fechaOrden) {
      suplementosMap[idSup].fechaOrden = getMovimientoTime(a);
    }
  });

  const suplementos = Object.values(suplementosMap).sort((a, b) =>
    String(a.fechaOrden).localeCompare(String(b.fechaOrden)),
  );

  const subtotalActividades = actividades.reduce((s, x) => s + x.saldo, 0);
  const subtotalSuplementos = suplementos.reduce((s, x) => s + x.saldo, 0);
  const totalGeneral = subtotalActividades + subtotalSuplementos;

  console.group("AUDITORIA ESTADO CUENTA");
  console.log(
    "Movimientos usados:",
    (cache.abonos || []).filter(
      (a) => String(a.IDCliente ?? a.Persona ?? "").trim() === pid,
    ),
  );
  console.log("Detalle suplementos:", suplementosMap);
  console.log("Subtotal suplementos:", subtotalSuplementos);
  console.log("Subtotal actividades:", subtotalActividades);
  console.log("Total general:", totalGeneral);
  console.groupEnd();

  return {
    actividades,
    suplementos,
    subtotalActividades,
    subtotalSuplementos,
    total: totalGeneral,
  };
}

function openRegistrarPagoCuentaModal(idCliente) {
  if (!canRegisterPago()) return;

  const pid = String(idCliente || "").trim();
  const cliente = (cache.personas || []).find(
    (p) => String(p.IDCliente || p.IDAsistencia || "").trim() === pid,
  );
  if (!cliente) return;

  const nombre = cliente.Nombre || cliente.Usuario || "-";
  const cuenta = getCuentaCorrienteCliente(pid);
  const deudaActividades = Math.abs(Math.min(cuenta.subtotalActividades, 0));
  const deudaSuplementos = Math.abs(Math.min(cuenta.subtotalSuplementos, 0));
  const totalAdeudado = deudaActividades + deudaSuplementos;

  buildModal(
    "Registrar Pago",
    `
        <p class="estado-cuenta-subtitle">Cliente: ${escHtml(nombre)}</p>
        <div class="estado-cuenta-resumen cuenta-pago-resumen">
            <div><span>Total Actividades</span><strong>${formatMonto(deudaActividades)}</strong></div>
            <div><span>Total Suplementos</span><strong>${formatMonto(deudaSuplementos)}</strong></div>
            <div class="estado-cuenta-total"><span>Total Adeudado</span><strong>${formatMonto(totalAdeudado)}</strong></div>
        </div>
        <div class="form-group">
            <label for="cuentaPagoMonto">Monto recibido</label>
            <input type="number" id="cuentaPagoMonto" min="1" step="100" placeholder="Ej: 100000">
        </div>
        <div class="cuenta-pago-checks">
            <label><input type="checkbox" id="cuentaPagoActividades" checked> Actividades</label>
            <label><input type="checkbox" id="cuentaPagoSuplementos" checked> Suplementos</label>
        </div>
        <p id="cuentaPagoError" class="error-text hidden"></p>
    `,
    async () => false,
  );

  document.getElementById("btnModalClose").textContent = "Cancelar";
  document.getElementById("btnModalSubmit").textContent = "Guardar Pago";
  document.getElementById("btnModalSubmit").onclick = async () => {
    console.log("[PAGO] Inicio");
    const submitBtn = document.getElementById("btnModalSubmit");
    const errorEl = document.getElementById("cuentaPagoError");
    const montoRecibido = parseFloat(
      document.getElementById("cuentaPagoMonto").value,
    );
    const aplicarActividades = document.getElementById(
      "cuentaPagoActividades",
    ).checked;
    const aplicarSuplementos = document.getElementById(
      "cuentaPagoSuplementos",
    ).checked;

    if (
      !montoRecibido ||
      montoRecibido <= 0 ||
      (!aplicarActividades && !aplicarSuplementos)
    ) {
      errorEl.textContent =
        "Ingresa un monto valido y selecciona donde aplicarlo.";
      errorEl.classList.remove("hidden");
      return;
    }

    let restante = montoRecibido;
    const vistaRetorno = estadoCuentaActivo.vista;
    const movimientosGenerados = [];
    const backendJobs = [];
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const fecha = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const hora = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    submitBtn.disabled = true;
    setSyncStatus("saving");

    if (aplicarActividades) {
      const pendientesAct = getCuentaCorrienteCliente(pid)
        .actividades.filter((x) => x.saldo < 0)
        .sort((a, b) =>
          String(a.fechaOrden).localeCompare(String(b.fechaOrden)),
        );

      pendientesAct.forEach((act) => {
        if (restante <= 0) return;
        const pago = Math.min(restante, Math.abs(act.saldo));
        const mov = {
          IDMovimiento:
            "PAGO-LOCAL-" + Date.now() + "-" + movimientosGenerados.length,
          IDCliente: pid,
          IDActividad: act.id,
          IDSuplemento: "",
          Tipo: "Pago",
          Fecha: fecha,
          Hora: hora,
          Monto: pago,
        };
        movimientosGenerados.push(mov);
        backendJobs.push(() =>
          apiPost("registrarPagoActividad", {
            idCliente: pid,
            idActividad: act.id,
            monto: pago,
          }),
        );
        restante -= pago;
      });
    }

    if (aplicarSuplementos) {
      const pendientesSup = getCuentaCorrienteCliente(pid)
        .suplementos.filter((x) => x.saldo < 0)
        .sort((a, b) =>
          String(a.fechaOrden).localeCompare(String(b.fechaOrden)),
        );

      pendientesSup.forEach((sup) => {
        if (restante <= 0) return;
        const pago = Math.min(restante, Math.abs(sup.saldo));
        const idMovimiento =
          "PAGO-SUP-" +
          Date.now() +
          "-" +
          sup.id +
          "-" +
          movimientosGenerados.length;
        const mov = {
          IDMovimiento: idMovimiento,
          IDCliente: pid,
          IDActividad: "",
          IDSuplemento: sup.id,
          Tipo: "Pago",
          Fecha: fecha,
          Hora: hora,
          Monto: pago,
        };
        movimientosGenerados.push(mov);
        backendJobs.push(() =>
          apiPost("registrarMovimiento", {
            idMovimiento: idMovimiento,
            tipo: "Pago",
            idCliente: pid,
            idActividad: "",
            idSuplemento: sup.id,
            monto: pago,
          }),
        );
        restante -= pago;
      });
    }

    if (!movimientosGenerados.length) {
      errorEl.textContent = "No hay deuda pendiente para aplicar.";
      errorEl.classList.remove("hidden");
      submitBtn.disabled = false;
      setSyncStatus("success");
      return;
    }

    if (!cache.abonos) cache.abonos = [];
    if (!cache.movimientos) syncMovimientosFromAbonos();
    cache.abonos.push(...movimientosGenerados);
    cache.movimientos.push(...movimientosGenerados);
    console.log("Movimientos:", cache.movimientos.length);
    console.log("Abonos:", cache.abonos.length);

    console.log("[PAGO] Render personas");
    renderPersonas();
    if (canAccessAdmin()) renderAdmin();
    if (canViewAbonos()) renderAbonos();

    console.log("[PAGO] Render estado cuenta");
    closeModal();
    estadoCuentaActivo = { idCliente: null, nombre: "", vista: "estado" };
    console.log("[PAGO] Modal cerrado");
    showToast("Pago registrado correctamente.");
    console.log("[PAGO] Fin");

    setTimeout(async () => {
      try {
        for (const job of backendJobs) {
          console.log("[PAGO] API enviada");
          await job();
          console.log("[PAGO] API respondida");
        }

        const abonosActualizados = await apiGet("getMovimientos");
        if (abonosActualizados) {
          setAbonosLocal(abonosActualizados);
          console.log("[PAGO] Render personas");
          renderPersonas();
          if (canAccessAdmin()) renderAdmin();
          if (canViewAbonos()) renderAbonos();
          if (
            !document
              .getElementById("modalOverlay")
              .classList.contains("hidden") &&
            estadoCuentaActivo.idCliente === pid
          ) {
            console.log("[PAGO] Render estado cuenta");
            if (estadoCuentaActivo.vista === "movimientos") {
              openEstadoCuentaModal(pid);
              renderEstadoCuentaMovimientos(pid, nombre);
            } else if (
              document.getElementById("modalTitle")?.textContent ===
              "Estado de Cuenta"
            ) {
              openEstadoCuentaModal(pid);
            }
          }
        }

        setSyncStatus("success");
      } catch (e) {
        console.error("Error registrando pago:", e);
        movimientosGenerados.forEach((m) =>
          removeMovimientoLocal(m.IDMovimiento),
        );
        refreshFinancialUI(pid, nombre);
        setSyncStatus("error");
        showErrorModal("Error", "Error registrando pago.");
      }
    }, 0);
  };
}

function openEstadoCuentaModal(idCliente) {
  const pid = String(idCliente || "").trim();
  const esClientePropio =
    currentRole === "CLIENTE" &&
    String(currentUser?.IDCliente || currentUser?.IDAsistencia || "").trim() ===
      pid;
  if (!canViewPersonas() && !esClientePropio) return;

  const cliente = (cache.personas || []).find(
    (p) => String(p.IDCliente || p.IDAsistencia || "").trim() === pid,
  );
  if (!cliente) return;

  const nombre = cliente.Nombre || cliente.Usuario || "-";
  estadoCuentaActivo = { idCliente: pid, nombre: nombre, vista: "estado" };
  const cuenta = getCuentaCorrienteCliente(pid);
  const actividadesActivas = cuenta.actividades;
  const suplementos = cuenta.suplementos;
  const subtotalActividades = actividadesActivas.reduce(
    (s, x) => s + x.saldo,
    0,
  );
  const subtotalSuplementos = suplementos.reduce((s, x) => s + x.saldo, 0);
  const total = subtotalActividades + subtotalSuplementos;

  const row = (item) => `
        <tr>
            <td>${escHtml(item.nombre)}</td>
            <td class="${item.saldo < 0 ? "balance-negative" : "balance-positive"}">${formatMonto(Math.abs(item.saldo))}</td>
        </tr>
    `;

  buildModal(
    "Estado de Cuenta",
    `
        <p class="estado-cuenta-subtitle">${escHtml(nombre)}</p>

        <section class="estado-cuenta-section">
            <h4>Actividades</h4>
            <div class="table-responsive">
                <table class="estado-cuenta-table">
                    <thead><tr><th>Actividad</th><th>Saldo</th></tr></thead>
                    <tbody>
                        ${actividadesActivas.length ? actividadesActivas.map(row).join("") : '<tr><td colspan="2" class="empty-row">Sin actividades activas</td></tr>'}
                    </tbody>
                </table>
            </div>
            <div class="estado-cuenta-subtotal">
                <span>Subtotal Actividades</span>
                <strong class="${subtotalActividades < 0 ? "balance-negative" : "balance-positive"}">${formatMonto(Math.abs(subtotalActividades))}</strong>
            </div>
        </section>

        <section class="estado-cuenta-section">
            <h4>Suplementos</h4>
            <div class="table-responsive">
                <table class="estado-cuenta-table">
                    <thead><tr><th>Suplemento</th><th>Saldo</th></tr></thead>
                    <tbody>
                        ${suplementos.length ? suplementos.map(row).join("") : '<tr><td colspan="2" class="empty-row">Sin suplementos</td></tr>'}
                    </tbody>
                </table>
            </div>
            <div class="estado-cuenta-subtotal">
                <span>Subtotal Suplementos</span>
                <strong class="${subtotalSuplementos < 0 ? "balance-negative" : "balance-positive"}">${formatMonto(Math.abs(subtotalSuplementos))}</strong>
            </div>
        </section>

        <div class="estado-cuenta-resumen">
            <div><span>Actividades</span><strong>${formatMonto(Math.abs(subtotalActividades))}</strong></div>
            <div><span>Suplementos</span><strong>${formatMonto(Math.abs(subtotalSuplementos))}</strong></div>
            <div class="estado-cuenta-total"><span>Total</span><strong>${formatMonto(Math.abs(total))}</strong></div>
        </div>
    `,
    async () => false,
  );

  document.getElementById("btnModalClose").textContent = "Cerrar";
  const btnVerMovimientos = document.getElementById("btnModalSubmit");
  btnVerMovimientos.type = "button";
  btnVerMovimientos.textContent = "Ver Movimientos";
  btnVerMovimientos.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log("[MOV] Boton presionado");
    console.log("[MOV] Cliente recibido", pid);
    renderEstadoCuentaMovimientos(pid, nombre);
  };
  const actions = document.querySelector(".modal-actions");
  if (actions && !document.getElementById("btnExportEstadoCuenta")) {
    const btnExport = document.createElement("button");
    btnExport.id = "btnExportEstadoCuenta";
    btnExport.type = "button";
    btnExport.className = "btn-secondary btn-modal-extra";
    btnExport.textContent = "Exportar";
    btnExport.onclick = () => exportEstadoCuentaPdf(pid);
    actions.insertBefore(btnExport, document.getElementById("btnModalSubmit"));
  }
  if (
    canRegisterPago() &&
    actions &&
    !document.getElementById("btnRegistrarPagoCuenta")
  ) {
    const btn = document.createElement("button");
    btn.id = "btnRegistrarPagoCuenta";
    btn.type = "button";
    btn.className = "btn-secondary btn-modal-extra";
    btn.textContent = "Registrar Pago";
    btn.onclick = () => openRegistrarPagoCuentaModal(pid);
    actions.insertBefore(btn, document.getElementById("btnModalSubmit"));
  }
}

function renderEstadoCuentaMovimientos(idCliente, nombre) {
  const pid = String(idCliente || "").trim();
  estadoCuentaActivo = { idCliente: pid, nombre: nombre, vista: "movimientos" };
  console.log("[MOV] Cliente recibido", pid);
  const resumenPrevio = Array.from(
    document.querySelectorAll(".estado-cuenta-resumen div"),
  ).map((row) => ({
    label: row.querySelector("span")?.textContent || "",
    value: row.querySelector("strong")?.textContent || "$0",
  }));
  const datasetMovimientos = [...getMovimientosContables()];
  (cache.abonos || []).forEach((m) => {
    const id = String(m.IDMovimiento ?? m.IDCarga ?? "");
    const existe = datasetMovimientos.some(
      (a) => String(a.IDMovimiento ?? a.IDCarga ?? "") === id && id,
    );
    if (!existe) datasetMovimientos.push(m);
  });
  console.log("cache.movimientos", cache.movimientos);
  console.log("renderMovimientos dataset", datasetMovimientos);

  const movimientos = datasetMovimientos
    .filter((a) => getMovementClientId(a) === pid)
    .sort((a, b) => {
      const fa = `${a.Fecha || ""} ${a.Hora || ""}`;
      const fb = `${b.Fecha || ""} ${b.Hora || ""}`;
      return fb.localeCompare(fa);
    });
  console.log("[MOV] Movimientos encontrados", movimientos);

  document.getElementById("modalOverlay").classList.remove("hidden");
  document.getElementById("modalTitle").textContent = "Movimientos";
  document.getElementById("modalContent").innerHTML = `
        <p class="estado-cuenta-subtitle">${escHtml(nombre)}</p>
        <div class="movimientos-resumen">
            <div><span>Total Actividades</span><strong>${escHtml(resumenPrevio[0]?.value || "$0")}</strong></div>
            <div><span>Total Suplementos</span><strong>${escHtml(resumenPrevio[1]?.value || "$0")}</strong></div>
            <div><span>Total General</span><strong>${escHtml(resumenPrevio[2]?.value || "$0")}</strong></div>
        </div>
        <div class="table-responsive">
            <table class="estado-cuenta-table estado-cuenta-movimientos">
                <thead>
                    <tr>
                        <th>Fecha</th>
                        <th>Hora</th>
                        <th>Concepto</th>
                        <th>Tipo</th>
                        <th>Monto</th>
                    </tr>
                </thead>
                <tbody>
                    ${
                      movimientos.length
                        ? movimientos
                            .map((a) => {
                              const monto = getMovimientoMonto(a);
                              const tipo = String(a.Tipo || a.tipo || "-");
                              const tipoNorm = tipo.toLowerCase();
                              const tipoClass = tipoNorm.includes("pago")
                                ? "movimiento-pago"
                                : "movimiento-consumo";
                              const hora = formatHoraMovimiento(a.Hora);
                              return `
                            <tr>
                                <td>${escHtml(getMovimientoFecha(a))}</td>
                                <td>${escHtml(hora)}</td>
                                <td>${escHtml(getNombreConcepto(getMovementActivityId(a), getMovementSupplementId(a)))}</td>
                                <td class="${tipoClass}">${escHtml(tipo)}</td>
                                <td class="movimiento-monto ${tipoClass}">${formatMonto(monto)}</td>
                            </tr>
                        `;
                            })
                            .join("")
                        : '<tr><td colspan="5" class="empty-row">Sin movimientos</td></tr>'
                    }
                </tbody>
            </table>
        </div>
    `;
  console.log("[MOV] Modal abierto");
  document.getElementById("btnModalSubmit").classList.add("hidden");
  document.getElementById("btnModalClose").textContent = "Cerrar";
}

function sanitizeFilename(value) {
  return (
    String(value || "Cliente")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "")
      .slice(0, 60) || "Cliente"
  );
}

function pdfEscapeText(text) {
  return String(text ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function makeSimplePdf(lines) {
  const objects = [];
  const addObj = (content) => {
    objects.push(content);
    return objects.length;
  };
  const pages = [];
  const maxLines = 44;
  for (let i = 0; i < lines.length; i += maxLines) {
    pages.push(lines.slice(i, i + maxLines));
  }
  const fontId = addObj(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  );
  const pageIds = [];
  const contentIds = [];
  pages.forEach((pageLines) => {
    const content = [
      "BT",
      "/F1 10 Tf",
      "50 790 Td",
      ...pageLines.map(
        (line, idx) => `${idx ? "0 -16 Td " : ""}(${pdfEscapeText(line)}) Tj`,
      ),
      "ET",
    ].join("\n");
    const contentId = addObj(
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    );
    contentIds.push(contentId);
    const pageId = addObj(
      `<< /Type /Page /Parent 0 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    pageIds.push(pageId);
  });
  const pagesId = addObj(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`,
  );
  pageIds.forEach((id) => {
    objects[id - 1] = objects[id - 1].replace(
      "/Parent 0 0 R",
      `/Parent ${pagesId} 0 R`,
    );
  });
  const catalogId = addObj(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj, idx) => {
    offsets.push(pdf.length);
    pdf += `${idx + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}

function exportEstadoCuentaPdf(idCliente) {
  const pid = String(idCliente || "").trim();
  const cliente = (cache.personas || []).find((p) => getClienteId(p) === pid);
  if (!cliente) return;
  const nombre = cliente.Nombre || cliente.Usuario || pid;
  const cuenta = getCuentaCorrienteCliente(pid);
  const movimientos = [...getMovimientosContables()]
    .filter((m) => getMovementClientId(m) === pid)
    .sort((a, b) =>
      `${getMovimientoFecha(b)} ${b.Hora || ""}`.localeCompare(
        `${getMovimientoFecha(a)} ${a.Hora || ""}`,
      ),
    );
  const lines = [
    "Estado de Cuenta",
    `Cliente: ${nombre}`,
    "",
    "Actividades",
    ...cuenta.actividades.map((a) => `${a.nombre}: ${formatMonto(a.saldo)}`),
    cuenta.actividades.length ? "" : "Sin actividades activas",
    `Subtotal Actividades: ${formatMonto(cuenta.subtotalActividades)}`,
    "",
    "Suplementos",
    ...cuenta.suplementos.map((s) => `${s.nombre}: ${formatMonto(s.saldo)}`),
    cuenta.suplementos.length ? "" : "Sin suplementos",
    `Subtotal Suplementos: ${formatMonto(cuenta.subtotalSuplementos)}`,
    `Saldo Total: ${formatMonto(cuenta.total)}`,
    "",
    "Detalle de movimientos",
    ...movimientos.map(
      (m) =>
        `${getMovimientoFecha(m)} ${formatHoraMovimiento(m.Hora)} | ${getNombreConcepto(getMovementActivityId(m), getMovementSupplementId(m))} | ${m.Tipo || ""} | ${formatMonto(getMovimientoMonto(m))}`,
    ),
  ];
  downloadBlob(
    `EstadoCuenta_${sanitizeFilename(nombre)}.pdf`,
    makeSimplePdf(lines),
    "application/pdf",
  );
}

/* =========================
   16. MODAL HELPER
========================= */

/**
 * Construye y abre el modal generico.
 * @param {string}   title        - Titulo del modal
 * @param {string}   contentHtml  - HTML del cuerpo
 * @param {Function} onSubmit     - Async fn; debe devolver true para cerrar, false para mantener
 */
function buildModal(title, contentHtml, onSubmit) {
  document.getElementById("btnRegistrarPagoCuenta")?.remove();
  document.getElementById("btnExportEstadoCuenta")?.remove();
  document.getElementById("modalTitle").textContent = title;
  document.getElementById("modalContent").innerHTML = contentHtml;
  document.getElementById("btnModalClose").textContent = "Cerrar";
  document.getElementById("btnModalClose").classList.remove("hidden");
  document.getElementById("btnModalSubmit").textContent = "Guardar";
  document.getElementById("btnModalSubmit").classList.remove("hidden");
  document.getElementById("modalOverlay").classList.remove("hidden");

  document.getElementById("btnModalSubmit").onclick = async () => {
    const result = await withLoader(() => onSubmit());
    if (result === true) closeModal();
  };
}

function closeModal() {
  document.getElementById("modalOverlay").classList.add("hidden");
  document.getElementById("btnModalSubmit").onclick = null;
}

function showToast(mensaje, tipo = "success") {
  let toast = document.getElementById("gymproToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "gymproToast";
    toast.className = "gympro-toast hidden";
    document.body.appendChild(toast);
  }
  toast.textContent = mensaje;
  toast.className = `gympro-toast gympro-toast-${tipo}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 2200);
}

function showInfoModal(titulo, mensaje) {
  buildModal(
    titulo,
    `<p class="gympro-modal-message">${escHtml(mensaje)}</p>`,
    async () => true,
  );
  document.getElementById("btnModalClose").classList.add("hidden");
  document.getElementById("btnModalSubmit").textContent = "Aceptar";
}

function showErrorModal(titulo, mensaje) {
  buildModal(
    titulo,
    `<p class="gympro-modal-message error-text">${escHtml(mensaje)}</p>`,
    async () => true,
  );
  document.getElementById("btnModalClose").classList.add("hidden");
  document.getElementById("btnModalSubmit").textContent = "Aceptar";
}

function showConfirmModal(titulo, mensaje, onAccept) {
  buildModal(
    titulo,
    `<p class="gympro-modal-message">${escHtml(mensaje)}</p>`,
    async () => {
      if (typeof onAccept === "function") {
        const result = await onAccept();
        return result !== false;
      }
      return true;
    },
  );
  document.getElementById("btnModalClose").textContent = "Cancelar";
  document.getElementById("btnModalSubmit").textContent = "Aceptar";
}

/* =========================
   17. UTILIDADES
========================= */

function fillClienteAbonosFilter() {
  const sel = document.getElementById("clienteAbonosFilter");
  if (!sel) return;

  const personas = [...(cache.personas || [])].sort((a, b) =>
    (a.Nombre || "").localeCompare(b.Nombre || ""),
  );

  sel.innerHTML = `
        <option value="">Cliente: Todos</option>
        ${personas
          .map(
            (p) => `
            <option value="${p.IDCliente}">
                ${escHtml(p.Nombre)}
            </option>
        `,
          )
          .join("")}
    `;
}

function getFechaAsistencia(row) {
  if (!row) return null;

  let fecha = row.Fecha || row["Fecha"];
  let hora = row.Hora || row["Hora"];

  //  convertir fecha
  if (fecha instanceof Date) {
    fecha = fecha.toISOString().split("T")[0];
  } else {
    fecha = String(fecha).split("T")[0];
  }

  //  convertir hora
  if (hora instanceof Date) {
    hora = hora.toTimeString().split(" ")[0];
  } else if (hora) {
    hora = String(hora).split("T").pop().split(" ")[0];
  } else {
    hora = "00:00:00";
  }

  return `${fecha} ${hora}`;
}

function getSaldoPersona(pid) {
  if (!pid) return 0;

  const id = String(pid).trim();

  return (cache.abonos || []).reduce((sum, a) => {
    const aPid = String(a.IDCliente ?? a.Persona ?? "").trim();
    if (aPid !== id) return sum;

    const monto = parseFloat(a.Monto ?? a.monto ?? 0);
    return sum + (isNaN(monto) ? 0 : monto);
  }, 0);
}

function getSaldosPorActividad(pid) {
  const id = String(pid).trim();
  const saldos = {};

  (cache.abonos || []).forEach((a) => {
    const aPid = String(a.IDCliente || a.Persona || "").trim();
    if (aPid !== id) return;

    const act = String(a.IDActividad || a.Servicio || "").trim();

    const monto = Number(a.Monto ?? a.monto ?? 0);

    if (isNaN(monto)) return;

    if (!saldos[act]) saldos[act] = 0;

    saldos[act] += monto;
  });

  return saldos;
}

function getNombreConcepto(idServ, txtSup) {
  // 1. Buscar en suplementos si viene un ID
  if (txtSup) {
    const sup = (cache.suplementos || []).find(
      (x) => String(x.IDSuplemento).trim() === String(txtSup).trim(),
    );
    return sup ? sup.Nombre : String(txtSup);
  }

  // 2. Si no hay nada, es un abono general
  if (!idServ) return "Abono";

  // 3. Buscar en Servicios / Actividades
  const s = (cache.servicios || []).find(
    (x) =>
      String(x.IDServicios).trim() === String(idServ).trim() ||
      String(x.IDActividad).trim() === String(idServ).trim(),
  );

  return s ? s.Nombre : String(idServ);
}

function getNombrePersona(pid) {
  if (!pid) return "-";
  if (
    currentUser &&
    String(currentUser.IDCliente || currentUser.IDAsistencia) === String(pid)
  ) {
    return currentUser.Nombre || currentUser.Usuario;
  }
  const p = (cache.personas || []).find(
    (x) => String(x.IDCliente || x.IDAsistencia) === String(pid),
  );
  return p ? p.Nombre || p.Usuario : pid;
}

function getNombreActividad(id) {
  const s = (cache.servicios || []).find(
    (x) => String(x.IDActividad || x.IDServicios) === String(id),
  );
  return s ? s.Nombre : id;
}

function verUltimaAsistencia(documento, usuario) {
  if (!documento) {
    showErrorModal(
      "Documento faltante",
      "Esta persona no tiene documento registrado.",
    );
    return;
  }

  const persona = (cache.personas || []).find(
    (p) => String(p.Documento || "").trim() === String(documento).trim(),
  );

  if (!persona) {
    showErrorModal(
      "Persona no encontrada",
      `Asistencia: ${usuario}\n\nPersona no encontrada.`,
    );
    return;
  }

  // NORMALIZACION CRITICA DEL ID
  const pid = String(persona.IDCliente || persona.IDAsistencia || "").trim();

  const asistencias = (cache.asistencias || []).filter((a) => {
    const idAsistencia = String(a.IDCliente || "").trim();
    return idAsistencia === pid && idAsistencia !== "";
  });

  if (!asistencias.length) {
    showInfoModal(
      "Sin asistencias",
      `Asistencia: ${usuario}\n\nSin asistencias registradas.\nID buscado: ${pid}`,
    );
    return;
  }

  function fix(x) {
    let f = x.Fecha;
    let h = x.Hora;
    const pad = (n) => String(n).padStart(2, "0");

    if (f instanceof Date) {
      f = `${f.getFullYear()}-${pad(f.getMonth() + 1)}-${pad(f.getDate())}`;
    } else {
      f = String(f).split("T")[0];
    }

    if (h instanceof Date) {
      // Extrae hora local para ignorar el desvio de fecha base 1899 de Sheets
      h = `${pad(h.getHours())}:${pad(h.getMinutes())}:${pad(h.getSeconds())}`;
    } else {
      h = String(h).includes("T")
        ? String(h).split("T")[1].split(".")[0]
        : String(h);
    }

    return `${f.trim()} ${h.trim()}`;
  }

  const ultima = asistencias.sort((a, b) => {
    return fix(b).localeCompare(fix(a));
  })[0];

  showInfoModal(
    "Ultima asistencia",
    `Asistencia: ${usuario}\n\nUltima asistencia:\n${fix(ultima)}`,
  );
}

function showLoader(show) {
  document.getElementById("loader").classList.toggle("hidden", !show);
}

/** Alterna entre tema claro y oscuro, guarda en localStorage. */
function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute("data-theme") || "dark";
  const next = current === "dark" ? "light" : "dark";

  html.setAttribute("data-theme", next);
  localStorage.setItem("gymTheme", next);

  const btn = document.getElementById("btnTheme");
  if (btn) btn.textContent = next === "dark" ? "🌙" : "☀️";
}

function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove("hidden");
}
function clearMsg(el) {
  el.textContent = "";
  el.className = "hidden";
}

/** Formatea monto con separador de miles. */
/** Formatea monto sin decimales y con separador de miles ($45.000 / $-12.000) */
function formatMonto(n) {
  if (isNaN(n)) return "$0";
  const val = Math.round(n);
  const abs = Math.abs(val)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return (val < 0 ? "$-" : "$") + abs;
}

/** ISO date -> dd/mm/aaaa */
function formatFecha(valor) {
  if (!valor) return "-";
  let d = new Date(valor.replace(" ", "T"));
  if (isNaN(d.getTime())) {
    const str = String(valor).replace(" ", "T");
    d = new Date(str);
    if (isNaN(d.getTime())) return String(valor);
  }
  return d.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** ISO date -> dd/mm/aaaa HH:MM:SS */
function formatFechaHora(valor) {
  if (!valor) return "-";
  let d = new Date(valor.replace(" ", "T"));
  if (isNaN(d.getTime())) {
    const str = String(valor).replace(" ", "T");
    d = new Date(str);
    if (isNaN(d.getTime())) return String(valor);
  }
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}:${ss}`;
}

/** Escapa HTML para prevenir XSS en atributos inline. */
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Normaliza un string (trim + lowercase) para comparaciones. */
function norm(str) {
  return String(str || "")
    .trim()
    .toLowerCase();
}

/**
 * Auto-genera IDAsistencia con formato "Persona0001".
 * Toma el maximo numero existente en cache.personas y suma 1.
 */
function generateId() {
  let max = 0;
  (cache.personas || []).forEach((p) => {
    const m = String(p.IDCliente || p.IDAsistencia || "").match(/(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return `CLI${String(max + 1).padStart(4, "0")}`;
}

async function openNuevaActividadModal(idCliente, nombreUsuario) {
  let actividades = cache.servicios;

  if (!actividades || !actividades.length) {
    actividades = await apiGet("getActividades");
    cache.servicios = actividades || [];
  }

  buildModal(
    `Anadir Actividad: ${escHtml(nombreUsuario)}`,
    `
        <div class="form-group">
            <label>Seleccionar Actividad</label>
            <select id="naActividad">
                <option value="">- Seleccionar -</option>
                ${actividades
                  .map(
                    (a) => `
                    <option value="${escHtml(String(a.IDActividad || a.IDServicios))}">
                        ${escHtml(a.Nombre)}
                    </option>
                `,
                  )
                  .join("")}
            </select>
        </div>
    `,
    () => {
      const actId = document.getElementById("naActividad").value;

      if (!actId) {
        showErrorModal("Actividad requerida", "Selecciona una actividad");
        return false;
      }

      const yaInscrito = (cache.inscripciones || []).some(
        (i) =>
          String(i.IDCliente) === String(idCliente) &&
          String(i.Actividad) === String(actId) &&
          String(i.Estado).toUpperCase() === "ACTIVO",
      );

      if (yaInscrito) {
        showInfoModal(
          "Actividad existente",
          "El cliente ya se encuentra inscripto en esta actividad.",
        );
        return false;
      }

      const now = new Date();
      const fecha = now.toISOString().split("T")[0];

      const nueva = {
        IDInscripcion: "INS-" + Date.now(),
        IDCliente: idCliente,
        Actividad: actId,
        FechaInicio: fecha,
        Estado: "ACTIVO",
        FechaFin: "",
      };

      //  UI inmediata (inscripcion)
      if (!cache.inscripciones) cache.inscripciones = [];
      cache.inscripciones.push(nueva);

      //  BUSCAR SERVICIO CORRECTAMENTE (FIX REAL)
      const servicios = cache.servicios || [];

      const serv = servicios.find(
        (s) =>
          String(s.IDActividad || s.IDServicios).trim() ===
          String(actId).trim(),
      );

      if (!serv) {
        console.error("NO ENCUENTRA SERVICIO", actId, servicios);
      } else {
        if (!cache.abonos) cache.abonos = [];

        const monto = -Math.abs(parseFloat(serv.Precios || serv.Precio || 0));

        // limpiar duplicados
        setAbonosLocal(
          (cache.abonos || []).filter(
            (a) =>
              !(
                String(a.IDCliente) === String(idCliente) &&
                String(a.IDActividad) === String(actId)
              ),
          ),
        );

        // insertar deuda inmediata
        const now = new Date();
        addMovimientoLocal({
          IDMovimiento: "TMP-" + Date.now(),
          IDCliente: idCliente,
          IDActividad: actId,
          Monto: monto,
          Fecha: now.toISOString().split("T")[0], // ej: "2026-04-21"
          Hora: now.toTimeString().split(" ")[0], // ej: "10:11:33"
        });
      }

      //  render instantaneo
      renderPersonas();

      //  backend async SIN tocar cache
      apiPost("agregarInscripcion", {
        idInscripcion: nueva.IDInscripcion,
        idCliente: idCliente,
        actividad: nueva.Actividad,
        fechaInicio: fecha,
        estado: "ACTIVO",
      })
        .then(async () => {
          await new Promise((r) => setTimeout(r, 800));

          const nuevos = (await apiGet("getMovimientos")) || [];

          if (nuevos.length > 0) {
            setAbonosLocal(nuevos);
            renderPersonas();
          }
        })
        .catch((e) => {
          console.error("Error backend:", e);
        });

      return true;
    },
  );
}

async function syncAbonosSilent() {
  try {
    const data = await apiGet("getMovimientos");

    if (data && data.length > 0) {
      setAbonosLocal(data);
    }

    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}
