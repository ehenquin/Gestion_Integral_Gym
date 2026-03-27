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
    e.preventDefault();
    const dniInput = document.getElementById('clienteDniInput');
    const dni = dniInput ? dniInput.value.trim() : '';
    const errorEl = document.getElementById('loginClienteError');
    clearMsg(errorEl);
    if (!dni) {
        showError(errorEl, 'Por favor, ingresá un DNI válido.');
        return;
    }
    await withLoader(async () => {
        // Enviamos explícitamente action=getFullDataByDocumento y el documento
        // apiGet se encargará de inyectar la key=GYM_PRO_2026 obligatoria
        const data = await apiGet('getFullDataByDocumento', {
            documento: dni
        });
        if (!data || !data.cliente) {
            showError(errorEl, 'DNI no encontrado. Verificá que esté registrado en el gimnasio.');
            return;
        }
        //await postLogin(data.cliente);
        currentUser = data.cliente;
        currentRole = 'CLIENTE';
        cache.inscripciones = data.inscripciones || [];
        cache.abonos = data.abonos || [];
        cache.asistencias = data.asistencias || [];
        cache.actividades = data.actividades || [];
        cache.suplementos = data.suplementos || [];
        setupNavbar();
        renderProfile();
        enterApp('perfilView');
    });
}

















/* —— STAFF —— */
async function handleLoginStaff(e) {
    e.preventDefault();
    const email = document.getElementById('staffEmailInput').value.trim().toLowerCase();
    const errorEl = document.getElementById('loginStaffError');
    clearMsg(errorEl);

    if (email === OWNER_EMAIL.toLowerCase()) currentRole = 'OWNER';
    else if (PROFESSOR_EMAILS.map(em => em.toLowerCase()).includes(email)) currentRole = 'PROFESOR';
    else { showError(errorEl, 'Email no autorizado como Staff.'); return; }

    await withLoader(async () => {
        const tempRole = (email === OWNER_EMAIL.toLowerCase()) ? 'OWNER' : 'PROFESOR';
        const persona = await apiGet('getPersonaByEmail', { email });
        const tempUser = persona || { IDAsistencia: '', Usuario: email.split('@')[0], Documento: '', Mail: email, Actividad: tempRole };

        //await postLogin(tempUser);

        currentUser = tempUser;
        currentRole = tempRole;

        if (currentRole === 'PROFESOR') {
            const [pers, abos, servs, sups] = await Promise.all([
                apiGet('getPersonas'), apiGet('getAbonos'), apiGet('getServicios'), apiGet('getSuplementos')
            ]);
            cache.personas = Array.isArray(pers) ? pers : [];
            cache.abonos = Array.isArray(abos) ? abos : [];
            cache.servicios = Array.isArray(servs) ? servs : [];
            cache.suplementos = Array.isArray(sups) ? sups : [];
            setupNavbar(); renderPersonas(); enterApp('personasView');
        } else {
            const [pers, abos, servs, sups] = await Promise.all([
                apiGet('getPersonas'), apiGet('getAbonos'), apiGet('getServicios'), apiGet('getSuplementos')
            ]);
            cache.personas = Array.isArray(pers) ? pers : [];
            cache.abonos = Array.isArray(abos) ? abos : [];
            cache.servicios = Array.isArray(servs) ? servs : [];
            cache.suplementos = Array.isArray(sups) ? sups : [];
            setupNavbar(); renderAdmin(); enterApp('adminPanelView');
        }
    });
}

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

    const nombre = currentUser.Usuario || currentUser.Mail || 'Usuario';
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

    /* Inicializar tema desde localStorage */
    const _savedTheme = localStorage.getItem('gymTheme') || 'dark';
    document.documentElement.setAttribute('data-theme', _savedTheme);
    const _btnT = document.getElementById('btnTheme');
    if (_btnT) _btnT.textContent = _savedTheme === 'dark' ? '🌙' : '☀️';

    /* Login choice */
    document.getElementById('btnChoiceAlumno').addEventListener('click', () => showOnlyView('loginClienteView'));
    document.getElementById('btnChoiceStaff').addEventListener('click', () => showOnlyView('loginStaffView'));
    document.getElementById('btnBackFromCliente').addEventListener('click', goToLoginChoice);
    document.getElementById('btnBackFromStaff').addEventListener('click', goToLoginChoice);
    document.getElementById('loginClienteForm').addEventListener('submit', handleLoginCliente);
    document.getElementById('loginStaffForm').addEventListener('submit', handleLoginStaff);

    /* Logout */
    document.getElementById('btnLogout').addEventListener('click', () => {
        cache.clear(); currentUser = null; currentRole = null;
        document.getElementById('mainHeader').classList.add('hidden');
        document.getElementById('clienteEmailInput').value = '';
        document.getElementById('staffEmailInput').value = '';
        goToLoginChoice();
    });

    /* Navegación */
    document.getElementById('btnPerfil').addEventListener('click', () => {
        renderProfile(); showView('perfilView');
    });
    document.getElementById('btnAbonos').addEventListener('click', () => {
        if (!canViewAbonos()) return;
        filterAbonos(); showView('abonosView');
    });
    document.getElementById('btnPersonas').addEventListener('click', () => {
        if (!canViewPersonas()) return;
        filterPersonas(); showView('personasView');
    });
    document.getElementById('btnAsistencia').addEventListener('click', () => {
        if (!canRegisterAsistencia()) return;
        resetAsistencia(); showView('asistenciaView');
    });
    document.getElementById('btnAdmin').addEventListener('click', () => {
        if (!canAccessAdmin()) return;
        renderAdmin(); showView('adminPanelView');
    });

    /* Búsqueda y Filtros */
    document.getElementById('searchPersonas').addEventListener('input', filterPersonas);
    document.getElementById('saldoFilter').addEventListener('change', filterPersonas);

    document.getElementById('searchAbonos').addEventListener('input', filterAbonos);
    document.getElementById('tipoAbonosFilter').addEventListener('change', filterAbonos);
    document.getElementById('ordenAbonosFilter').addEventListener('change', filterAbonos);

    /* Asistencia */
    document.getElementById('asistenciaForm').addEventListener('submit', handleRegistrarAsistencia);

    /* Admin acciones */
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

    const pid = currentUser.IDAsistencia || '';
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
            const pid = escHtml(p.IDAsistencia || '');
            const usu = escHtml(p.Usuario || '');
            const act = escHtml(p.Actividad || '');

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
        const textMatch = (p.Usuario || '').toLowerCase().includes(q) ||
            String(p.Documento || '').includes(q);
        if (!textMatch) return false;

        if (sf !== 'todos') {
            const saldo = getSaldoPersona(p.IDAsistencia);
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
            usuario: persona.Usuario
        });
        showAsistenciaMsg(msgEl, `✅ Asistencia de <strong>${escHtml(persona.Usuario)}</strong> registrada.`, false);
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
        `<option value="${escHtml(p.IDAsistencia)}"
                             data-actividad="${escHtml(p.Actividad || '')}">
                        ${escHtml(p.Usuario)} (DNI: ${escHtml(String(p.Documento))})
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
            idAsistencia: pid,
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
        const actividad = (persona.Actividad || '').trim();
        if (!actividad) { sinServicio.push(persona.Usuario); continue; }

        const servicio = servicios.find(s => norm(s.Nombre) === norm(actividad));
        if (!servicio) { sinServicio.push(persona.Usuario); continue; }

        const idCarga = `DEUDA-${yyyymm}-${persona.IDAsistencia}-${servicio.IDServicios}`;
        const yaExiste = abonos.some(a => String(a.IDCarga) === idCarga);

        if (yaExiste) { omitidas.push(persona.Usuario); }
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
                idAsistencia: persona.IDAsistencia,
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

        // Auto-generar IDAsistencia
        const idAsistencia = generatePersonaId();

        await apiPost('agregarPersona', {
            idAsistencia, usuario, documento, mail, direccion, actividad
        });

        // Actualizar solo cache.personas (sin recargar todo)
        const nuevaPersona = { IDAsistencia: idAsistencia, Fecha: new Date().toISOString(), Usuario: usuario, Documento: documento, Mail: mail, Dirección: direccion, Actividad: actividad };
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
            idAsistencia: idAsistencia,
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
        // Obtener abonos de esta persona (cache para OWNER, API para PROFESOR)
        let abonosPersona;
        if (currentRole === 'OWNER' && cache.abonos !== null) {
            abonosPersona = cache.abonos.filter(a => String(a.Persona || '') === idAsistencia);
        } else {
            abonosPersona = (await apiGet('getAbonosByPersonaId', { idAsistencia: idAsistencia })) || [];
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

function getSaldoPersona(idAsistencia) {
    if (!idAsistencia) return 0;
    const abs = (cache.abonos || []).filter(a => String(a.Persona || '').trim() === String(idAsistencia));
    return abs.reduce((sum, a) => sum + (parseFloat(a.monto) || 0), 0);
}

function getNombreConcepto(idServ, txtSup) {
    if (txtSup) return String(txtSup);
    if (!idServ) return 'Abono';
    const s = (cache.servicios || []).find(x => String(x.IDServicios) === String(idServ));
    return s ? s.Nombre : idServ;
}

function getNombrePersona(idAsis) {
    if (!idAsis) return '-';
    if (currentUser && String(currentUser.IDAsistencia) === String(idAsis)) {
        return currentUser.Usuario;
    }
    const p = (cache.personas || []).find(x => String(x.IDAsistencia) === String(idAsis));
    return p ? p.Usuario : idAsis;
}

async function verUltimaAsistencia(documento, usuario) {
    if (!documento) { alert('Esta persona no tiene documento registrado.'); return; }
    await withLoader(async () => {
        const asistencias = await apiGet('getAsistenciasByDocumento', { documento });
        if (!asistencias || asistencias.length === 0) {
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
function generatePersonaId() {
    let max = 0;
    (cache.personas || []).forEach(p => {
        const m = String(p.IDAsistencia || '').match(/^Persona(\d+)$/i);
        if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return `Persona${String(max + 1).padStart(4, '0')}`;
}
