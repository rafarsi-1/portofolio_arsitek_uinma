'use strict';

/* ==========================================================
   Dashboard admin
   - Login: password dicek server (ADMIN_PASSWORD), disimpan di sessionStorage
     (hilang saat tab ditutup)
   - Konten teks: GET/POST /api/content
   - Foto:        GET/DELETE /api/photos, POST /api/upload
   ========================================================== */

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

const SESSION_KEY = 'adm_pw';
const MAX_BYTES = 4 * 1024 * 1024; // batas server (Vercel Functions ±4,5 MB)
const MAX_EDGE = 2400;             // sisi terpanjang setelah diperkecil (px)
const DEFAULT_CATEGORIES = ['Residensial', 'Komersial', 'Interior', 'Publik', 'Lanskap'];

let password = '';
let photos = [];
let busy = false;

try { password = sessionStorage.getItem(SESSION_KEY) || ''; } catch { /* diblokir */ }

/* ----------------------------------------------------------
   Util: toast, panggilan API
   ---------------------------------------------------------- */
let toastTimer;
function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('is-error', isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 6000 : 3500);
}

async function api(url, { method = 'GET', json, form, quiet401 = false } = {}) {
  const headers = { 'x-admin-password': password, Accept: 'application/json' };
  let body;
  if (form) {
    body = form; // FormData: jangan set Content-Type, browser mengisi boundary-nya
  } else if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  }
  const target = method === 'GET' ? `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}` : url;

  let res;
  try {
    res = await fetch(target, { method, headers, body, cache: 'no-store' });
  } catch {
    throw new Error('Tidak dapat menghubungi server. Periksa koneksi internet.');
  }

  let data = null;
  try { data = await res.json(); } catch { /* bukan JSON */ }

  if (res.status === 401 && !quiet401) {
    logout('Sesi berakhir atau password berubah. Silakan masuk lagi.');
    throw new Error('Sesi berakhir.');
  }
  if (res.status === 404 && !data) {
    throw new Error('API tidak ditemukan. Buka lewat domain Vercel (atau jalankan "vercel dev").');
  }
  if (!res.ok) throw new Error((data && data.error) || `Permintaan gagal (HTTP ${res.status}).`);
  return data;
}

function setBusy(button, value, label) {
  busy = value;
  button.disabled = value;
  if (label) $('.btn-text', button).textContent = label;
}

/* ----------------------------------------------------------
   Login / logout
   ---------------------------------------------------------- */
function showLogin(message = '', isError = false) {
  $('#appView').hidden = true;
  $('#loginView').hidden = false;
  const status = $('#loginStatus');
  status.textContent = message;
  status.classList.toggle('is-error', isError);
  $('#loginPassword').value = '';
  $('#loginPassword').focus();
}

/* Urutan sama dengan server & situs: pinned → terlama → terbaru */
const byOrder = (a, b) =>
  (b.pinned === true) - (a.pinned === true) ||
  String(a.uploadedAt).localeCompare(String(b.uploadedAt)) ||
  String(a.id).localeCompare(String(b.id));

function logout(message = '') {
  try { localStorage.removeItem('adm_on'); } catch { /* diblokir */ }
  password = '';
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* diblokir */ }
  photos = [];
  showLogin(message, Boolean(message));
}

async function enterDashboard() {
  const [content, list] = await Promise.all([api('/api/content'), api('/api/photos')]);
  fillContent(content);
  photos = Array.isArray(list.projects) ? list.projects.slice().sort(byOrder) : [];
  renderPhotos();
  $('#loginView').hidden = true;
  $('#appView').hidden = false;
  try { localStorage.setItem('adm_on', '1'); } catch { /* diblokir */ } // memunculkan tombol edit di situs publik
  openTab(location.hash.slice(1) || 'profile');

  // Datang dari tombol pensil di situs publik: admin.html?edit=<id>
  const editId = new URLSearchParams(location.search).get('edit');
  if (editId) {
    openTab('portfolio');
    openEdit(editId);
    history.replaceState(null, '', `${location.pathname}#portfolio`);
  }
}

function initLogin() {
  const form = $('#loginForm');
  const btn = $('#loginBtn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    const value = $('#loginPassword').value;
    if (!value) return;

    password = value;
    setBusy(btn, true, 'Memeriksa…');
    try {
      await api('/api/content?verify=1', { quiet401: true });
      try { sessionStorage.setItem(SESSION_KEY, password); } catch { /* diblokir */ }
      await enterDashboard();
    } catch (err) {
      password = '';
      showLogin(err.message, true);
    } finally {
      setBusy(btn, false, 'Masuk');
    }
  });

  $('#logoutBtn').addEventListener('click', () => logout());
}

/* ----------------------------------------------------------
   Tab
   ---------------------------------------------------------- */
function openTab(name) {
  const tabs = $$('.adm-tab');
  if (!tabs.some((t) => t.dataset.tab === name)) name = 'profile';
  tabs.forEach((t) => {
    const active = t.dataset.tab === name;
    t.classList.toggle('is-active', active);
    t.setAttribute('aria-selected', String(active));
  });
  $$('.adm-panel').forEach((p) => { p.hidden = p.id !== `tab-${name}`; });
  history.replaceState(null, '', `#${name}`);
}

function initTabs() {
  $('.adm-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) openTab(tab.dataset.tab);
  });
}

/* ----------------------------------------------------------
   Konten teks (profil, kontak, pengaturan)
   ---------------------------------------------------------- */
const MAX_PROFILES = 10;
const MAX_CONTACTS = 12;
const MAX_SOCIALS = 8;

const CONTACT_TYPES = {
  email:   { label: 'Email',   defaultLabel: 'Email',   placeholder: 'nama@domain.com' },
  phone:   { label: 'Telepon', defaultLabel: 'Telepon', placeholder: '+62 ...' },
  address: { label: 'Alamat',  defaultLabel: 'Studio',  placeholder: 'Jl. ... No. ...' },
  other:   { label: 'Lainnya', defaultLabel: 'Info',    placeholder: 'Isi informasi' }
};

/* ----- Profil (banyak) ----- */
function addProfileRow(p = {}) {
  const card = document.createElement('div');
  card.className = 'adm-item profile-row';
  card.innerHTML = `
    <div class="adm-item-head">
      <strong class="adm-item-title">Profil</strong>
      <span class="adm-item-tools">
        <button type="button" class="adm-btn adm-x" data-move="-1" aria-label="Naikkan">↑</button>
        <button type="button" class="adm-btn adm-x" data-move="1" aria-label="Turunkan">↓</button>
        <button type="button" class="adm-btn adm-btn-danger adm-x" data-remove aria-label="Hapus profil">Hapus</button>
      </span>
    </div>
    <div class="a-field">
      <label>Foto profil</label>
      <div class="adm-avatar">
        <img class="p-photo-img" alt="Foto profil" src="${esc(p.photo || '')}"${p.photo ? '' : ' hidden'}>
        <div class="adm-avatar-actions">
          <input class="a-input a-file p-photo-file" type="file" accept="image/jpeg,image/png,image/webp,image/avif" aria-label="Pilih foto profil">
          <button type="button" class="adm-btn" data-photo-remove${p.photo ? '' : ' hidden'}>Hapus foto</button>
          <small class="a-hint p-photo-status">JPG, PNG, WebP, atau AVIF. Otomatis diperkecil.</small>
        </div>
      </div>
    </div>
    <div class="a-field">
      <label>Nama</label>
      <input class="a-input p-name" maxlength="80" autocomplete="off" value="${esc(p.name)}">
    </div>
    <div class="a-field">
      <label>Judul / Role</label>
      <input class="a-input p-role" maxlength="80" placeholder="mis. Arsitek &amp; Desainer Interior" autocomplete="off" value="${esc(p.role)}">
    </div>
    <div class="a-field">
      <label>Lokasi</label>
      <input class="a-input p-loc" maxlength="80" placeholder="mis. Surabaya, Indonesia" autocomplete="off" value="${esc(p.location)}">
    </div>
    <div class="a-field">
      <label>Deskripsi bio</label>
      <textarea class="a-input p-bio" rows="6" maxlength="3000">${esc(p.bio)}</textarea>
      <small class="a-hint">Pisahkan paragraf dengan satu baris kosong.</small>
    </div>`;
  card.dataset.photo = p.photo || '';
  $('#profileRows').appendChild(card);
  refreshProfiles();
  return card;
}

function refreshProfiles() {
  const rows = $$('.profile-row');
  rows.forEach((row, i) => {
    $('.adm-item-title', row).textContent = i === 0 ? 'Profil 1 (dipakai di header)' : `Profil ${i + 1}`;
    $('[data-move="-1"]', row).disabled = i === 0;
    $('[data-move="1"]', row).disabled = i === rows.length - 1;
  });
  $('#profileCount').textContent = `${rows.length} profil`;
  $('#profileEmptyAdm').hidden = rows.length > 0;
  $('#addProfile').disabled = rows.length >= MAX_PROFILES;
}

/* ----- Kontak (banyak) ----- */
function addContactRow(it = {}) {
  const type = CONTACT_TYPES[it.type] ? it.type : 'email';
  const row = document.createElement('div');
  row.className = 'adm-item contact-row';
  row.innerHTML = `
    <div class="adm-contact-grid">
      <select class="a-input c-type" aria-label="Jenis">
        ${Object.entries(CONTACT_TYPES)
          .map(([k, v]) => `<option value="${k}"${k === type ? ' selected' : ''}>${v.label}</option>`)
          .join('')}
      </select>
      <input class="a-input c-label" maxlength="40" placeholder="Nama (mis. Email kerja)" aria-label="Nama" autocomplete="off" value="${esc(it.label)}">
      <button type="button" class="adm-btn adm-btn-danger adm-x" data-remove aria-label="Hapus kontak">×</button>
      <textarea class="a-input c-value" rows="1" maxlength="300" aria-label="Isi" placeholder="${esc(CONTACT_TYPES[type].placeholder)}">${esc(it.value)}</textarea>
    </div>`;
  $('#contactRows').appendChild(row);
  refreshContacts();
  return row;
}

function refreshContacts() {
  $('#addContact').disabled = $$('.contact-row').length >= MAX_CONTACTS;
}

/* ----- Sosial media (banyak) ----- */
function addSocialRow(label = '', url = '') {
  const row = document.createElement('div');
  row.className = 'adm-social-row';
  row.innerHTML = `
    <input class="a-input s-label" list="socialNames" maxlength="30" placeholder="Instagram" aria-label="Nama" value="${esc(label)}">
    <input class="a-input s-url" type="url" maxlength="300" placeholder="https://instagram.com/akunmu" aria-label="Link" value="${esc(url)}">
    <button type="button" class="adm-btn adm-x" aria-label="Hapus link">×</button>`;
  $('#socialRows').appendChild(row);
}

/* ----- Isi form dari data server ----- */
function fillContent(content) {
  // Field tunggal (kalimat ajakan + pengaturan)
  $$('[data-path]').forEach((el) => {
    const [group, key] = el.dataset.path.split('.');
    el.value = content?.[group]?.[key] ?? el.value ?? '';
  });

  $('#profileRows').innerHTML = '';
  (content?.profiles || []).forEach((p) => addProfileRow(p));
  refreshProfiles();

  $('#contactRows').innerHTML = '';
  (content?.contact?.items || []).forEach((it) => addContactRow(it));
  refreshContacts();

  $('#socialRows').innerHTML = '';
  (content?.contact?.socials || []).forEach((s) => addSocialRow(s.label, s.url));

  $$('.adm-logo').forEach((box) => box._sync?.());
}

/* ----- Kumpulkan data untuk dikirim ----- */
function collectContent() {
  const out = { profiles: [], contact: {}, settings: {} };

  $$('[data-path]').forEach((el) => {
    const [group, key] = el.dataset.path.split('.');
    out[group][key] = el.value.trim();
  });

  out.profiles = $$('.profile-row')
    .map((row) => ({
      photo: row.dataset.photo || '',
      name: $('.p-name', row).value.trim(),
      role: $('.p-role', row).value.trim(),
      location: $('.p-loc', row).value.trim(),
      bio: $('.p-bio', row).value.trim()
    }))
    .filter((p) => p.photo || p.name || p.role || p.location || p.bio);

  out.contact.items = $$('.contact-row')
    .map((row) => ({
      type: $('.c-type', row).value,
      label: $('.c-label', row).value.trim(),
      value: $('.c-value', row).value.trim()
    }))
    .filter((it) => it.value);

  out.contact.socials = $$('.adm-social-row')
    .map((row) => {
      let url = $('.s-url', row).value.trim();
      if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
      return { label: $('.s-label', row).value.trim(), url };
    })
    .filter((s) => s.label || s.url);

  return out;
}

async function saveContent(button) {
  if (busy) return;
  const original = $('.btn-text', button).textContent;
  setBusy(button, true, 'Menyimpan…');
  try {
    const { content } = await api('/api/content', { method: 'POST', json: collectContent() });
    fillContent(content); // tampilkan versi yang sudah dirapikan server
    toast('Tersimpan. Perubahan tampil di situs dalam beberapa detik.');
  } catch (err) {
    if (err.message !== 'Sesi berakhir.') toast(err.message, true);
  } finally {
    setBusy(button, false, original);
  }
}

/* Unggah foto profil (satu per kartu profil) */
async function uploadProfilePhoto(card, file) {
  const status = $('.p-photo-status', card);
  const input = $('.p-photo-file', card);
  const idle = 'JPG, PNG, WebP, atau AVIF. Otomatis diperkecil.';

  if (!file.type.startsWith('image/')) {
    input.value = '';
    return toast('File harus berupa gambar.', true);
  }

  try {
    input.disabled = true;
    status.textContent = 'Memproses foto…';
    const image = await prepareImage(file, 1600);

    const data = new FormData();
    data.set('file', image, image.name);

    status.textContent = 'Mengunggah…';
    let res;
    try {
      res = await fetch('/api/profile-photo', { method: 'POST', headers: { 'x-admin-password': password }, body: data });
    } catch {
      throw new Error('Tidak dapat menghubungi server. Periksa koneksi internet.');
    }
    let body = null;
    try { body = await res.json(); } catch { /* bukan JSON */ }

    if (res.status === 401) {
      logout('Sesi berakhir atau password berubah. Silakan masuk lagi.');
      throw new Error('Sesi berakhir.');
    }
    if (res.status === 413) throw new Error('File terlalu besar. Maksimal 4 MB.');
    if (!res.ok || !body?.url) throw new Error(body?.error || `Unggah gagal (HTTP ${res.status}).`);

    card.dataset.photo = body.url;
    const img = $('.p-photo-img', card);
    img.src = body.url;
    img.hidden = false;
    $('[data-photo-remove]', card).hidden = false;
    toast('Foto terunggah. Klik “Simpan profil” untuk menerapkan.');
  } catch (err) {
    if (err.message !== 'Sesi berakhir.') toast(err.message || 'Unggah foto gagal.', true);
  } finally {
    input.value = '';
    input.disabled = false;
    status.textContent = idle;
  }
}

function initContentForms() {
  $$('[data-save]').forEach((btn) => btn.addEventListener('click', () => saveContent(btn)));

  /* Profil: tambah, hapus, geser urutan */
  $('#addProfile').addEventListener('click', () => {
    if ($$('.profile-row').length >= MAX_PROFILES) return toast(`Maksimal ${MAX_PROFILES} profil.`, true);
    const card = addProfileRow();
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('.p-name', card).focus({ preventScroll: true });
  });

  $('#profileRows').addEventListener('click', (e) => {
    const card = e.target.closest('.profile-row');
    if (!card) return;

    if (e.target.closest('[data-remove]')) {
      const filled = Boolean(card.dataset.photo) || $$('input[type=text], input:not([type]), textarea', card).some((el) => el.value.trim());
      if (filled && !confirm('Hapus profil ini? (Baru benar-benar hilang setelah kamu klik Simpan.)')) return;
      card.remove();
      refreshProfiles();
      return;
    }

    const move = e.target.closest('[data-move]');
    if (move) {
      const dir = Number(move.dataset.move);
      if (dir < 0 && card.previousElementSibling) card.parentNode.insertBefore(card, card.previousElementSibling);
      if (dir > 0 && card.nextElementSibling) card.parentNode.insertBefore(card.nextElementSibling, card);
      refreshProfiles();
    }
  });

  $('#profileRows').addEventListener('change', (e) => {
    if (!e.target.matches('.p-photo-file')) return;
    const file = e.target.files[0];
    if (file) uploadProfilePhoto(e.target.closest('.profile-row'), file);
  });

  $('#profileRows').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-photo-remove]');
    if (!btn) return;
    const card = btn.closest('.profile-row');
    card.dataset.photo = '';
    const img = $('.p-photo-img', card);
    img.hidden = true;
    img.removeAttribute('src');
    btn.hidden = true;
  });

  /* Kontak: tambah, hapus, ganti jenis */
  $('#addContact').addEventListener('click', () => {
    if ($$('.contact-row').length >= MAX_CONTACTS) return toast(`Maksimal ${MAX_CONTACTS} kontak.`, true);
    const row = addContactRow();
    $('.c-value', row).focus();
  });

  $('#contactRows').addEventListener('click', (e) => {
    if (e.target.closest('[data-remove]')) {
      e.target.closest('.contact-row').remove();
      refreshContacts();
    }
  });

  $('#contactRows').addEventListener('change', (e) => {
    if (!e.target.matches('.c-type')) return;
    const row = e.target.closest('.contact-row');
    $('.c-value', row).placeholder = CONTACT_TYPES[e.target.value].placeholder;
  });

  /* Sosial media: tambah, hapus */
  $('#addSocial').addEventListener('click', () => {
    if ($$('.adm-social-row').length >= MAX_SOCIALS) return toast(`Maksimal ${MAX_SOCIALS} link sosial media.`, true);
    addSocialRow();
    $$('.s-label').at(-1).focus();
  });
  $('#socialRows').addEventListener('click', (e) => {
    const btn = e.target.closest('.adm-x');
    if (btn) btn.closest('.adm-social-row').remove();
  });
}

/* ----------------------------------------------------------
   Portfolio: daftar, hapus
   ---------------------------------------------------------- */
function renderPhotos() {
  $('#photoGrid').innerHTML = photos
    .map((p, i) => `
      <article class="adm-photo" data-id="${esc(p.id)}">
        <div class="adm-photo-media">
          <img src="${esc(p.image)}" alt="${esc(p.alt || p.title)}" loading="lazy">
          <span class="adm-photo-no">${String(i + 1).padStart(2, '0')}</span>
        </div>
        <div class="adm-photo-info">
          <strong>${esc(p.title)}</strong>
          <span>${esc(p.category)}${p.year ? ' · ' + esc(p.year) : ''}</span>
        </div>
        <div class="adm-photo-actions">
          <button type="button" class="adm-del adm-edit-btn" data-edit="${esc(p.id)}">Edit</button>
          <button type="button" class="adm-del" data-del="${esc(p.id)}">Hapus</button>
        </div>
      </article>`)
    .join('');

  $('#photoEmpty').hidden = photos.length > 0;
  $('#photoCount').textContent = `${photos.length} foto`;

  const cats = [...new Set([...DEFAULT_CATEGORIES, ...photos.map((p) => p.category)])];
  $('#upCategories').innerHTML = cats.map((c) => `<option value="${esc(c)}"></option>`).join('');
}

/* ----------------------------------------------------------
   Portfolio: edit proyek (judul, kategori, tahun, lokasi, deskripsi, gambar, kunci 01)
   ---------------------------------------------------------- */
let editing = null;
let editPreviewUrl = null;

function openEdit(id) {
  const p = photos.find((item) => item.id === id);
  if (!p) return toast('Proyek tidak ditemukan.', true);
  editing = p;

  $('#edTitle').value = p.title || '';
  $('#edCategory').value = p.category || '';
  $('#edYear').value = p.year || '';
  $('#edLocation').value = p.location || '';
  $('#edDesc').value = p.description || '';
  $('#edPinned').checked = p.pinned === true;
  $('#edFile').value = '';
  $('#edPreview').src = p.image;
  $('#editForm').classList.remove('was-validated');
  if (editPreviewUrl) { URL.revokeObjectURL(editPreviewUrl); editPreviewUrl = null; }
  $('#editDialog').showModal();
}

function initEdit() {
  const dialog = $('#editDialog');
  const form = $('#editForm');
  const save = $('#edSave');

  $('#photoGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-edit]');
    if (btn) openEdit(btn.dataset.edit);
  });
  $('#edCancel').addEventListener('click', () => dialog.close());

  $('#edFile').addEventListener('change', () => {
    const file = $('#edFile').files[0];
    if (editPreviewUrl) URL.revokeObjectURL(editPreviewUrl);
    editPreviewUrl = file ? URL.createObjectURL(file) : null;
    $('#edPreview').src = editPreviewUrl || editing?.image || '';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy || !editing) return;
    if (!form.checkValidity()) { form.classList.add('was-validated'); return; }

    const data = new FormData();
    data.set('title', $('#edTitle').value);
    data.set('category', $('#edCategory').value);
    data.set('year', $('#edYear').value);
    data.set('location', $('#edLocation').value);
    data.set('description', $('#edDesc').value);
    data.set('pinned', $('#edPinned').checked ? '1' : '0');

    try {
      setBusy(save, true, 'Menyimpan…');
      const file = $('#edFile').files[0];
      if (file) {
        const image = await prepareImage(file);
        data.set('file', image, image.name);
      }
      const { project } = await api(`/api/photos?id=${encodeURIComponent(editing.id)}`, { method: 'PUT', form: data });

      // pin hanya boleh satu: lepas pin di proyek lain pada daftar lokal
      photos = photos
        .map((p) => (p.id === project.id ? project : project.pinned ? { ...p, pinned: false } : p))
        .sort(byOrder);
      renderPhotos();
      dialog.close();
      toast('Perubahan proyek disimpan.');
    } catch (err) {
      if (err.message !== 'Sesi berakhir.') toast(err.message || 'Gagal menyimpan.', true);
    } finally {
      setBusy(save, false, 'Simpan');
    }
  });
}

/* ----------------------------------------------------------
   Pengaturan: 2 logo header (URL atau unggah file)
   Unggahan memakai /api/profile-photo (hasilnya URL), lalu disimpan lewat "Simpan pengaturan".
   ---------------------------------------------------------- */
async function postImage(file, maxEdge) {
  const image = await prepareImage(file, maxEdge);
  const data = new FormData();
  data.set('file', image, image.name);

  let res;
  try {
    res = await fetch('/api/profile-photo', { method: 'POST', headers: { 'x-admin-password': password }, body: data });
  } catch {
    throw new Error('Tidak dapat menghubungi server. Periksa koneksi internet.');
  }
  const body = await res.json().catch(() => null);
  if (res.status === 401) {
    logout('Sesi berakhir atau password berubah. Silakan masuk lagi.');
    throw new Error('Sesi berakhir.');
  }
  if (!res.ok || !body?.url) throw new Error(body?.error || `Unggah gagal (HTTP ${res.status}).`);
  return body.url;
}

function initLogos() {
  $$('.adm-logo').forEach((box) => {
    const urlInput = $('.a-input', box);
    const img = $('.adm-logo-img', box);
    const clear = $('.adm-logo-clear', box);
    const fileInput = $('.adm-logo-file', box);

    const sync = () => {
      const url = urlInput.value.trim();
      const valid = /^https?:\/\//i.test(url);
      img.hidden = !valid;
      if (valid) img.src = url; else img.removeAttribute('src');
      box.classList.toggle('has-logo', valid);
      clear.hidden = !url;
    };
    box._sync = sync;

    urlInput.addEventListener('input', sync);
    clear.addEventListener('click', () => { urlInput.value = ''; sync(); });

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      try {
        fileInput.disabled = true;
        // maxEdge besar: logo kecil tidak diproses ulang (PNG transparan tetap transparan)
        urlInput.value = await postImage(file, 4000);
        sync();
        toast('Logo terunggah. Klik “Simpan pengaturan” untuk menerapkan.');
      } catch (err) {
        if (err.message !== 'Sesi berakhir.') toast(err.message || 'Unggah logo gagal.', true);
      } finally {
        fileInput.value = '';
        fileInput.disabled = false;
      }
    });
  });
}

function initDelete() {
  const dialog = $('#delDialog');
  const confirmBtn = $('#delConfirm');
  let pendingId = null;

  $('#photoGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-del]');
    if (!btn) return;
    const project = photos.find((p) => p.id === btn.dataset.del);
    if (!project) return;
    pendingId = project.id;
    $('#delName').textContent = project.title;
    dialog.showModal();
  });

  confirmBtn.addEventListener('click', async () => {
    if (!pendingId || busy) return;
    const id = pendingId;
    busy = true;
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Menghapus…';
    try {
      await api(`/api/photos?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      photos = photos.filter((p) => p.id !== id);
      renderPhotos();
      toast('Proyek dihapus.');
    } catch (err) {
      if (err.message !== 'Sesi berakhir.') toast(err.message, true);
    } finally {
      busy = false;
      pendingId = null;
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Hapus permanen';
      dialog.close();
    }
  });
}

/* ----------------------------------------------------------
   Portfolio: unggah foto
   ---------------------------------------------------------- */
const toBlob = (canvas, type, quality) =>
  new Promise((resolve) => canvas.toBlob(resolve, type, quality));

/** Perkecil gambar agar lolos batas ±4,5 MB Vercel Functions. */
async function prepareImage(file, maxEdge = MAX_EDGE) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    if (file.size <= MAX_BYTES) return file; // biarkan server yang memvalidasi
    throw new Error('Gambar tidak dapat diproses. Pilih file di bawah 4 MB.');
  }

  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= MAX_BYTES) {
    bitmap.close?.();
    return file; // sudah cukup kecil, kirim apa adanya
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // PNG transparan → latar putih
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  let blob = await toBlob(canvas, 'image/webp', 0.85);
  if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', 0.85);
  if (!blob || blob.size > MAX_BYTES) {
    throw new Error('Foto masih terlalu besar setelah dikompres (maks. 4 MB).');
  }
  const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
  return new File([blob], `photo.${ext}`, { type: blob.type });
}

/** Kirim dengan XHR agar ada progres unggah. */
function sendUpload(formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.setRequestHeader('x-admin-password', password);
    xhr.responseType = 'json';
    xhr.timeout = 60000;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      const body = xhr.response;
      if (xhr.status >= 200 && xhr.status < 300 && body && body.project) {
        resolve(body.project);
      } else if (xhr.status === 401) {
        logout('Sesi berakhir atau password berubah. Silakan masuk lagi.');
        reject(new Error('Sesi berakhir.'));
      } else if (xhr.status === 413) {
        reject(new Error('File terlalu besar. Maksimal 4 MB.'));
      } else {
        reject(new Error((body && body.error) || `Unggah gagal (HTTP ${xhr.status}).`));
      }
    };
    xhr.onerror = () => reject(new Error('Tidak dapat menghubungi server. Periksa koneksi internet.'));
    xhr.ontimeout = () => reject(new Error('Waktu unggah habis. Coba lagi.'));
    xhr.send(formData);
  });
}

function initUpload() {
  const form = $('#uploadForm');
  const fileInput = $('#upFile');
  const preview = $('#upPreview');
  const progress = $('#upProgress');
  const bar = $('#upBar');
  const submit = $('#upSubmit');
  let previewUrl = null;

  $('#upYear').value = new Date().getFullYear();

  const clearPreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    preview.hidden = true;
    preview.removeAttribute('src');
  };

  fileInput.addEventListener('change', () => {
    clearPreview();
    const file = fileInput.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      fileInput.value = '';
      toast('File harus berupa gambar.', true);
      return;
    }
    previewUrl = URL.createObjectURL(file);
    preview.src = previewUrl;
    preview.hidden = false;
    // isi judul otomatis dari nama file bila masih kosong
    const title = $('#upTitle');
    if (!title.value) {
      title.value = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim().slice(0, 80);
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;

    if (!form.checkValidity()) {
      form.classList.add('was-validated');
      return;
    }

    progress.hidden = false;
    bar.style.width = '0%';

    try {
      setBusy(submit, true, 'Memproses foto…');
      const image = await prepareImage(fileInput.files[0]);

      const data = new FormData(form);
      data.set('file', image, image.name);

      setBusy(submit, true, 'Mengunggah… 0%');
      const project = await sendUpload(data, (ratio) => {
        const pct = Math.round(ratio * 100);
        bar.style.width = `${pct}%`;
        $('.btn-text', submit).textContent = `Mengunggah… ${pct}%`;
      });

      photos.push(project);          // proyek baru masuk PALING AKHIR (nomor berikutnya)
      photos.sort(byOrder);
      renderPhotos();
      form.reset();
      form.classList.remove('was-validated');
      $('#upYear').value = new Date().getFullYear();
      clearPreview();
      toast(`“${project.title}” berhasil diunggah.`);
    } catch (err) {
      if (err.message !== 'Sesi berakhir.') toast(err.message || 'Unggah gagal. Coba lagi.', true);
    } finally {
      setBusy(submit, false, 'Unggah');
      progress.hidden = true;
      bar.style.width = '0%';
    }
  });
}

async function init() {
  initLogin();
  initTabs();
  initContentForms();
  initDelete();
  initEdit();
  initLogos();
  initUpload();

  if (!password) return showLogin();

  // Ada sesi tersimpan di tab ini → coba masuk otomatis
  try {
    await enterDashboard();
  } catch (err) {
    // 401 sudah ditangani api() (password dikosongkan); sisanya tampilkan pesannya
    if (password) logout(err.message);
  }
}

document.addEventListener('DOMContentLoaded', init);