import { put, list, del } from '@vercel/blob';
import { isAuthorized, isConfigured, rejectUnauthorized, NOT_CONFIGURED } from '../lib/auth.js';

const MAX_ITEMS = 100;
const MAX_BYTES = 4 * 1024 * 1024;
const ID_PATTERN = /^[a-z0-9]+-[a-f0-9]{8}$/;
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' };
const META_OPTS = {
  access: 'public',
  contentType: 'application/json',
  addRandomSuffix: false,
  allowOverwrite: true,
  cacheControlMaxAge: 60
};

const send = (data, status = 200, cache = 'no-store') =>
  Response.json(data, { status, headers: { 'Cache-Control': cache } });
const byOrder = (a, b) =>
  (b.pinned === true) - (a.pinned === true) ||
  String(a.uploadedAt).localeCompare(String(b.uploadedAt)) ||
  String(a.id).localeCompare(String(b.id));

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const cleanMultiline = (v, max) =>
  String(v ?? '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim().slice(0, max);

function matchesSignature(b, type) {
  const ascii = (from, to) => String.fromCharCode(...b.slice(from, to));
  switch (type) {
    case 'image/jpeg': return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case 'image/png':  return b[0] === 0x89 && ascii(1, 4) === 'PNG';
    case 'image/webp': return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
    case 'image/avif': return ascii(4, 8) === 'ftyp';
    default: return false;
  }
}

async function listAll(prefix) {
  const blobs = [];
  let cursor;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

/** Baca metadata; ?t= menghindari cache CDN setelah metadata ditimpa (edit). */
async function readMeta(blob) {
  const res = await fetch(`${blob.url}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Blob HTTP ${res.status}`);
  const p = await res.json();
  // proyek lama tanpa uploadedAt di metadata → pakai waktu file
  return { ...p, uploadedAt: p.uploadedAt || new Date(blob.uploadedAt).toISOString() };
}

export async function GET(request) {
  try {
    if (!isConfigured()) return send(NOT_CONFIGURED, 500);

    const metaBlobs = (await listAll('portfolio/')).filter((b) => b.pathname.endsWith('.json'));

    const projects = (
      await Promise.all(
        metaBlobs.map(async (blob) => {
          try {
            return await readMeta(blob);
          } catch {
            return null;
          }
        })
      )
    )
      .filter(Boolean)
      .sort(byOrder)
      .slice(0, MAX_ITEMS);

    const admin = isAuthorized(request);
    return send(
      { projects },
      200,
      admin ? 'no-store' : 'public, s-maxage=10, stale-while-revalidate=59'
    );
  } catch (err) {
    console.error('Gagal membaca daftar foto:', err);
    return send({ error: 'Gagal memuat daftar foto.' }, 500);
  }
}

async function unpinOthers(exceptId) {
  const others = (await listAll('portfolio/')).filter(
    (b) => b.pathname.endsWith('.json') && b.pathname !== `portfolio/${exceptId}.json`
  );
  await Promise.all(
    others.map(async (b) => {
      const p = await readMeta(b).catch(() => null);
      if (p?.pinned) await put(b.pathname, JSON.stringify({ ...p, pinned: false }), META_OPTS);
    })
  );
}

export async function PUT(request) {
  try {
    if (!isConfigured()) return send(NOT_CONFIGURED, 500);
    if (!isAuthorized(request)) return rejectUnauthorized();

    const id = new URL(request.url).searchParams.get('id') || '';
    if (!ID_PATTERN.test(id)) return send({ error: 'ID proyek tidak valid.' }, 400);

    const declared = Number(request.headers.get('content-length') || 0);
    if (declared > MAX_BYTES + 256 * 1024) {
      return send({ error: 'File terlalu besar. Maksimal 4 MB.' }, 413);
    }

    let form;
    try {
      form = await request.formData();
    } catch {
      return send({ error: 'Format permintaan tidak valid.' }, 400);
    }

    const metaPath = `portfolio/${id}.json`;
    const blobs = await listAll(`portfolio/${id}.`);
    const metaBlob = blobs.find((b) => b.pathname === metaPath);
    if (!metaBlob) return send({ error: 'Proyek tidak ditemukan (mungkin sudah dihapus).' }, 404);
    const current = await readMeta(metaBlob);

    // Hanya field yang dikirim yang diubah
    const title = form.has('title') ? clean(form.get('title'), 80) : current.title;
    if (title.length < 2) return send({ error: 'Judul minimal 2 karakter.' }, 400);

    const yearInput = clean(form.get('year'), 4);
    const next = {
      ...current,
      title,
      alt: title,
      category: form.has('category') ? clean(form.get('category'), 40) || 'Lainnya' : current.category,
      year: form.has('year') && /^(19|20)\d{2}$/.test(yearInput) ? yearInput : current.year,
      location: form.has('location') ? clean(form.get('location'), 80) : current.location,
      description: form.has('description') ? cleanMultiline(form.get('description'), 600) : current.description,
      updatedAt: new Date().toISOString()
    };
    if (form.has('pinned')) next.pinned = form.get('pinned') === '1';

    // Ganti gambar (opsional)
    let newImage = null;
    const file = form.get('file');
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_BYTES) return send({ error: 'File terlalu besar. Maksimal 4 MB.' }, 413);
      const ext = EXT[file.type];
      if (!ext) return send({ error: 'Format tidak didukung. Gunakan JPG, PNG, WebP, atau AVIF.' }, 415);
      const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
      if (!matchesSignature(head, file.type)) {
        return send({ error: 'Isi file tidak cocok dengan format gambar.' }, 415);
      }
      // Nama baru → tidak tersangkut cache CDN gambar lama
      newImage = await put(`portfolio/${id}.${Date.now().toString(36)}.${ext}`, file, {
        access: 'public',
        contentType: file.type,
        addRandomSuffix: false
      });
      next.image = newImage.url;
    }

    try {
      await put(metaPath, JSON.stringify(next), META_OPTS);
    } catch (err) {
      if (newImage) await del(newImage.url).catch(() => {});
      throw err;
    }

    // Gambar lama dihapus setelah metadata baru tersimpan
    if (newImage) {
      const old = blobs.filter((b) => b.pathname !== metaPath && b.url !== newImage.url).map((b) => b.url);
      if (old.length) await del(old).catch((e) => console.error('Gagal menghapus gambar lama:', e));
    }

    if (next.pinned) await unpinOthers(id).catch((e) => console.error('Gagal melepas pin lain:', e));

    return send({ project: next });
  } catch (err) {
    console.error('Gagal mengedit proyek:', err);
    return send({ error: 'Gagal menyimpan perubahan. Coba lagi.' }, 500);
  }
}

export async function DELETE(request) {
  try {
    if (!isConfigured()) return send(NOT_CONFIGURED, 500);
    if (!isAuthorized(request)) return rejectUnauthorized();

    const id = new URL(request.url).searchParams.get('id') || '';
    if (!ID_PATTERN.test(id)) {
      return send({ error: 'ID foto tidak valid.' }, 400);
    }

    // Prefix "portfolio/<id>." hanya cocok dengan gambar & metadata milik id ini
    const blobs = await listAll(`portfolio/${id}.`);
    if (!blobs.length) {
      return send({ error: 'Foto tidak ditemukan (mungkin sudah dihapus).' }, 404);
    }

    await del(blobs.map((b) => b.url));
    return send({ deleted: id });
  } catch (err) {
    console.error('Gagal menghapus foto:', err);
    return send({ error: 'Gagal menghapus foto. Coba lagi.' }, 500);
  }
}