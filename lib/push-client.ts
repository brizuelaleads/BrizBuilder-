// Browser-side push helpers.
//
// Dependency-free and separate from lib/web-push.ts so the client bundle does
// not pull in the server's VAPID signing and payload-encryption code, none of
// which a browser has any business running.

/**
 * Converts a base64url VAPID public key into the byte array
 * `pushManager.subscribe` expects.
 *
 * Some browsers accept the string form directly and some still do not, so the
 * conversion is always done rather than relying on which one is running.
 */
export function base64UrlToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}
