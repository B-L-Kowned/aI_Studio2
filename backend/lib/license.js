import crypto from 'node:crypto';

// Dry-run licence validation. A shipped build calls the licensing service; the
// shape of the answer is the same, so only this function changes.
//
// Demo keys: COMEDY-XXXX-XXXX, CONTENT-XXXX-XXXX, BOTH-XXXX-XXXX
const PATTERN = /^(COMEDY|CONTENT|BOTH)-([A-Z0-9]{4})-([A-Z0-9]{4})$/i;

export function validateLicense(key) {
  const trimmed = String(key ?? '').trim().toUpperCase();
  const match = PATTERN.exec(trimmed);
  if (!match) {
    return {
      valid: false,
      error: 'INVALID_KEY',
      message: 'Key must look like BOTH-A1B2-C3D4 (COMEDY, CONTENT or BOTH).',
    };
  }
  return {
    valid: true,
    entitlement: match[1].toLowerCase(),
    hint: `${match[1]}-••••-${match[3]}`,
    // Stored so an upgrade can be detected without keeping the key itself.
    fingerprint: crypto.createHash('sha256').update(trimmed).digest('hex').slice(0, 16),
  };
}
