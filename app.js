/* ===================================================================
   app.js — GymPRO Frontend
   Vanilla JS SPA · Google Apps Script backend
   ─────────────────────────────────────────
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
const API_URL = "https://script.google.com/macros/s/AKfycbwdD5iMI01C32X1e5SEX3sc-pEwn7WTFvKVhJ0cwW6ULXHOwHZG7oqVXoVl3dNtfNHnyA/exec";
const API_KEY = "GYM_PRO_2026";

const OWNER_EMAIL = "encargado@gmail.com";
const PROFESSOR_EMAILS = [
    "profesor1@gym.com",
    "profesor2@gym.com"
];

/*
 * Columnas reales:
 *   Personas : IDAsistencia | Fecha | Usuario | Documento | Mail | Dirección | Actividad
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

/* =========================
   2. CACHE
========================= */
const cache = {
    personas: null,
    abonos: null,
    servicios: null,
    suplementos: null,
    asistencias: null,
    clear() { this.personas = this.abonos = this.servicios = this.suplementos = this.asistencias = null; }
};

/* =========================
   3. API CLIENT
========================= */
async function apiGet(action, params = {}) {
    // Aseguramos que action y key siempre estén en los parámetros de la URL
    const combinedParams = {
        action: action,
        key: API_KEY, // GYM_PRO_2026
        ...params
    };
    // Construcción manual de query string para máxima compatibilidad con Google Apps Script
    const queryString = Object.entries(combinedParams)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
    let res;
    try {
        const finalUrl = `${API_URL}?${queryString}`;
        res = await fetch(finalUrl, { method: 'GET' });
    } catch (e) {
        console.error('[Network Error GET]', e);
        throw new Error('No se pudo conectar con el servidor.');
    }
    const text = await res.text();
    let json;
    try {
        json = JSON.parse(text);
    } catch (e) {
        console.error('[Parse Error GET]', text);
        throw new Error('El servidor devolvió una respuesta inválida.');
    }
    if (!json.ok) throw new Error(json.error || 'Error GET ' + action);
    return json.data;
}





async function apiPost(action, data = {}) {
    let res;
    try {
        res = await fetch(API_URL, {
            method: 'POST', mode: 'cors',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ action, key: API_KEY, ...data })
        });
    } catch (e) {
        console.error('[Network Error POST]', e);
        throw new Error('No se pudo conectar con el servidor.');
    }

    const text = await res.text();
    let json;
    try {
        json = JSON.parse(text);
    } catch (e) {
        console.error('[Parse Error POST]', text);
        throw new Error('El servidor devolvió una respuesta inválida.');
    }

    if (!json.ok) throw new Error(json.error || 'Error POST ' + action);
    return json.data;
}






async function withLoader(fn) {
    showLoader(true);
    try { return await fn(); }
    catch (e) { console.error('[API]', e); alert('Error: ' + e.message); return null; }
    finally { showLoader(false); }
}

/* =========================
   4. ROLE PERMISSIONS
========================= */
const canViewAbonos = () => currentRole === 'OWNER' || currentRole === 'CLIENTE';
const canViewPersonas = () => currentRole === 'OWNER' || currentRole === 'PROFESOR';
const canAccessAdmin = () => currentRole === 'OWNER';
const canRegisterConsumo = () => currentRole === 'OWNER' || currentRole === 'PROFESOR';
const canRegisterPago = () => currentRole === 'OWNER';
const canRegisterAsistencia = () => currentRole === 'OWNER' || currentRole === 'PROFESOR';
const canSaldarActividad = () => currentRole === 'OWNER' || currentRole === 'PROFESOR';
const canAgregarPersona = () => currentRole === 'OWNER';

/* =========================
   5. AUTH / LOGIN
========================= */
function goToLoginChoice() { showOnlyView('loginChoiceView'); }



















/* —— CLIENTE —— */
async function handleLoginCliente(e) {
    if (e) e.preventDefault();
    const dniInput = document.getElementById('clienteDniInput');
    const dni = dniInput ? dniInput.value.trim() : '';
    const errorEl = document.getElementById('loginClienteError');
    if (errorEl) errorEl.classList.add('hidden');

    if (!dni) {
        alert("Por favor, ingresá un DNI.");
        return;
    }

    // PASO 1: Autenticación Rápida (< 1 segundo)
    await withLoader(async () => {
        const clienteFound = await apiGet('loginCliente', { documento: dni });

        if (!clienteFound) {
            alert('DNI no encontrado. Verificá que estés registrado en la pestaña Clientes.');
            return;
        }

        // Acceso inmediato al perfil con el objeto cliente
        currentUser = clienteFound;
        currentRole = 'CLIENTE';

        setupNavbar();
        renderProfile(); // Renderiza el perfil inicial (sin datos pesados aún)
        enterApp('perfilView');

        // PASO 2: Carga asíncrona de datos pesados (en segundo plano)
        fetchBackgroundData(dni);
    });
}

/**
 * Carga los datos pesados (abonos, asistencias, etc.) sin bloquear la UI.
 */
async function fetchBackgroundData(dni) {
    try {
        const data = await apiGet('getFullDataByDocumento', { documento: dni });
        if (data) {
            cache.abonos = data.abonos || [];
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



















/* —— STAFF —— */
/* —— STAFF (Login Local y Pantalla Asistencia Reparada) —— */
async function handleLoginStaff(e) {
    if (e) e.preventDefault();
    const emailInput = document.getElementById('staffEmailInput');
    const email = emailInput ? emailInput.value.trim().toLowerCase() : '';
    const errorEl = document.getElementById('loginStaffError');
    if (errorEl) errorEl.classList.add('hidden');

    // 1. LOGIN STAFF LOCAL (frontend)
    if (email === OWNER_EMAIL.toLowerCase()) {
        currentRole = 'OWNER';
    } else if (PROFESSOR_EMAILS.map(em => em.toLowerCase()).includes(email)) {
        currentRole = 'PROFESOR';
    } else {
        if (errorEl) { errorEl.textContent = 'Email no autorizado como Staff.'; errorEl.classList.remove('hidden'); }
        return;
    }

    currentUser = { Nombre: email.split('@')[0], Mail: email };

    await withLoader(async () => {
        // Carga de tablas completa para Staff usando nuevos endpoints
        const [pers, abos, acts, sups] = await Promise.all([
            apiGet('getClientes'),
            apiGet('getAbonos'),
            apiGet('getActividades'),
            apiGet('getSuplementos')
        ]);

        cache.personas = Array.isArray(pers) ? pers : [];
        cache.abonos = Array.isArray(abos) ? abos : [];
        cache.actividades = Array.isArray(acts) ? acts : [];
        cache.suplementos = Array.isArray(sups) ? sups : [];

        setupNavbar();
        if (currentRole === 'OWNER') {
            renderAdmin();
            enterApp('adminPanelView');
        } else {
            renderPersonas();
            enterApp('personasView');
        }
    });
}

/**
 * Registra asistencia rápida utilizando loginCliente (validación ligera).
 */
async function handleRegistrarAsistencia(e) {
    if (e) e.preventDefault();
    if (!canRegisterAsistencia()) return;
    const dniInput = document.getElementById('asistenciaDni');
    const dni = dniInput ? dniInput.value.trim() : '';
    const msgEl = document.getElementById('asistenciaMsg');

    if (!dni) return;

    await withLoader(async () => {
        // Paso 1: Validar cliente (Rápido)
        const cliente = await apiGet('loginCliente', { documento: dni });
        if (!cliente) {
            showAsistenciaMsg(msgEl, `DNI NO ENCONTRADO`, `DNI: ${dni}`, 'res-danger');
            startAsistenciaReset(dniInput, msgEl);
            return;
        }

        // Paso 2: Registrar Asistencia
        await apiPost('registrarAsistencia', { IDCliente: cliente.IDCliente });

        // Paso 3: Feedback inmediato y verificación de saldo total
        const saldoTotal = getSaldoPersona(cliente.IDCliente);

        let title = `✔ SIN DEUDA`;
        let sub = cliente.Nombre.toUpperCase();
        let cls = "res-success";

        if (saldoTotal < 0) {
            title = `⚠️ DEUDA ACTUAL`;
            sub = formatMonto(saldoTotal);
            cls = "res-danger";
        } else if (saldoTotal > 0) {
            title = `💰 SALDO A FAVOR`;
            sub = formatMonto(saldoTotal);
            cls = "res-info";
        }

        showAsistenciaMsg(msgEl, title, sub, cls);
        startAsistenciaReset(dniInput, msgEl);
    });
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
    el.classList.remove('hidden');
}

/**
 * Resetea la pantalla de asistencia después de 2 segundos.
 */
function startAsistenciaReset(input, msg) {
    input.value = '';
    // Reducimos a 2 segundos exactos para agilidad
    setTimeout(() => {
        msg.style.opacity = '0'; // Efecto fade out
        msg.style.transition = 'opacity 0.3s ease';

        setTimeout(() => {
            msg.classList.add('hidden');
            msg.style.opacity = '1';
            input.focus();
        }, 300);
    }, 2000);
}



// Mejora UX: Si el usuario hace click afuera, el foco vuelve al input automáticamente
document.addEventListener('click', () => {
    const input = document.getElementById('asistenciaDni');
    const view = document.getElementById('asistenciaView');
    if (view && !view.classList.contains('hidden')) {
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
    document.getElementById('mainHeader').classList.remove('hidden');
    showView(viewId);
}

/* =========================
   6. NAVBAR SETUP
========================= */
function setupNavbar() {
    ['btnAbonos', 'btnPersonas', 'btnAsistencia', 'btnAdmin'].forEach(
        id => document.getElementById(id).classList.add('hidden')
    );
    if (canViewAbonos()) document.getElementById('btnAbonos').classList.remove('hidden');
    if (canViewPersonas()) document.getElementById('btnPersonas').classList.remove('hidden');
    if (canRegisterAsistencia()) document.getElementById('btnAsistencia').classList.remove('hidden');
    if (canAccessAdmin()) document.getElementById('btnAdmin').classList.remove('hidden');
    document.getElementById('btnNewAbono').classList.toggle('hidden', !canRegisterPago());

    const nombre = currentUser.Nombre || currentUser.Usuario || currentUser.Mail || 'Usuario';
    document.getElementById('userNameDisplay').textContent = nombre;
    document.getElementById('userMailDisplay').textContent = currentUser.Mail || '';
    document.getElementById('userRoleBadge').textContent = currentRole;
    document.getElementById('userAvatar').textContent = nombre.charAt(0).toUpperCase();
}

/* =========================
   7. ROUTER
========================= */
const ROUTE_GUARDS = {
    perfilView: () => true,
    abonosView: canViewAbonos,
    personasView: canViewPersonas,
    asistenciaView: canRegisterAsistencia,
    adminPanelView: canAccessAdmin,
    accessDeniedView: () => true
};

function showView(viewId) {
    const guard = ROUTE_GUARDS[viewId];
    if (guard && !guard()) { showOnlyView('accessDeniedView'); return; }
    showOnlyView(viewId);
}
function showOnlyView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    const t = document.getElementById(viewId);
    if (t) t.classList.remove('hidden');
}

/* =========================
   8. INITIALIZATION
========================= */
document.addEventListener('DOMContentLoaded', () => {

    /* Inicializar tema */
    const savedTheme = localStorage.getItem('gymTheme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    const btnTheme = document.getElementById('btnTheme');
    if (btnTheme) btnTheme.textContent = savedTheme === 'dark' ? '🌙' : '☀️';

    /* Login choice */
    document.getElementById('btnChoiceAlumno').addEventListener('click', () => showOnlyView('loginClienteView'));
    document.getElementById('btnChoiceStaff').addEventListener('click', () => showOnlyView('loginStaffView'));
    document.getElementById('btnBackFromCliente').addEventListener('click', goToLoginChoice);
    document.getElementById('btnBackFromStaff').addEventListener('click', goToLoginChoice);
    document.getElementById('loginClienteForm').addEventListener('submit', handleLoginCliente);
    document.getElementById('loginStaffForm').addEventListener('submit', handleLoginStaff);

    /* Logout (CORREGIDO) */
    document.getElementById('btnLogout').addEventListener('click', () => {

        // Limpiar sesión
        currentUser = null;
        currentRole = null;

        // Limpiar cache SIN reasignar
        if (cache) {
            cache.abonos = [];
            cache.asistencias = [];
            cache.actividades = [];
            cache.suplementos = [];
            cache.inscripciones = [];
            cache.personas = [];
        }

        // Limpiar inputs
        const dInput = document.getElementById('clienteDniInput');
        const eInput = document.getElementById('staffEmailInput');
        if (dInput) dInput.value = '';
        if (eInput) eInput.value = '';

        // Reset UI
        document.getElementById('mainHeader').classList.add('hidden');

        // Volver al inicio SIEMPRE
        enterApp('loginChoiceView');
    });

    /* Navegación */
    document.getElementById('btnPerfil').addEventListener('click', () => {
        renderProfile();
        showView('perfilView');
    });

    document.getElementById('btnAbonos').addEventListener('click', () => {
        if (!canViewAbonos()) return;
        filterAbonos();
        showView('abonosView');
    });

    document.getElementById('btnPersonas').addEventListener('click', () => {
        if (!canViewPersonas()) return;
        filterPersonas();
        showView('personasView');
    });

    document.getElementById('btnAsistencia').addEventListener('click', () => {
        if (!canRegisterAsistencia()) return;
        resetAsistencia();
        showView('asistenciaView');
    });

    document.getElementById('btnAdmin').addEventListener('click', () => {
        if (!canAccessAdmin()) return;
        renderAdmin();
        showView('adminPanelView');
    });

    /* Búsqueda y filtros */
    document.getElementById('searchPersonas').addEventListener('input', filterPersonas);
    document.getElementById('saldoFilter').addEventListener('change', filterPersonas);

    document.getElementById('searchAbonos').addEventListener('input', filterAbonos);
    document.getElementById('tipoAbonosFilter').addEventListener('change', filterAbonos);
    document.getElementById('ordenAbonosFilter').addEventListener('change', filterAbonos);

    /* Asistencia */
    document.getElementById('asistenciaForm').addEventListener('submit', handleRegistrarAsistencia);

    /* Admin */
    document.getElementById('btnNewAbono').addEventListener('click', openPagoModal);
    document.getElementById('btnGenDeudas').addEventListener('click', handleGenerarDeudas);
    document.getElementById('btnAddUser').addEventListener('click', openNuevaPersonaModal);

    /* Modal */
    document.getElementById('btnModalClose').addEventListener('click', closeModal);
});

/* =========================
   9. VISTA: PERFIL
========================= */
function renderProfile() {
    if (!currentUser) return;
    document.getElementById('userActivityDisplay').textContent = currentUser.Actividad || 'Ninguna';

    const saldoStat = document.getElementById('saldoStat');
    const movCard = document.getElementById('movimientosCard');
    const asisCard = document.getElementById('asistenciasCard');

    if (currentRole === 'PROFESOR') {
        saldoStat.classList.add('hidden');
        movCard.classList.add('hidden');
        if (asisCard) asisCard.classList.add('hidden');
        return;
    }
    saldoStat.classList.remove('hidden');
    movCard.classList.remove('hidden');
    if (asisCard) asisCard.classList.remove('hidden');

    const pid = String(currentUser.IDCliente || currentUser.idcliente || currentUser.IDAsistencia || '');
    const misAbonos = (cache.abonos || []).filter(
        a => String(a.Persona || '').trim() === pid
    );
    const saldo = misAbonos.reduce((s, a) => s + (parseFloat(a.monto) || 0), 0);
    const balEl = document.getElementById('userBalanceDisplay');
    balEl.textContent = formatMonto(saldo);
    balEl.className = saldo >= 0 ? 'balance-positive' : 'balance-negative';

    const tbody = document.querySelector('#userMovementsTable tbody');
    tbody.innerHTML = misAbonos.length
        ? [...misAbonos].reverse().map(a => `
            <tr>
                <td>${formatFechaHora(a['Fecha y hora'])}</td>
                <td>${escHtml(getNombreConcepto(a.Servicio, a.Suplemento))}</td>
                <td class="${parseFloat(a.monto) < 0 ? 'balance-negative' : 'balance-positive'}">
                    ${formatMonto(parseFloat(a.monto || 0))}
                </td>
            </tr>`).join('')
        : '<tr><td colspan="3" class="empty-row">Sin movimientos registrados</td></tr>';

    const asisTbody = document.querySelector('#userAsistenciasTable tbody');
    if (asisTbody) {
        const misAsistencias = [...(cache.asistencias || [])]
            .sort((a, b) => {
                const fa = getFechaAsistencia(a);
                const fb = getFechaAsistencia(b);
                return new Date(fb) - new Date(fa);
            })
            .slice(0, 5);
        asisTbody.innerHTML = misAsistencias.length
            ? misAsistencias.map(a => `<tr><td>${formatFechaHora(getFechaAsistencia(a))}</td></tr>`).join('')
            : '<tr><td class="empty-row">Sin asistencias registradas</td></tr>';
    }
}

/* =========================
   10. VISTA: ABONOS
========================= */
function renderAbonos(lista = null) {
    if (!canViewAbonos()) { showView('accessDeniedView'); return; }
    const tbody = document.querySelector('#abonosTable tbody');
    let data = lista || cache.abonos || [];

    if (!lista) {
        data = [...data].reverse();
    }

    tbody.innerHTML = data.length
        ? data.map(a => `
            <tr>
                <td class="mono">${escHtml(a.IDCarga || '-')}</td>
                <td>${formatFechaHora(a['Fecha y hora'])}</td>
                <td class="mono">${escHtml(getNombrePersona(a.Persona))}</td>
                <td>${escHtml(getNombreConcepto(a.Servicio, a.Suplemento))}</td>
                <td class="${parseFloat(a.monto) < 0 ? 'balance-negative' : 'balance-positive'}">
                    ${formatMonto(parseFloat(a.monto || 0))}
                </td>
            </tr>`).join('')
        : '<tr><td colspan="5" class="empty-row">Sin movimientos</td></tr>';
}

function filterAbonos() {
    const q = document.getElementById('searchAbonos').value.toLowerCase();
    const type = document.getElementById('tipoAbonosFilter').value;
    const order = document.getElementById('ordenAbonosFilter').value;

    let lista = [...(cache.abonos || [])];

    if (type === 'actividad') {
        lista = lista.filter(a => !!a.Servicio);
    } else if (type === 'suplementos') {
        lista = lista.filter(a => !!a.Suplemento);
    }

    if (q) {
        lista = lista.filter(a => {
            const nomPer = getNombrePersona(a.Persona).toLowerCase();
            const nomCon = getNombreConcepto(a.Servicio, a.Suplemento).toLowerCase();
            return nomPer.includes(q) || nomCon.includes(q);
        });
    }

    lista.sort((a, b) => {
        const d1 = new Date(a['Fecha y hora']);
        const d2 = new Date(b['Fecha y hora']);
        if (order === 'recientes') {
            return d2 - d1;
        } else {
            return d1 - d2;
        }
    });

    renderAbonos(lista);
}

/* =========================
   11. VISTA: PERSONAS
========================= */
function renderPersonas(lista = null) {
    if (!canViewPersonas()) { showView('accessDeniedView'); return; }
    const data = lista || cache.personas || [];
    const tbody = document.querySelector('#personasTable tbody');

    tbody.innerHTML = data.length
        ? data.map(p => {
            const pid = escHtml(p.IDCliente || p.IDAsistencia || '');
            const usu = escHtml(p.Nombre || p.Usuario || '');
            const act = escHtml(p.Activo || p.Actividad || '');

            const btnConsumo = canRegisterConsumo()
                ? `<button class="btn-item" onclick="openConsumoModal('${usu}','${pid}')">Consumo</button>`
                : '';
            const btnSaldar = canSaldarActividad() && p.Actividad
                ? `<button class="btn-item btn-item-warn" onclick="saldarActividad('${pid}','${act}')">Saldar actividad</button>`
                : '';
            const btnAsistencia = canRegisterAsistencia()
                ? `<button class="btn-item btn-item-info" onclick="verUltimaAsistencia('${escHtml(String(p.Documento || ''))}', '${usu}')">Última asistencia</button>`
                : '';

            const saldo = getSaldoPersona(pid);
            let saldoCls = 'mono';
            if (saldo < 0) saldoCls += ' balance-negative';
            else if (saldo > 0) saldoCls += ' balance-positive';
            let saldoStr = formatMonto(saldo);
            if (saldo === 0) saldoStr = '$0';
            else if (saldo > 0) saldoStr = '+' + saldoStr;

            return `<tr>
                <td class="mono">${escHtml(String(p.Documento || '-'))}</td>
                <td>${usu}</td>
                <td>${act || '-'}</td>
                <td class="${saldoCls}" style="font-weight:bold;">${saldoStr}</td>
                <td class="actions-cell">${btnConsumo}${btnSaldar}${btnAsistencia}</td>
            </tr>`;
        }).join('')
        : '<tr><td colspan="5" class="empty-row">Sin personas registradas</td></tr>';
}

function filterPersonas() {
    const q = document.getElementById('searchPersonas').value.toLowerCase();
    const sf = document.getElementById('saldoFilter').value;

    renderPersonas((cache.personas || []).filter(p => {
        const textMatch = (p.Nombre || p.Usuario || '').toLowerCase().includes(q) ||
            String(p.Documento || '').includes(q);
        if (!textMatch) return false;

        if (sf !== 'todos') {
            const saldo = getSaldoPersona(p.IDCliente || p.IDAsistencia);
            if (sf === 'deuda' && saldo >= 0) return false;
            if (sf === 'al_dia' && saldo !== 0) return false;
            if (sf === 'favor' && saldo <= 0) return false;
        }
        return true;
    }));
}

/* =========================
   12. VISTA: ASISTENCIA
========================= */
function resetAsistencia() {
    document.getElementById('asistenciaDni').value = '';
    const el = document.getElementById('asistenciaMsg');
    el.className = 'hidden'; el.innerHTML = '';
}

async function handleRegistrarAsistencia(e) {
    e.preventDefault();
    if (!canRegisterAsistencia()) return;
    const dni = document.getElementById('asistenciaDni').value.trim();
    const msgEl = document.getElementById('asistenciaMsg');
    clearMsg(msgEl);
    if (!dni) return;

    await withLoader(async () => {
        let personas = cache.personas;
        if (!personas) {
            personas = (await apiGet('getPersonas')) || [];
            cache.personas = personas;
        }
        const persona = personas.find(p => String(p.Documento || '').trim() === dni);
        if (!persona) {
            showAsistenciaMsg(msgEl, `❌ No se encontró ningún alumno con DNI ${escHtml(dni)}.`, true);
            return;
        }
        await apiPost('registrarAsistencia', {
            idAsistencia: 'ASI-' + Date.now(),
            documento: persona.Documento,
            idCliente: persona.IDCliente || persona.IDAsistencia,
            usuario: persona.Nombre || persona.Usuario
        });
        showAsistenciaMsg(msgEl, `✅ Asistencia de <strong>${escHtml(persona.Nombre || persona.Usuario)}</strong> registrada.`, false);
        document.getElementById('asistenciaDni').value = '';
    });
}

function showAsistenciaMsg(el, html, esError) {
    el.innerHTML = html;
    el.className = esError ? 'error-text' : 'info-text';
}

/* =========================
   13. VISTA: ADMIN
========================= */
function renderAdmin() {
    if (!canAccessAdmin()) { showView('accessDeniedView'); return; }
    document.getElementById('totalPersonasCount').textContent = (cache.personas || []).length;
    document.getElementById('totalAbonosCount').textContent = (cache.abonos || []).length;
    const bal = (cache.abonos || []).reduce((s, a) => s + (parseFloat(a.monto) || 0), 0);
    document.getElementById('totalRevenueMonth').textContent = formatMonto(bal);
}

/* =========================
   14. ACCIONES ADMIN
========================= */

/* ── Registrar Pago ── */
function openPagoModal() {
    if (!canRegisterPago()) return;
    const personas = cache.personas || [];
    const servicios = cache.servicios || [];

    buildModal('Registrar Pago', `
        <div class="form-group">
            <label>Persona</label>
            <select id="pagoPersonaSelect">
                ${personas.map(p =>
        `<option value="${escHtml(p.IDCliente || p.IDAsistencia)}"
                             data-actividad="${escHtml(p.Activo || p.Actividad || '')}">
                        ${escHtml(p.Nombre || p.Usuario)} (DNI: ${escHtml(String(p.Documento))})
                    </option>`).join('')}
            </select>
        </div>
        <div class="form-group">
            <label>Servicio / Concepto</label>
            <select id="pagoServicioSelect">
                <option value="">— Sin servicio específico —</option>
                ${servicios.map(s =>
            `<option value="${escHtml(s.IDServicios)}">${escHtml(s.Nombre)} ($${s.Precios})</option>`).join('')}
            </select>
        </div>
        <div class="form-group">
            <label>Monto (positivo)</label>
            <input type="number" id="pagoMontoInput" min="1" step="100" placeholder="Ej: 32000" required>
        </div>
    `, async () => {
        const pid = document.getElementById('pagoPersonaSelect').value;
        const servId = document.getElementById('pagoServicioSelect').value;
        const monto = parseFloat(document.getElementById('pagoMontoInput').value);

        if (!pid) { alert('Seleccioná una persona.'); return false; }
        if (!monto || monto <= 0) { alert('Ingresá un monto válido.'); return false; }

        await apiPost('registrarAbono', {
            idCarga: 'PAGO-' + Date.now(),
            tipoMovimiento: 'Pago',
            idCliente: pid,
            servicio: servId,
            suplemento: '',
            monto: monto
        });
        cache.abonos = (await apiGet('getAbonos')) || [];
        renderAdmin(); renderAbonos();
        return true;
    });
}

/* ── Generar Deuda Mensual ── */
async function handleGenerarDeudas() {
    if (!canAccessAdmin()) return;

    const personas = cache.personas || [];
    const servicios = cache.servicios || [];
    const abonos = cache.abonos || [];

    if (!personas.length) { alert('No hay personas cargadas en el sistema.'); return; }
    if (!servicios.length) { alert('No hay servicios cargados en el sistema.'); return; }

    const now = new Date();
    const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Pre-calcular qué se generará
    const pendientes = [];
    const omitidas = [];
    const sinServicio = [];

    for (const persona of personas) {
        const actividad = (persona.NombreActividad || persona.Actividad || persona.Activo || '').trim();
        if (!actividad) continue;

        const servicio = servicios.find(s => norm(s.Nombre) === norm(actividad));
        if (!servicio) continue;

        const idCarga = `DEUDA-${yyyymm}-${persona.IDCliente || persona.IDAsistencia}-${servicio.IDServicios}`;
        const yaExiste = abonos.some(a => String(a.IDCarga) === idCarga);

        if (yaExiste) { omitidas.push(persona.Nombre || persona.Usuario); }
        else { pendientes.push({ persona, servicio, idCarga }); }
    }

    if (!pendientes.length) {
        alert(`✅ Deudas de ${yyyymm} ya generadas para todas las personas activas.\n(${omitidas.length} omitidas, ${sinServicio.length} sin servicio)`);
        return;
    }

    const ok = confirm(
        `¿Generar deuda mensual ${yyyymm}?\n\n` +
        `• ${pendientes.length} nuevas deudas a generar\n` +
        `• ${omitidas.length} ya existentes (se omiten)\n` +
        `• ${sinServicio.length} sin servicio asignado\n\n` +
        `Esta acción registrará un cargo por actividad en Abonos.`
    );
    if (!ok) return;

    await withLoader(async () => {
        let generadas = 0;
        for (const { persona, servicio, idCarga } of pendientes) {
            const precio = parseFloat(servicio.Precios || 0);
            await apiPost('registrarAbono', {
                idCarga,
                tipoMovimiento: 'Consumo',
                idCliente: persona.IDCliente || persona.IDAsistencia,
                servicio: servicio.IDServicios,
                suplemento: '',
                monto: -Math.abs(precio)
            });
            generadas++;
        }
        cache.abonos = (await apiGet('getAbonos')) || [];
        renderAdmin();
        alert(`✅ Deuda mensual generada.\n${generadas} registros creados, ${omitidas.length} omitidos (ya existían).`);
    });
}

/* ── Nueva Persona ── */
function openNuevaPersonaModal() {
    if (!canAgregarPersona()) return;
    const servicios = cache.servicios || [];

    buildModal('Nueva Persona', `
        <div class="form-group">
            <label>Nombre / Usuario *</label>
            <input type="text" id="npUsuario" placeholder="Ej: Juan Pérez" required>
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
            <label>Dirección</label>
            <input type="text" id="npDireccion" placeholder="Ej: Argentina">
        </div>
        <div class="form-group">
            <label>Actividad</label>
            <select id="npActividad">
                <option value="">— Sin actividad —</option>
                ${servicios.map(s =>
        `<option value="${escHtml(s.Nombre)}">${escHtml(s.Nombre)}</option>`).join('')}
            </select>
        </div>
    `, async () => {
        const usuario = document.getElementById('npUsuario').value.trim();
        const documento = document.getElementById('npDocumento').value.trim();
        const mail = document.getElementById('npMail').value.trim().toLowerCase();
        const direccion = document.getElementById('npDireccion').value.trim();
        const actividad = document.getElementById('npActividad').value;

        if (!usuario || !documento || !mail) { alert('Completá los campos obligatorios (*).'); return false; }

        const personas = cache.personas || [];

        // Validar duplicados
        if (personas.some(p => String(p.Documento || '').trim() === documento)) {
            alert(`❌ Ya existe una persona con Documento ${documento}.`); return false;
        }
        if (personas.some(p => (p.Mail || '').toLowerCase() === mail)) {
            alert(`❌ Ya existe una persona con el email ${mail}.`); return false;
        }

        // Auto-generar ID
        const idCliente = generateId();

        await apiPost('agregarPersona', {
            idCliente, nombre: usuario, documento, mail, direccion, activo: 'VERDADERO'
        });

        // Actualizar solo cache.personas
        const nuevaPersona = { IDCliente: idCliente, Nombre: usuario, Documento: documento, Mail: mail, Dirección: direccion, Activo: 'VERDADERO' };
        cache.personas = [...personas, nuevaPersona];
        document.getElementById('searchPersonas').value = '';
        renderAdmin();
        renderPersonas();
        return true;
    });
}

/* =========================
   15. ACCIONES TABLA
========================= */

/* ── Consumo de suplemento ── */
function openConsumoModal(userName, idAsistencia) {
    if (!canRegisterConsumo()) { alert('Sin permisos.'); return; }
    const sups = cache.suplementos || [];
    if (!sups.length) { alert('No hay suplementos cargados.'); return; }

    buildModal(`Consumo: ${userName}`, `
        <div class="form-group">
            <label>Suplemento</label>
            <select id="consumoSelect">
                ${sups.map(s =>
        `<option value="${escHtml(String(s.Precio))}"
                             data-nombre="${escHtml(s.Nombre)}">
                        ${escHtml(s.Nombre)} (${escHtml(s.Marca || '')}) — $${s.Precio}
                    </option>`).join('')}
            </select>
        </div>
    `, async () => {
        if (!canRegisterConsumo()) { alert('Sin permisos.'); return false; }
        const sel = document.getElementById('consumoSelect');
        const precio = parseFloat(sel.value);
        const nombre = sel.options[sel.selectedIndex].dataset.nombre;

        await apiPost('registrarAbono', {
            idCarga: 'CHG-' + Date.now(),
            tipoMovimiento: 'Consumo',
            idCliente: idAsistencia, // Reutilizamos el id pasado
            servicio: '',
            suplemento: nombre,
            monto: -Math.abs(precio)
        });

        // Refrescar abonos (OWNER ve todos; CLIENTE podría ver los suyos pero no llega aquí)
        if (currentRole === 'OWNER') {
            cache.abonos = (await apiGet('getAbonos')) || [];
            renderAdmin();
        }
        return true;
    });
}

/* ── Saldar actividad ── */
async function saldarActividad(idAsistencia, actividad) {
    if (!canSaldarActividad()) { alert('Sin permisos.'); return; }
    if (!actividad) { alert('Esta persona no tiene actividad asignada.'); return; }

    let servicios = cache.servicios;
    if (!servicios) {
        servicios = (await apiGet('getServicios')) || [];
        cache.servicios = servicios;
    }

    const servicio = servicios.find(s => norm(s.Nombre) === norm(actividad));
    if (!servicio) {
        alert(`No se encontró el servicio para la actividad "${actividad}". Verificá la hoja Servicios.`);
        return;
    }

    await withLoader(async () => {
        // Obtener abonos de esta persona (cache para OWNER, API para PROFESOR usando DNI)
        let abonosPersona;
        if (currentRole === 'OWNER' && cache.abonos !== null) {
            abonosPersona = cache.abonos.filter(a => String(a.Persona || a.IDCliente || '') === idAsistencia);
        } else {
            const persona = (cache.personas || []).find(p => String(p.IDCliente || p.IDAsistencia || '') === idAsistencia);
            const dni = persona ? persona.Documento : '';
            if (!dni) { alert('No se pudo encontrar el DNI de la persona.'); return; }
            const data = await apiGet('getFullDataByDocumento', { documento: dni });
            abonosPersona = data ? (data.abonos || []) : [];
        }

        // Solo abonos de la actividad principal (filtrar por IDServicios)
        const abonosActividad = abonosPersona.filter(
            a => String(a.Servicio || '') === String(servicio.IDServicios)
        );

        const saldo = abonosActividad.reduce((s, a) => s + (parseFloat(a.monto) || 0), 0);

        if (saldo >= 0) {
            alert(`✅ ${actividad}: sin deuda pendiente.\nSaldo actual: ${formatMonto(saldo)}`);
            return;
        }

        const monto = Math.abs(saldo);
        const confirmar = confirm(
            `Saldar deuda de ${actividad}\n\n` +
            `Deuda pendiente: ${formatMonto(-monto)}\n` +
            `Se registrará un pago de: ${formatMonto(monto)}\n\n` +
            `¿Confirmar?`
        );
        if (!confirmar) return;

        await apiPost('registrarAbono', {
            idCarga: 'SALDO-' + Date.now(),
            tipoMovimiento: 'Pago',
            idAsistencia: idAsistencia,
            servicio: servicio.IDServicios,
            suplemento: '',
            monto: monto
        });

        if (currentRole === 'OWNER') {
            cache.abonos = (await apiGet('getAbonos')) || [];
            renderAdmin();
        }
        alert(`✅ Actividad saldada. Pago de ${formatMonto(monto)} registrado.`);
    });
}

/* =========================
   16. MODAL HELPER
========================= */

/**
 * Construye y abre el modal genérico.
 * @param {string}   title        - Título del modal
 * @param {string}   contentHtml  - HTML del cuerpo
 * @param {Function} onSubmit     - Async fn; debe devolver true para cerrar, false para mantener
 */
function buildModal(title, contentHtml, onSubmit) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalContent').innerHTML = contentHtml;
    document.getElementById('modalOverlay').classList.remove('hidden');

    document.getElementById('btnModalSubmit').onclick = async () => {
        const result = await withLoader(() => onSubmit());
        if (result === true) closeModal();
    };
}

function closeModal() {
    document.getElementById('modalOverlay').classList.add('hidden');
    document.getElementById('btnModalSubmit').onclick = null;
}

/* =========================
   17. UTILIDADES
========================= */
function getFechaAsistencia(row) {
    if (!row) return null;
    const key = Object.keys(row).find(k => k.trim().toLowerCase() === 'fecha');
    return key ? row[key] : (row['Fecha'] || row['Fecha ']);
}

function getSaldoPersona(pid) {
    if (!pid) return 0;
    const abs = (cache.abonos || []).filter(a => String(a.Persona || a.IDCliente || '').trim() === String(pid));
    return abs.reduce((sum, a) => sum + (parseFloat(a.monto) || 0), 0);
}

function getNombreConcepto(idServ, txtSup) {
    if (txtSup) return String(txtSup);
    if (!idServ) return 'Abono';
    const s = (cache.servicios || []).find(x => String(x.IDServicios) === String(idServ));
    return s ? s.Nombre : idServ;
}

function getNombrePersona(pid) {
    if (!pid) return '-';
    if (currentUser && String(currentUser.IDCliente || currentUser.IDAsistencia) === String(pid)) {
        return currentUser.Nombre || currentUser.Usuario;
    }
    const p = (cache.personas || []).find(x => String(x.IDCliente || x.IDAsistencia) === String(pid));
    return p ? (p.Nombre || p.Usuario) : pid;
}

async function verUltimaAsistencia(documento, usuario) {
    if (!documento) { alert('Esta persona no tiene documento registrado.'); return; }
    await withLoader(async () => {
        // Obtenemos todos los datos de la persona por DNI usando el nuevo endpoint unificado
        const data = await apiGet('getFullDataByDocumento', { documento });
        const asistencias = data ? (data.asistencias || []) : [];

        if (asistencias.length === 0) {
            alert(`Asistencia: ${usuario}\n\nSin asistencias registradas.`);
            return;
        }
        const sorted = asistencias.sort((a, b) => {
            const fa = getFechaAsistencia(a);
            const fb = getFechaAsistencia(b);
            return new Date(fb) - new Date(fa);
        });
        const ultima = sorted[0];

        alert(`Asistencia: ${usuario}\n\nÚltima asistencia:\n${formatFechaHora(getFechaAsistencia(ultima))}`);
    });
}

function showLoader(show) {
    document.getElementById('loader').classList.toggle('hidden', !show);
}

/** Alterna entre tema claro y oscuro, guarda en localStorage. */
function toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('gymTheme', next);
    const btn = document.getElementById('btnTheme');
    if (btn) btn.textContent = next === 'dark' ? '🌙' : '☀️';
}
function showError(el, msg) { el.textContent = msg; el.classList.remove('hidden'); }
function clearMsg(el) { el.textContent = ''; el.className = 'hidden'; }

/** Formatea monto con separador de miles. */
function formatMonto(n) {
    if (isNaN(n)) return '$0.00';
    const abs = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (n < 0 ? '-' : '') + '$' + abs;
}

/** ISO date → dd/mm/aaaa */
function formatFecha(valor) {
    if (!valor) return '-';
    let d = new Date(valor);
    if (isNaN(d.getTime())) {
        const str = String(valor).replace(' ', 'T');
        d = new Date(str);
        if (isNaN(d.getTime())) return String(valor);
    }
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** ISO date → dd/mm/aaaa HH:MM:SS */
function formatFechaHora(valor) {
    if (!valor) return '-';
    let d = new Date(valor);
    if (isNaN(d.getTime())) {
        const str = String(valor).replace(' ', 'T');
        d = new Date(str);
        if (isNaN(d.getTime())) return String(valor);
    }
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${hh}:${min}:${ss}`;
}

/** Escapa HTML para prevenir XSS en atributos inline. */
function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Normaliza un string (trim + lowercase) para comparaciones. */
function norm(str) { return String(str || '').trim().toLowerCase(); }

/**
 * Auto-genera IDAsistencia con formato "Persona0001".
 * Toma el máximo número existente en cache.personas y suma 1.
 */
function generateId() {
    let max = 0;
    (cache.personas || []).forEach(p => {
        const m = String(p.IDCliente || p.IDAsistencia || '').match(/(\d+)$/);
        if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return `CLI${String(max + 1).padStart(4, '0')}`;
}
