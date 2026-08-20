// Run with: npm run generate-vapid-keys
// Paste the output into .env (see .env.example). You only need to do this
// once per deployment — the same keypair is reused for every push you send.
const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
