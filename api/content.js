import { put, list, del } from '@vercel/blob';
import { isAuthorized, isConfigured, rejectUnauthorized, NOT_CONFIGURED } from '../lib/auth.js';


const PATH = 'site/content.json';
const PHOTO_PREFIX = 'profile/';
const CLEANUP_AFTER_MS = 10 * 60 * 1000; // foto yatim dihapus bila sudah > 10 menit
const MAX_BODY = 160 * 1024;
const MAX_PROFILES = 10;
const MAX_CONTACTS = 12;
const MAX_SOCIALS = 8;
const CONTACT_TYPES = ['email', 'phone', 'address', 'other'];
const DEFAULT_LABEL = { email: 'Email', phone: 'Telepon', address: 'Studio', other: 'Info' };

const DEFAULTS = () => ({
  profiles: [],
  contact: { headline: '', items: [], socials: [] },
  settings: { siteName: '', heroTitle: '', heroIntro: '', timezone: 'Asia/Jakarta', navProfile: 'PROFIL', navPortfolio: 'PORTFOLIO', logo1: '', logo2: '' },
  updatedAt: null
});

const send = (data, status = 200, cache = 'no-store') =>
  Response.json(data, { status, headers: { 'Cache-Control': cache } });

/* ---------- Sanitasi ---------- */
const text = (v, max) =>
  String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);

const oneLine = (v, max) => text(v, max).replace(/\s*\n+\s*/g, ' ');

const isHttpUrl = (v) => {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

const isProfilePhoto = (v) => {
  if (!isHttpUrl(v)) return false;
  try { return new URL(v).pathname.includes(`/${PHOTO_PREFIX}`); } catch { return false; }
};

/** URL logo header: kosong atau http(s). */
const logoUrl = (label, v) => {
  const url = oneLine(v, 500);
  if (url && !isHttpUrl(url)) throw new Error(`URL ${label} harus diawali http:// atau https://`);
  return url;
};

const isTimezone = (tz) => {
  try {
    new Intl.DateTimeFormat('id-ID', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

function sanitize(input) {
  const base = DEFAULTS();
  const c = input?.contact ?? {};
  const s = input?.settings ?? {};

  // ----- Profil (boleh banyak) -----
  const profiles = (Array.isArray(input?.profiles) ? input.profiles : [])
    .slice(0, MAX_PROFILES)
    .map((p) => ({
      photo: isProfilePhoto(String(p?.photo ?? '')) ? String(p.photo).slice(0, 500) : '',
      name: oneLine(p?.name, 80),
      role: oneLine(p?.role, 80),
      location: oneLine(p?.location, 80),
      bio: text(p?.bio, 3000)
    }))
    .filter((p) => p.photo || p.name || p.role || p.location || p.bio);

  // ----- Kontak (email / telepon / alamat / lainnya, boleh banyak) -----
  const items = (Array.isArray(c.items) ? c.items : [])
    .slice(0, MAX_CONTACTS)
    .map((it) => {
      const type = CONTACT_TYPES.includes(it?.type) ? it.type : 'other';
      return {
        type,
        label: oneLine(it?.label, 40) || DEFAULT_LABEL[type],
        value: type === 'address' || type === 'other' ? text(it?.value, 300) : oneLine(it?.value, 120)
      };
    })
    .filter((it) => it.value);

  for (const it of items) {
    if (it.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(it.value)) {
      throw new Error(`Format email tidak valid: ${it.value}`);
    }
  }

  const socials = (Array.isArray(c.socials) ? c.socials : [])
    .slice(0, MAX_SOCIALS)
    .map((item) => ({ label: oneLine(item?.label, 30), url: oneLine(item?.url, 300) }))
    .filter((item) => item.label || item.url);

  for (const item of socials) {
    if (!item.label) throw new Error('Setiap link sosial media butuh nama (mis. Instagram).');
    if (!isHttpUrl(item.url)) {
      throw new Error(`Link "${item.label}" harus diawali http:// atau https://`);
    }
  }

  const contact = { headline: oneLine(c.headline, 100), items, socials };

  const tz = oneLine(s.timezone, 60) || base.settings.timezone;
  const settings = {
    siteName: oneLine(s.siteName, 60),
    heroTitle: text(s.heroTitle, 120),
    heroIntro: text(s.heroIntro, 300),
    navProfile: oneLine(s.navProfile, 30) || base.settings.navProfile,
    navPortfolio: oneLine(s.navPortfolio, 30) || base.settings.navPortfolio,
    logo1: logoUrl('logo 1', s.logo1),
    logo2: logoUrl('logo 2', s.logo2),
    timezone: isTimezone(tz) ? tz : base.settings.timezone
  };

  return { profiles, contact, settings, updatedAt: new Date().toISOString() };
}

/* ---------- Baca dari Blob ---------- */
async function readContent() {
  const { blobs } = await list({ prefix: PATH, limit: 5 });
  const blob = blobs.find((b) => b.pathname === PATH);
  if (!blob) return DEFAULTS();

  const res = await fetch(`${blob.url}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Blob HTTP ${res.status}`);
  const saved = await res.json();

  // gabungkan dengan default agar field baru selalu ada
  const d = DEFAULTS();

  // Migrasi data lama: satu "profile" → daftar "profiles"
  let profiles = Array.isArray(saved.profiles) ? saved.profiles : [];
  if (!profiles.length && saved.profile) {
    const p = saved.profile;
    if (p.name || p.role || p.location || p.bio) profiles = [p];
  }

  // Migrasi data lama: email / phone / address → daftar "items"
  let items = Array.isArray(saved.contact?.items) ? saved.contact.items : null;
  if (!items) {
    items = [];
    const old = saved.contact ?? {};
    if (old.email) items.push({ type: 'email', label: 'Email', value: old.email });
    if (old.phone) items.push({ type: 'phone', label: 'Telepon', value: old.phone });
    if (old.address) items.push({ type: 'address', label: 'Studio', value: old.address });
  }

  return {
    profiles,
    contact: {
      headline: saved.contact?.headline ?? '',
      items,
      socials: saved.contact?.socials ?? []
    },
    settings: { ...d.settings, ...saved.settings },
    updatedAt: saved.updatedAt ?? null
  };
}

/* ---------- Hapus foto profil yang tak lagi dipakai ---------- */
async function cleanupPhotos(content) {
  // Foto profil DAN logo header (diunggah lewat /api/profile-photo) jangan ikut terhapus
  const used = new Set(
    [...content.profiles.map((p) => p.photo), content.settings.logo1, content.settings.logo2].filter(Boolean)
  );
  const { blobs } = await list({ prefix: PHOTO_PREFIX, limit: 1000 });
  const stale = blobs.filter(
    (b) => !used.has(b.url) && Date.now() - new Date(b.uploadedAt).getTime() > CLEANUP_AFTER_MS
  );
  if (stale.length) await del(stale.map((b) => b.url));
}

/* ---------- Handler ---------- */
export async function GET(request) {
  try {
    if (!isConfigured()) return send(NOT_CONFIGURED, 500);

    const url = new URL(request.url);
    const admin = isAuthorized(request);

    if (url.searchParams.get('verify')) {
      return admin ? send({ ok: true }) : rejectUnauthorized();
    }

    const content = await readContent();
    return send(
      content,
      200,
      admin ? 'no-store' : 'public, s-maxage=10, stale-while-revalidate=59'
    );
  } catch (err) {
    console.error('Gagal membaca konten:', err);
    return send({ error: 'Gagal memuat konten.' }, 500);
  }
}

export async function POST(request) {
  try {
    if (!isConfigured()) return send(NOT_CONFIGURED, 500);
    if (!isAuthorized(request)) return rejectUnauthorized();

    const raw = await request.text();
    if (raw.length > MAX_BODY) return send({ error: 'Data terlalu besar.' }, 413);

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return send({ error: 'Format data tidak valid.' }, 400);
    }

    let content;
    try {
      content = sanitize(body);
    } catch (err) {
      return send({ error: err.message }, 400);
    }

    await put(PATH, JSON.stringify(content), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60
    });

    await cleanupPhotos(content).catch((err) => console.error('Bersih-bersih foto gagal:', err));

    return send({ content });
  } catch (err) {
    console.error('Gagal menyimpan konten:', err);
    return send({ error: 'Gagal menyimpan konten. Coba lagi.' }, 500);
  }
}