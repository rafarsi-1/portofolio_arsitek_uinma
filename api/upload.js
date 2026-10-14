import { put, del } from '@vercel/blob';
import { isAuthorized, isConfigured, rejectUnauthorized, NOT_CONFIGURED } from '../lib/auth.js';

// Batas body Vercel Functions ±4,5 MB (termasuk overhead multipart).
const MAX_BYTES = 4 * 1024 * 1024;

const EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif'
};

const json = (data, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

/** Cek "magic bytes" agar file bukan sekadar berganti nama/MIME palsu. */
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

const clean = (value, max) =>
  String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

/** Deskripsi boleh multi-baris, jadi hanya buang karakter kontrol selain \n. */
const cleanMultiline = (value, max) =>
  String(value ?? '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim().slice(0, max);

export async function POST(request) {
  try {
    if (!isConfigured()) return json(NOT_CONFIGURED, 500);
    if (!isAuthorized(request)) return rejectUnauthorized();

    const declared = Number(request.headers.get('content-length') || 0);
    if (declared > MAX_BYTES + 256 * 1024) {
      return json({ error: 'File terlalu besar. Maksimal 4 MB.' }, 413);
    }

    let form;
    try {
      form = await request.formData();
    } catch {
      return json({ error: 'Format permintaan tidak valid.' }, 400);
    }

    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return json({ error: 'Pilih file gambar terlebih dahulu.' }, 400);
    }
    if (file.size > MAX_BYTES) {
      return json({ error: 'File terlalu besar. Maksimal 4 MB.' }, 413);
    }

    const ext = EXT[file.type];
    if (!ext) {
      return json({ error: 'Format tidak didukung. Gunakan JPG, PNG, WebP, atau AVIF.' }, 415);
    }
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (!matchesSignature(head, file.type)) {
      return json({ error: 'Isi file tidak cocok dengan format gambar.' }, 415);
    }

    const title = clean(form.get('title'), 80);
    if (title.length < 2) {
      return json({ error: 'Judul minimal 2 karakter.' }, 400);
    }

    const yearInput = clean(form.get('year'), 4);
    const year = /^(19|20)\d{2}$/.test(yearInput) ? yearInput : String(new Date().getFullYear());

    const id = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;

    // 1) Simpan gambar
    const image = await put(`portfolio/${id}.${ext}`, file, {
      access: 'public',
      contentType: file.type,
      addRandomSuffix: false
    });

    // 2) Simpan metadata (judul, kategori, dll.) sebagai JSON pendamping
    const project = {
      id,
      title,
      category: clean(form.get('category'), 40) || 'Lainnya',
      year,
      location: clean(form.get('location'), 80),
      description: cleanMultiline(form.get('description'), 600),
      image: image.url,
      alt: title,
      uploadedAt: new Date().toISOString()
    };

    try {
      await put(`portfolio/${id}.json`, JSON.stringify(project), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false
      });
    } catch (err) {
      await del(image.url).catch(() => {}); // jangan tinggalkan gambar yatim
      throw err;
    }

    return json({ project }, 201);
  } catch (err) {
    console.error('Upload gagal:', err);
    return json({ error: 'Terjadi kesalahan di server. Coba lagi sebentar lagi.' }, 500);
  }
}
