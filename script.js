'use strict';

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
const pad2 = (n) => String(n).padStart(2, '0');
const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
const show = (el, visible) => { if (el) el.hidden = !visible; };
const safeUrl = (url) => (/^https?:\/\//i.test(url) ? url : '#');

const state = {
  content: null,
  projects: [],
  filter: 'Semua',
  modal: null
};

const galleries = []; // semua galeri draggable, diperbarui saat resize

/* ----------------------------------------------------------
   1. Menu fullscreen
   ---------------------------------------------------------- */
const menu = {
  btn: $('#menuBtn'),
  overlay: $('#menuOverlay'),
  closeBtn: $('#menuClose'),
  isOpen: false,

  open() {
    this.isOpen = true;
    this.overlay.inert = false;
    this.overlay.classList.add('is-open');
    this.overlay.setAttribute('aria-hidden', 'false');
    this.btn.setAttribute('aria-expanded', 'true');
    document.body.classList.add('no-scroll');
    setTimeout(() => this.closeBtn.focus({ preventScroll: true }), 400);
  },

  close(returnFocus = true) {
    this.isOpen = false;
    this.overlay.classList.remove('is-open');
    this.overlay.setAttribute('aria-hidden', 'true');
    this.overlay.inert = true;
    this.btn.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('no-scroll');
    if (returnFocus) this.btn.focus({ preventScroll: true });
  },

  init() {
    this.btn.addEventListener('click', () => this.open());
    this.closeBtn.addEventListener('click', () => this.close());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });
  }
};

/* Semua tautan [data-nav]: tutup menu lalu scroll halus */
function initNavLinks() {
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[data-nav]');
    if (!link) return;
    const hash = link.getAttribute('href');
    const target = hash && hash.startsWith('#') ? $(hash) : null;
    if (!target) return;
    e.preventDefault();
    const wasOpen = menu.isOpen;
    if (wasOpen) menu.close(false);
    setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }), wasOpen ? 450 : 0);
  });
}

/* ----------------------------------------------------------
   2. Galeri draggable (mouse drag + inertia, swipe native di mobile)
   ---------------------------------------------------------- */
function makeDraggable(el) {
  let isDown = false;
  let startX = 0;
  let startScroll = 0;
  let lastX = 0;
  let velocity = 0;
  let moved = 0;
  let inertiaRaf = 0;
  let ticking = false;

  const update = () => {
    ticking = false;
    updateGallery(el);
  };
  const requestUpdate = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  };

  const inertia = () => {
    el.scrollLeft -= velocity;
    velocity *= 0.94;
    if (Math.abs(velocity) > 0.4) inertiaRaf = requestAnimationFrame(inertia);
  };

  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return; // sentuhan memakai scroll native
    isDown = true;
    moved = 0;
    velocity = 0;
    startX = lastX = e.clientX;
    startScroll = el.scrollLeft;
    cancelAnimationFrame(inertiaRaf);
    el.classList.add('is-dragging');
  });

  window.addEventListener('pointermove', (e) => {
    if (!isDown) return;
    const dx = e.clientX - startX;
    moved = Math.max(moved, Math.abs(dx));
    velocity = e.clientX - lastX;
    lastX = e.clientX;
    el.scrollLeft = startScroll - dx;
  });

  const release = () => {
    if (!isDown) return;
    isDown = false;
    el.classList.remove('is-dragging');
    inertiaRaf = requestAnimationFrame(inertia);
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);

  // Cegah klik (buka modal) setelah geser
  el.addEventListener('click', (e) => {
    if (moved > 6) {
      e.preventDefault();
      e.stopPropagation();
      moved = 0;
    }
  }, true);

  // Cegah drag bawaan gambar/tautan
  el.addEventListener('dragstart', (e) => e.preventDefault());

  el.addEventListener('scroll', requestUpdate, { passive: true });
  galleries.push(el);
  requestUpdate();
}

/* Perbarui parallax tiap slide + bar progres galeri */
function updateGallery(el) {
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;

  $$('.slide', el).forEach((slide) => {
    const b = slide.getBoundingClientRect();
    const p = ((b.left + b.width / 2) - cx) / (rect.width || 1);
    slide.style.setProperty('--p', Math.max(-1, Math.min(1, p)).toFixed(3));
  });

  const fill = el.parentElement.querySelector('.progress-fill');
  if (fill) {
    const max = el.scrollWidth - el.clientWidth;
    const ratio = el.scrollWidth ? Math.min(1, el.clientWidth / el.scrollWidth) : 1;
    const pos = max > 0 ? el.scrollLeft / max : 0;
    fill.style.width = `${ratio * 100}%`;
    fill.style.left = `${pos * (1 - ratio) * 100}%`;
  }
}

/* ----------------------------------------------------------
   3. Kursor kustom
   ---------------------------------------------------------- */
function initCursor() {
  const cursor = $('#cursor');
  const label = $('#cursorLabel');
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  document.addEventListener('pointermove', (e) => {
    cursor.style.setProperty('--x', `${e.clientX}px`);
    cursor.style.setProperty('--y', `${e.clientY}px`);

    const overGallery = !menu.isOpen && e.target.closest('.drag-gallery');
    cursor.classList.toggle('is-active', Boolean(overGallery));

    if (overGallery) {
      const text = e.target.closest('.slide') ? 'Lihat' : 'Geser';
      if (label.textContent !== text) label.textContent = text;
    }
  });

  document.documentElement.addEventListener('mouseleave', () => cursor.classList.remove('is-active'));
}

/* ----------------------------------------------------------
   4. Render konten
   ---------------------------------------------------------- */
/* ---------- Urutan & penomoran proyek ----------
 * pinned dulu (nomor 01), lalu terlama → terbaru. Proyek baru selalu di paling akhir.
 * Nomor diambil dari urutan GLOBAL, jadi tetap 01, 02, … walau daftar difilter. */
const byOrder = (a, b) =>
  (b.pinned === true) - (a.pinned === true) ||
  String(a.uploadedAt).localeCompare(String(b.uploadedAt)) ||
  String(a.id).localeCompare(String(b.id));
const numberOf = (p) => state.projects.findIndex((x) => x.id === p.id) + 1;

/* Tombol edit hanya muncul bila admin pernah login di browser ini (flag dari admin.js) */
const isAdmin = () => {
  try { return localStorage.getItem('adm_on') === '1'; } catch { return false; }
};
const PENCIL = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

function slideHTML(project) {
  return `
    <article class="slide" style="--i:${numberOf(project) - 1}" data-project="${esc(project.id)}" tabindex="0" role="button"
             aria-label="Lihat proyek ${esc(project.title)}">
      ${isAdmin() ? `<a class="slide-edit" href="admin.html?edit=${esc(project.id)}#portfolio" title="Edit proyek" aria-label="Edit ${esc(project.title)}">${PENCIL}</a>` : ''}
      <div class="slide-media">
        <div class="parallax">
          <img src="${esc(project.image)}" alt="${esc(project.alt || project.title)}" loading="lazy" draggable="false">
        </div>
      </div>
      <div class="slide-caption">
        <span class="slide-index">${pad2(numberOf(project))}</span>
        <span class="slide-title">${esc(project.title)}</span>
        <span class="slide-cat">${esc(catOf(project))}${project.year ? (catOf(project) ? ' · ' : '') + esc(project.year) : ''}</span>
      </div>
    </article>`;
}


function renderHeader() {
  const { settings, profiles, contact } = state.content;
  const main = profiles[0] || {};
  const siteName = settings.siteName || main.name || '';

  $('#brandName').textContent = siteName || 'Portfolio';
  $('#brandRole').textContent = main.role || '';
  $('#headerLocation').textContent = main.location || '';
  show($('#headerSep'), Boolean(main.location));
  $('#footerName').textContent = siteName ? `${siteName}.` : '';
  document.title = [siteName, main.role].filter(Boolean).join(' — ') || 'Portfolio';

  const firstEmail = contact.items.find((it) => it.type === 'email');
  const menuEmail = $('#menuEmail');
  menuEmail.textContent = firstEmail ? firstEmail.value : '';
  menuEmail.href = firstEmail ? `mailto:${firstEmail.value}` : '#';
  show(menuEmail, Boolean(firstEmail));

  // 2 logo kecil di samping nama (maks. 2, hanya URL http/https)
  const logos = [settings.logo1, settings.logo2].map((u) => (/^https?:\/\//i.test(u || '') ? u : ''));
  logos.forEach((url, i) => {
    const img = $(`#brandLogo${i + 1}`);
    if (url) {
      img.src = url;
      img.onerror = () => { img.hidden = true; }; // URL rusak → sembunyikan
      img.alt = siteName ? `Logo ${i + 1} ${siteName}` : `Logo ${i + 1}`;
    } else {
      img.removeAttribute('src');
    }
    img.hidden = !url;
  });
  show($('#brandLogos'), logos.some(Boolean));

  $('#menuSocials').innerHTML = contact.socials
    .map((s) => `<a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.label)}</a>`)
    .join('');
}

function renderLabels() {
  const { settings } = state.content;
  const labels = {
    profile: settings.navProfile || 'PROFIL',
    portfolio: settings.navPortfolio || 'PORTFOLIO'
  };

  $$('[data-nav-label]').forEach((el) => {
    el.textContent = labels[el.dataset.navLabel] || el.textContent;
  });

  // label di indikator samping (side rail) ikut berubah
  $('#profile').dataset.label = labels.profile;
  $('#portfolio').dataset.label = labels.portfolio;
}

function renderHero() {
  const { settings } = state.content;
  const lines = String(settings.heroTitle || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const hasIntro = Boolean(settings.heroIntro);
  const hasProjects = state.projects.length > 0;
  const hasAnything = lines.length || hasIntro || hasProjects;

  const title = $('#heroTitle');
  if (lines.length) {
    // Baris tengah diberi gaya outline bila ada 3 baris atau lebih
    title.innerHTML = lines
      .map((line, i) => `<span class="line"><span class="${lines.length > 2 && i === 1 ? 'outline' : ''}">${esc(line)}</span></span>`)
      .join('');
  }
  show(title, lines.length > 0);
  show($('#heroEmpty'), !hasAnything);

  $('#heroIntro').textContent = settings.heroIntro || '';
  show($('#heroIntro'), hasIntro);
  show($('#scrollHint'), hasProjects);
  show($('#heroMeta'), hasIntro || hasProjects);

  show($('#heroGalleryWrap'), hasProjects);
  $('#heroGallery .drag-track').innerHTML = state.projects.slice(0, 6).map(slideHTML).join('');
  updateGallery($('#heroGallery'));
}

function renderProfile() {
  const { profiles } = state.content;
  const has = profiles.length > 0;

  show($('#profileEmpty'), !has);
  show($('#profileList'), has);
  if (!has) return;

  $('#profileList').innerHTML = profiles
    .map((p) => {
      const bio = String(p.bio || '')
        .split(/\n{2,}/)
        .map((para) => para.trim())
        .filter(Boolean)
        .map((para) => `<p>${esc(para).replace(/\n/g, '<br>')}</p>`)
        .join('');
      return `
        <article class="row g-5 profile-item">
          <div class="col-lg-5 reveal">
            ${p.photo ? `<img class="profile-photo" src="${esc(p.photo)}" alt="${esc(p.name || 'Foto profil')}" loading="lazy">` : ''}
            <div class="profile-name">${esc(p.name)}</div>
            <div class="profile-role">${esc(p.role)}</div>
            <div class="profile-loc">${esc(p.location)}</div>
          </div>
          <div class="col-lg-7">
            <div class="bio reveal">${bio}</div>
          </div>
        </article>`;
    })
    .join('');
}

/* Kategori diketik bebas oleh admin → daftar filter dibuat dinamis dari proyek.
   Spasi dipangkas, huruf besar/kecil dianggap sama ("Rumah" = "rumah"),
   kategori kosong diabaikan. */
const catOf = (p) => String(p?.category ?? '').trim();
const sameCat = (a, b) => a.toLowerCase() === b.toLowerCase();

function uniqueCategories() {
  const seen = new Map(); // kunci huruf kecil → nama tampilan pertama
  state.projects.forEach((p) => {
    const c = catOf(p);
    if (c && !seen.has(c.toLowerCase())) seen.set(c.toLowerCase(), c);
  });
  return [...seen.values()];
}

function renderFilters() {
  const cats = uniqueCategories();
  // Tanpa kategori sama sekali, tombol filter tidak ditampilkan
  if (!cats.length) {
    $('#filters').innerHTML = '';
    return;
  }
  $('#filters').innerHTML = ['Semua', ...cats]
    .map((c) => `<button type="button" class="filter-btn${sameCat(c, state.filter) ? ' is-active' : ''}" data-filter="${esc(c)}">${esc(c)}</button>`)
    .join('');
}

function renderWorks() {
  const has = state.projects.length > 0;
  show($('#worksEmpty'), !has);
  show($('#worksBar'), has);
  show($('#worksGalleryWrap'), has);
  $('#worksCount').textContent = has ? '' : '(03)';
  if (!has) return;

  // Bila kategori yang dipilih sudah tidak ada (mis. proyeknya dihapus), kembali ke "Semua"
  if (!uniqueCategories().some((c) => sameCat(c, state.filter))) state.filter = 'Semua';
  const list = state.filter === 'Semua'
    ? state.projects
    : state.projects.filter((p) => sameCat(catOf(p), state.filter));
  const gallery = $('#worksGallery');

  $('#worksCount').textContent = `(${pad2(list.length)} proyek)`;
  $('.drag-track', gallery).innerHTML = list.map(slideHTML).join('');
  gallery.scrollLeft = 0;
  updateGallery(gallery);
}

function contactValueHTML(it) {
  if (it.type === 'email') return `<a href="mailto:${esc(it.value)}">${esc(it.value)}</a>`;
  if (it.type === 'phone') return `<a href="tel:${esc(it.value.replace(/[^\d+]/g, ''))}">${esc(it.value)}</a>`;
  return esc(it.value);
}

function renderContact() {
  const { contact } = state.content;
  const filled = Boolean(contact.items.length || contact.socials.length);

  show($('#contactEmpty'), !filled);
  show($('#contactBody'), filled);
  if (!filled) return;

  $('#contactHeadline').textContent = contact.headline || 'Mari bicara.';

  $('#contactList').innerHTML = contact.items
    .map((it) => `<div><dt>${esc(it.label)}</dt><dd>${contactValueHTML(it)}</dd></div>`)
    .join('');
  show($('#contactList'), contact.items.length > 0);

  $('#contactSocials').innerHTML = contact.socials
    .map((s) => `<li><a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.label)}</a></li>`)
    .join('');
}

/* ----------------------------------------------------------
   5. Modal detail proyek
   ---------------------------------------------------------- */
function openProject(id) {
  const p = state.projects.find((item) => item.id === id);
  if (!p) return;

  const img = $('#modalImg');
  img.src = p.image;
  img.alt = p.alt || p.title;
  $('#modalCat').textContent = [catOf(p), p.year].filter(Boolean).join(' — ');
  $('#modalTitle').textContent = p.title;
  $('#modalDesc').textContent = p.description || '';
  show($('#modalDesc'), Boolean(p.description));
  $('#modalMeta').innerHTML = p.location ? `<dt>Lokasi</dt><dd>${esc(p.location)}</dd>` : '';

  state.modal.show();
}

function initProjectClicks() {
  document.addEventListener('click', (e) => {
    if (e.target.closest('.slide-edit')) return; // pensil → pindah ke admin, jangan buka modal
    const slide = e.target.closest('[data-project]');
    if (slide) openProject(slide.dataset.project);
  });
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-project]')) {
      e.preventDefault();
      openProject(e.target.dataset.project);
    }
  });

  $('#filters').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    state.filter = btn.dataset.filter;
    renderFilters();
    renderWorks();
  });
}

/* ----------------------------------------------------------
   6. Efek scroll: reveal, scroll-spy, jam
   ---------------------------------------------------------- */
let revealObserver;
function setupReveals() {
  if (!revealObserver) {
    revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('in');
        revealObserver.unobserve(entry.target);
      });
    }, { threshold: 0.15 });
  }
  $$('.reveal:not(.in)').forEach((el) => revealObserver.observe(el));
}

function initScrollSpy() {
  const sections = $$('main section[id]');
  const links = $$('.menu-list a');
  const spy = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const index = sections.indexOf(entry.target);
      $('#railIndex').textContent = pad2(index + 1);
      $('#railLabel').textContent = entry.target.dataset.label || '';
      links.forEach((a) => a.classList.toggle('is-current', a.getAttribute('href') === `#${entry.target.id}`));
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  sections.forEach((s) => spy.observe(s));
}

function initClock() {
  const el = $('#headerClock');
  const tick = () => {
    const tz = state.content?.settings?.timezone || 'Asia/Jakarta';
    try {
      el.textContent = new Intl.DateTimeFormat('id-ID', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz
      }).format(new Date()).replace('.', ':');
    } catch {
      el.textContent = '';
    }
  };
  tick();
  setInterval(tick, 15000);
}

/* ----------------------------------------------------------
   7. Mode terang / gelap (pilihan disimpan di localStorage)
   ---------------------------------------------------------- */
function initTheme() {
  const root = document.documentElement;
  const metaTheme = $('meta[name="theme-color"]');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const barColor = { dark: '#0a0a0a', light: '#f3f2ed' };

  const apply = (theme) => {
    root.setAttribute('data-bs-theme', theme);
    if (metaTheme) metaTheme.setAttribute('content', barColor[theme]);
    const next = theme === 'dark' ? 'light' : 'dark';
    $$('[data-theme-toggle]').forEach((btn) => {
      btn.setAttribute('aria-label', `Ganti ke mode ${next === 'light' ? 'terang' : 'gelap'}`);
      const label = $('.theme-label', btn);
      if (label) label.textContent = next === 'light' ? 'Light' : 'Dark';
    });
  };

  apply(root.getAttribute('data-bs-theme') === 'light' ? 'light' : 'dark');

  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-theme-toggle]')) return;
    const next = root.getAttribute('data-bs-theme') === 'light' ? 'dark' : 'light';
    if (!reduceMotion) {
      root.classList.add('theme-anim');
      setTimeout(() => root.classList.remove('theme-anim'), 500);
    }
    apply(next);
    try { localStorage.setItem('theme', next); } catch { /* penyimpanan diblokir, abaikan */ }
  });
}

/* ----------------------------------------------------------
   8. Ambil data dari API & inisialisasi
   ---------------------------------------------------------- */
async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  let body = null;
  try { body = await res.json(); } catch { /* bukan JSON */ }
  if (!res.ok) throw new Error((body && body.error) || `HTTP ${res.status}`);
  return body;
}

function normalizeContent(c) {
  return {
    profiles: Array.isArray(c?.profiles) ? c.profiles : [],
    contact: {
      headline: '',
      ...c?.contact,
      items: Array.isArray(c?.contact?.items) ? c.contact.items : [],
      socials: Array.isArray(c?.contact?.socials) ? c.contact.socials : []
    },
    settings: { siteName: '', heroTitle: '', heroIntro: '', timezone: 'Asia/Jakarta', navProfile: '', navPortfolio: '', logo1: '', logo2: '', ...c?.settings }
  };
}

async function init() {
  $('#year').textContent = new Date().getFullYear();

  initTheme();
  menu.init();
  initNavLinks();
  initCursor();
  initProjectClicks();
  initScrollSpy();

  state.modal = new bootstrap.Modal($('#projectModal'));
  makeDraggable($('#heroGallery'));
  makeDraggable($('#worksGallery'));
  window.addEventListener('resize', () => galleries.forEach(updateGallery));

  try {
    const [content, photos] = await Promise.all([fetchJson('/api/content'), fetchJson('/api/photos')]);
    state.content = normalizeContent(content);
    state.projects = Array.isArray(photos.projects) ? photos.projects.slice().sort(byOrder) : [];
  } catch (err) {
    console.error('Gagal memuat konten:', err);
    state.content = normalizeContent(null);
    state.projects = [];
    $('#dataErrorText').textContent =
      'Pastikan situs dibuka dari Vercel (bukan file langsung) dan Blob store sudah terhubung.';
    show($('#dataError'), true);
  }

  renderHeader();
  renderLabels();
  renderHero();
  renderProfile();
  renderFilters();
  renderWorks();
  renderContact();

  initClock();
  setupReveals();
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('is-ready')));
}

document.addEventListener('DOMContentLoaded', init);