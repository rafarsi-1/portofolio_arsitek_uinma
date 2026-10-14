import { createHash, timingSafeEqual } from 'node:crypto';

export function isConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN && process.env.ADMIN_PASSWORD);
}


export function isAuthorized(request) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;

  const given = request.headers.get('x-admin-password') || '';
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Jawaban 401 dengan jeda singkat untuk memperlambat tebak-tebakan password. */
export async function rejectUnauthorized() {
  await new Promise((resolve) => setTimeout(resolve, 600));
  return Response.json(
    { error: 'Password admin salah.' },
    { status: 401, headers: { 'Cache-Control': 'no-store' } }
  );
}

export const NOT_CONFIGURED = {
  error: 'Server belum dikonfigurasi: pasang BLOB_READ_WRITE_TOKEN dan ADMIN_PASSWORD di Vercel, lalu redeploy.'
};
