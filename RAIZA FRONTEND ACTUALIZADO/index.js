/* RAIZA — index.js
   Comportamiento del index anterior (menú móvil, resaltado de sección,
   formulario de inscripción y chip de sesión) con las claves de sesión
   nuevas (raiza_jwt, raiza_rol, raiza_nombre). */
document.addEventListener('DOMContentLoaded', () => {
  // Menú móvil
  const hamburger = document.getElementById('hamburger');
  const navLinks = document.getElementById('navLinks');
  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => navLinks.classList.toggle('open'));
    navLinks.querySelectorAll('a').forEach(a => a.addEventListener('click', () => navLinks.classList.remove('open')));
  }

  // Resalta en el menú la sección visible
  const sections = document.querySelectorAll('section[id]');
  const navItems = document.querySelectorAll('.nav-item');
  if (sections.length && navItems.length) {
    window.addEventListener('scroll', () => {
      let current = '';
      sections.forEach(sec => { if (window.scrollY >= sec.offsetTop - 120) current = sec.getAttribute('id'); });
      navItems.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + current));
    });
  }

  // Sesión activa: logo → avatar con nombre y rol; botón → portal + cerrar sesión
  const token = localStorage.getItem('raiza_jwt');
  if (token) {
    const nombre = RZ_SESION.nombre() || 'Usuario';
    const rol = RZ_SESION.rol() || '';
    const $ = id => document.getElementById(id);

    const loginBtn = $('loginBtn');
    if (loginBtn) { loginBtn.textContent = 'Ir a mi portal'; loginBtn.setAttribute('href', 'portal.html'); }
    if ($('userChip')) $('userChip').style.display = 'flex';
    if ($('brandLogoImg')) $('brandLogoImg').style.display = 'none';
    if ($('brandAvatar')) { $('brandAvatar').style.display = 'flex'; $('brandAvatar').textContent = nombre.charAt(0).toUpperCase(); }
    if ($('brandName')) $('brandName').textContent = nombre;
    if ($('brandRole')) $('brandRole').textContent = rol.toUpperCase();
  }

  const $logout = document.getElementById('logoutBtn');
  if ($logout) $logout.addEventListener('click', (e) => {
    e.preventDefault();
    localStorage.clear();
    window.location.href = 'index.html';
  });

  // Formulario de inscripción
  const form = document.getElementById('inscripcionForm');
  if (form) form.addEventListener('submit', (e) => {
    e.preventDefault();
    alert('¡Gracias por tu interés! Un asesor de RAIZA se pondrá en contacto contigo pronto.');
    form.reset();
  });
});