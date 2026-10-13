const API_URL = 'https://localhost:7248/api/Usuario';

let editandoId = null; // Variable para saber si estamos creando o editando

// ---------------- Utilidades ----------------
// Iniciales para los avatares de las tablas (diseño del panel)
function inicialesDe(nombre) {
    return String(nombre || '?').trim().split(/\s+/).slice(0, 2).map(p => (p[0] || '').toUpperCase()).join('') || '?';
}

function pillRol(rol) {
    const r = String(rol || '').toLowerCase();
    const clase = r.includes('admin') ? 'pill-blue' : r.includes('instructor') ? 'pill-purple' : r.includes('estudiante') ? 'pill-green' : 'pill-gray';
    return `<span class="pill ${clase}">${escapar(rol || '—')}</span>`;
}
function pillEstado(estado) {
    const e = String(estado || '').toLowerCase();
    const clase = e.includes('inactivo') ? 'pill-red' : e.includes('activo') ? 'pill-green' : 'pill-gray';
    return `<span class="pill ${clase}">${escapar(estado || '—')}</span>`;
}


function obtenerToken() {
    return localStorage.getItem('raiza_jwt');
}

function headersConAuth() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${obtenerToken()}`
    };
}

// Escapa texto para evitar inyección HTML al renderizar usuarios
function escapar(valor) {
    return String(valor ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

// Codifica valores que viajan dentro de atributos onclick (evita romper el JS)
function codificar(valor) {
    return encodeURIComponent(String(valor ?? ''));
}

// Avatar SVG con iniciales (funciona sin servicios externos ni fotos subidas)
function avatarIniciales(nombre) {
    const iniciales = (nombre || 'U').trim().split(/\s+/).slice(0, 2).map(p => p[0].toUpperCase()).join('');
    const svg = "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>" +
        "<rect width='160' height='160' rx='80' fill='#4A5568'/>" +
        "<text x='50%' y='50%' dominant-baseline='central' text-anchor='middle' font-family='Poppins, Arial' font-size='52' fill='#F2EBDD' font-weight='600'>" +
        iniciales + "</text></svg>";
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

function irAlLogin() {
    window.location.href = 'login.html';
}

// Actualiza las tarjetas de estadísticas (solo existen en portal-admin.html)
function actualizarEstadisticas() {
    const filas = document.querySelectorAll('#tablaUsuarios tbody tr');
    if (filas.length === 0) return;

    const roles = {
        estudiante: 0,
        instructor: 0,
        administrador: 0
    };

    filas.forEach(fila => {
        const rol = (fila.children[3]?.textContent || '').toLowerCase();
        if (rol.includes('estudiante')) roles.estudiante++;
        else if (rol.includes('instructor')) roles.instructor++;
        else if (rol.includes('admin')) roles.administrador++;
    });

    const statAdmins = document.getElementById('statAdmins');
    if (statAdmins) statAdmins.textContent = roles.administrador;

    const total = document.getElementById('statTotalUsuarios');
    if (total) total.textContent = filas.length;

    const statEstudiantes = document.getElementById('statEstudiantes');
    if (statEstudiantes) statEstudiantes.textContent = roles.estudiante;

    const statInstructores = document.getElementById('statInstructores');
    if (statInstructores) statInstructores.textContent = roles.instructor;
}

// Verifica que haya una sesión activa con rol de administrador
function verificarSesionAdministrador() {
    const token = obtenerToken();
    const rol = (RZ_SESION.rol() || '').toLowerCase();

    if (!token) {
        alert('Por favor, inicia sesión para acceder al panel de administración.');
        irAlLogin();
        return false;
    }

    if (!rol.includes('admin') && !rol.includes('administrador')) {
        alert('No tienes permisos de administrador.');
        irAlLogin();
        return false;
    }

    return true;
}

function cerrarSesionAdmin() {
    if (confirm('¿Deseas cerrar sesión?')) {
        localStorage.clear();
        irAlLogin();
    }
}

// ---------------- CRUD de usuarios ----------------

// 1. GUARDAR O ACTUALIZAR USUARIO
document.getElementById('formRegistro')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const password = document.getElementById('contrasena').value;

    // VALIDACIÓN: mínimo 8 caracteres, con al menos una letra y un número (coincide con AuthController)
    const cumpleRequisitos = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(password);

    if (!cumpleRequisitos) {
        alert('La contraseña debe tener al menos 8 caracteres e incluir al menos una letra y un número.');
        return; // Detiene el envío si no cumple con el formato
    }

    // Armamos el objeto con el ID (0 si es nuevo, o el ID real si estamos editando)
    const usuario = {
        Id: editandoId ? editandoId : 0,
        Nombre: document.getElementById('nombre').value,
        Correo: document.getElementById('correo').value,
        ContrasenaHash: password,
        Rol: document.getElementById('rol').value,
        Estado: "Activo"
    };

    try {
        let url = API_URL;
        let method = 'POST'; // Por defecto es crear

        if (editandoId) {
            url = `${API_URL}/${editandoId}`; // Le pasamos el ID en la URL
            method = 'PUT'; // Cambiamos el método a actualizar
        }

        const response = await fetch(url, {
            method: method,
            headers: headersConAuth(), // Enviamos el JWT
            body: JSON.stringify(usuario)
        });

        if (response.status === 401) {
            alert('Tu sesión expiró. Inicia sesión nuevamente.');
            irAlLogin();
            return;
        }

        if (response.ok) {
            alert(editandoId ? 'Usuario actualizado exitosamente' : 'Usuario registrado exitosamente');
            cancelarEdicion(); // Limpiamos el formulario
            cargarUsuarios();  // Refrescamos la tabla
        } else {
            const errorData = await response.json().catch(() => ({}));
            // Si la validación automática de ASP.NET rechazó el modelo, la respuesta es
            // ProblemDetails (sin campo "mensaje") y se mostraba "Error: undefined".
            alert(`Error: ${errorData.mensaje || errorData.title || ('el servidor rechazó la operación (código ' + response.status + ')')}`);
        }
    } catch (error) {
        alert('No se pudo conectar con el servidor.');
    }
});

// 2. OBTENER Y MOSTRAR USUARIOS
async function cargarUsuarios() {
    try {
        const response = await fetch(API_URL, { headers: headersConAuth() });

        if (response.status === 401) {
            alert('Tu sesión expiró. Inicia sesión nuevamente.');
            irAlLogin();
            return;
        }

        if (response.status === 403) {
            alert('No tienes permiso para consultar los usuarios.');
            return;
        }

        if (response.ok) {
            const usuarios = await response.json();
            const tbody = document.querySelector('#tablaUsuarios tbody');
            tbody.innerHTML = '';

            usuarios.forEach(user => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${escapar(user.id)}</td>
                    <td><div class="row-user"><div class="av">${escapar(inicialesDe(user.nombre))}</div>${escapar(user.nombre)}</div></td>
                    <td>${escapar(user.correo)}</td>
                    <td>${pillRol(user.rol)}</td>
                    <td>${pillEstado(user.estado)}</td>
                    <td class="col-acciones">
                        <button class="accion-link" onclick="prepararEdicion(${escapar(user.id)}, '${codificar(user.nombre)}', '${codificar(user.correo)}', '${codificar(user.rol)}')">Editar</button>
                        <button class="accion-link borrar" onclick="eliminarUsuario(${escapar(user.id)})">Eliminar</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });

            actualizarEstadisticas();
        } else {
            // Respuesta no satisfactoria sin token inválido: seguramente la API no está disponible
            const tbody = document.querySelector('#tablaUsuarios tbody');
            if (tbody) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#64748B; padding:24px;">No se pudo conectar con el servidor. Inicia la API (`dotnet run --launch-profile https`) y vuelve a intentarlo.</td></tr>';
            }
        }
    } catch (error) {
        console.error('Error:', error);
        // La API puede estar apagada (por ejemplo, sin `dotnet run`): se muestra un aviso amable
        const tbody = document.querySelector('#tablaUsuarios tbody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#64748B; padding:24px;">No se pudo conectar con el servidor. Inicia la API (`dotnet run --launch-profile https`) y vuelve a intentarlo.</td></tr>';
        }
    }
}

// 3. PREPARAR FORMULARIO PARA EDICIÓN
function prepararEdicion(id, nombre, correo, rol) {
    editandoId = id;
    document.getElementById('nombre').value = decodeURIComponent(nombre);
    document.getElementById('correo').value = decodeURIComponent(correo);
    document.getElementById('rol').value = decodeURIComponent(rol);

    // Cambiamos la vista del formulario
    document.getElementById('btnGuardar').textContent = 'Actualizar Usuario';
    document.getElementById('btnCancelar').style.display = 'inline-block';
    const tituloForm = document.getElementById('tituloFormulario');
    if (tituloForm) tituloForm.textContent = 'Editar Usuario';
}

// 4. CANCELAR EDICIÓN (Volver a modo "Crear")
function cancelarEdicion() {
    editandoId = null;
    document.getElementById('formRegistro').reset();
    document.getElementById('btnGuardar').textContent = 'Guardar Usuario';
    document.getElementById('btnCancelar').style.display = 'none';
    const tituloForm = document.getElementById('tituloFormulario');
    if (tituloForm) tituloForm.textContent = 'Registrar Usuario';
}
document.getElementById('btnCancelar')?.addEventListener('click', cancelarEdicion);

// 5. ELIMINAR USUARIO
async function eliminarUsuario(id) {
    if (!confirm('¿Estás seguro de que deseas eliminar este usuario?')) return;

    try {
        const response = await fetch(`${API_URL}/${id}`, {
            method: 'DELETE',
            headers: headersConAuth()
        });

        if (response.status === 401) {
            alert('Tu sesión expiró. Inicia sesión nuevamente.');
            irAlLogin();
            return;
        }

        if (response.ok) {
            alert('Usuario eliminado correctamente.');
            cargarUsuarios();
        } else {
            const errorData = await response.json().catch(() => ({}));
            alert(`No se pudo eliminar: ${errorData.mensaje || ('el servidor rechazó la operación (código ' + response.status + ')')}`);
        }
    } catch (error) {
        alert('Error al intentar eliminar el usuario.');
    }
}

// ---------------- Navegación del sidebar ----------------
// (Necesaria: portal-admin.html llama a cambiarSeccion al hacer clic en el menú)
function cambiarSeccion(idSeccion, botonPresionado) {
    document.querySelectorAll('.seccion-dashboard').forEach(sec => sec.classList.remove('activa'));
    const seccionActiva = document.getElementById(idSeccion);
    if (seccionActiva) seccionActiva.classList.add('activa');

    document.querySelectorAll('.sidebar-btn').forEach(btn => btn.classList.remove('activo'));
    if (botonPresionado) botonPresionado.classList.add('activo');

    if (idSeccion === 'usuarios') cargarUsuarios();
    if (idSeccion === 'pedidos') cargarPedidos();
}

// ---------------- Pedidos de kits (admin) ----------------

let pedidosApp = [];
// Nombres reales de los kits (la BD aún puede tener los antiguos)
const NOMBRES_KITS_REAL = { 1: 'Kit de Alambrismo Inicial', 4: 'Kit de Macramé y Piedras', 3: 'Kit Master de Mostasilla' };
let kitsAdminMap = {};      // idclass_kit -> nombre del kit
let usuariosAdminMap = {};  // id -> nombre del estudiante

async function cargarNombresParaPedidos() {
    try {
        const respuestaKits = await fetch('https://localhost:7248/api/ClassKit', { headers: headersConAuth() });
        if (respuestaKits.ok) {
            const kits = await respuestaKits.json();
            kitsAdminMap = {};
            kits.forEach(k => { kitsAdminMap[k.idclass_kit] = (NOMBRES_KITS_REAL[k.idclass_kit] || k.name || 'Kit especializado'); });
        }

        const respuestaUsuarios = await fetch(API_URL, { headers: headersConAuth() });
        if (respuestaUsuarios.ok) {
            const usuarios = await respuestaUsuarios.json();
            usuariosAdminMap = {};
            usuarios.forEach(u => { usuariosAdminMap[u.id ?? u.Id] = (u.nombre || 'Usuario'); });
        }
    } catch (error) {
        console.warn('No se pudieron cargar nombres de kits/estudiantes.', error);
    }
}

async function cargarPedidos() {
    const tbody = document.querySelector('#tablaPedidos tbody');
    if (!tbody) return;

    if (!verificarSesionAdministrador()) return;

    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#64748B; padding:24px;">Cargando pedidos…</td></tr>';

    await cargarNombresParaPedidos();

    try {
        const response = await fetch('https://localhost:7248/api/PedidoKit', { headers: headersConAuth() });

        if (response.status === 401) {
            alert('Tu sesión expiró. Inicia sesión nuevamente.');
            irAlLogin();
            return;
        }

        if (response.status === 403) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#B45309; padding:24px;">No tienes permisos para consultar los pedidos.</td></tr>';
            return;
        }

        if (response.ok) {
            pedidosApp = await response.json();
            renderPedidos();
        } else {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#64748B; padding:24px;">No se pudo conectar con el servidor. Inicia la API (`dotnet run --launch-profile https`) y vuelve a intentarlo.</td></tr>';
        }
    } catch (error) {
        console.error('Error:', error);
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#64748B; padding:24px;">No se pudo conectar con el servidor. Inicia la API (`dotnet run --launch-profile https`) y vuelve a intentarlo.</td></tr>';
    }
}

function renderPedidos() {
    const tbody = document.querySelector('#tablaPedidos tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!Array.isArray(pedidosApp) || pedidosApp.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#64748B; padding:24px;">Aún no hay pedidos de kits.</td></tr>';
        return;
    }

    // Estados permitidos por el CHECK constraint de la BD (pedido_kit.estado):
    // Pendiente, Enviado, Entregado, Cancelado.
    const estados = ['Pendiente', 'Enviado', 'Entregado', 'Cancelado'];

    pedidosApp.forEach(pedido => {
        const id = pedido.idPedidoKit ?? pedido.IdPedidoKit;
        const kitNombre = kitsAdminMap[pedido.idclasskit] || 'Kit especializado';
        const estudiante = usuariosAdminMap[pedido.idestudiante] || ('Estudiante #' + pedido.idestudiante);
        const fecha = pedido.fechapedido ? new Date(pedido.fechapedido).toLocaleDateString('es-CO') : 'Reciente';
        const estado = pedido.estado || 'Pendiente';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>#${escapar(id)}</td>
            <td>${escapar(kitNombre)}</td>
            <td>${escapar(estudiante)}</td>
            <td>${escapar(fecha)}</td>
            <td>
                <select id="estadoPedido_${escapar(id)}">
                    ${estados.map(es => `<option value="${es}" ${es === estado ? 'selected' : ''}>${es}</option>`).join('')}
                </select>
            </td>
            <td style="white-space: nowrap;">
                <button class="accion-link" onclick="guardarEstadoPedido(${escapar(id)})">Guardar</button>
                <button class="accion-link borrar" onclick="eliminarPedido(${escapar(id)})">Eliminar</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function guardarEstadoPedido(id) {
    const select = document.getElementById(`estadoPedido_${id}`);
    if (!select) return;
    const nuevoEstado = select.value;
    const pedido = pedidosApp.find(p => (p.idPedidoKit ?? p.IdPedidoKit) == id);
    if (!pedido) return;

    const respaldoEstado = pedido.estado;
    pedido.estado = nuevoEstado;

    try {
        const response = await fetch(`https://localhost:7248/api/PedidoKit/${id}`, {
            method: 'PUT',
            headers: headersConAuth(),
            body: JSON.stringify(pedido)
        });

        if (response.status === 401) {
            alert('Tu sesión expiró. Inicia sesión nuevamente.');
            irAlLogin();
            return;
        }

        if (response.ok) {
            alert('Estado actualizado a "' + nuevoEstado + '".');
            renderPedidos();
        } else {
            pedido.estado = respaldoEstado;
            const err = await response.json().catch(() => ({}));
            alert('No se pudo actualizar el estado: ' + (err.mensaje || ('código ' + response.status)));
        }
    } catch (error) {
        pedido.estado = respaldoEstado;
        alert('Servidor no disponible. No se pudo guardar el cambio de estado.');
    }
}

async function eliminarPedido(id) {
    if (!confirm('¿Eliminar este pedido de kit?')) return;

    try {
        const response = await fetch(`https://localhost:7248/api/PedidoKit/${id}`, {
            method: 'DELETE',
            headers: headersConAuth()
        });

        if (response.status === 401) {
            alert('Tu sesión expiró. Inicia sesión nuevamente.');
            irAlLogin();
            return;
        }

        if (response.ok) {
            pedidosApp = pedidosApp.filter(p => (p.idPedidoKit ?? p.IdPedidoKit) != id);
            alert('Pedido eliminado correctamente.');
            renderPedidos();
        } else {
            const err = await response.json().catch(() => ({}));
            alert('No se pudo eliminar el pedido: ' + (err.mensaje || ('código ' + response.status)));
        }
    } catch (error) {
        alert('Servidor no disponible. No se pudo eliminar el pedido.');
    }
}

// ---------------- Carga inicial ----------------
document.getElementById('btnCargar')?.addEventListener('click', cargarUsuarios);

document.addEventListener('DOMContentLoaded', () => {
    // Por defecto toda la API exige token; esta página también exige rol de administrador.
    if (!verificarSesionAdministrador()) return;
    cargarUsuarios();

    // Avatar de respaldo con iniciales en el sidebar (solo existe en portal-admin.html)
    const imgSidebar = document.getElementById('imgPerfilSidebar');
    if (imgSidebar) {
        const iniciales = avatarIniciales(RZ_SESION.nombre() || 'Admin');
        imgSidebar.addEventListener('error', () => { imgSidebar.src = iniciales; });
        if (imgSidebar.complete && imgSidebar.naturalWidth === 0) imgSidebar.src = iniciales;
    }
});