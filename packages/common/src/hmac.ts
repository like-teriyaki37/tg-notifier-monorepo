import crypto from 'crypto';

export type SupportedAlg = 'sha256' | 'sha1';

export function parseSignatureHeader(header?: string): { alg: SupportedAlg; digestHex: string } | null {
  if (!header) return null;
  // Expected formats: "sha256=abcdef..." or "sha1=abcdef..."
  const idx = header.indexOf('=');
  if (idx <= 0) return null;
  const alg = header.slice(0, idx).toLowerCase();
  const digestHex = header.slice(idx + 1).trim().toLowerCase();
  if ((alg === 'sha256' || alg === 'sha1') && /^[a-f0-9]+$/.test(digestHex)) {
    return { alg: alg as SupportedAlg, digestHex };
  }
  return null;
}

export function computeHmacHex(raw: Buffer | string, secret: string, alg: SupportedAlg): string {
  const h = crypto.createHmac(alg, secret);
  h.update(typeof raw === 'string' ? Buffer.from(raw, 'utf8') : raw);
  return h.digest('hex');
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  // Ensure equal length to avoid timing leaks
  if (a.length !== b.length) return false;
  const aBuf = Buffer.from(a, 'hex');
  const bBuf = Buffer.from(b, 'hex');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export function verifySignature(opts: {
  rawBody: Buffer | string;
  secret: string;
  headerSignature?: string | null;
}): { valid: boolean; alg?: SupportedAlg; expected?: string; provided?: string } {
  const parsed = parseSignatureHeader(opts.headerSignature ?? undefined);
  if (!parsed) {
    return { valid: false };
  }
  const expected = computeHmacHex(opts.rawBody, opts.secret, parsed.alg);
  const valid = timingSafeEqualHex(expected, parsed.digestHex);
  return { valid, alg: parsed.alg, expected, provided: parsed.digestHex };
}

// Convenience for common headers
export function getSignatureFromHeaders(headers: Record<string, string | string[] | undefined>): string | undefined {
  const h = (name: string) => headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  const header256 = h('x-hub-signature-256'); // e.g., "sha256=..."
  const header1 = h('x-hub-signature'); // e.g., "sha1=..."
  const val = Array.isArray(header256) ? header256[0] : header256 ?? (Array.isArray(header1) ? header1[0] : header1);
  return typeof val === 'string' ? val : undefined;
}
