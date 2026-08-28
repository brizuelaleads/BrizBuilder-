// Generates the VAPID keypair that identifies this deployment to push services.
//
//   node scripts/generate-vapid-keys.mjs
//
// Run once. The public key is embedded in every browser subscription, so
// rotating it invalidates every existing subscription and every device has to
// opt in again -- treat these as long-lived.

const keyPair = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
);

const publicRaw = new Uint8Array(
  await crypto.subtle.exportKey("raw", keyPair.publicKey),
);
const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);

function base64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

console.log(`
VAPID_PUBLIC_KEY=${base64Url(publicRaw)}
VAPID_PRIVATE_KEY=${privateJwk.d}
VAPID_SUBJECT=mailto:alerts@yourdomain.com

Local development: paste all three into .env.local (already git-ignored) and
restart the dev server.

Production: add all three in the Sites environment settings, the same place
SUPABASE_SERVICE_ROLE_KEY lives. Never commit the private key.

The public key is not secret -- every browser subscription contains it. The
private key is. Rotating the pair invalidates every device subscription, so
generate once and keep it.
`);
