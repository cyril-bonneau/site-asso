// scripts/prep-ssl.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.resolve(__dirname, '..', '.certs');
const OUT_DIR_ENV = path.resolve(__dirname, '..', '.env');
console.log(OUT_DIR_ENV)
console.log(`[prep-ssl] Using OUT_DIR=${OUT_DIR}`);
const CERT_OUT = path.join(OUT_DIR, 'cert.pem');
const KEY_OUT = path.join(OUT_DIR, 'key.pem');

function requireEnv(name) {
    const v = process.env[name];
    if (!v) {
        console.error(`[prep-ssl] Missing ${name} in environment (.env).`);
        process.exit(1);
    }
    return v.replace(/\s+/g, ''); // nettoie espaces/retours éventuels
}

function writeFile(p, data) {
    fs.writeFileSync(p, data, { encoding: 'utf8', flag: 'w' });
    console.log(`[prep-ssl] Wrote ${p}`);
}

(function main() {
    const certB64 = requireEnv('SSL_CERT_B64');
    const keyB64 = requireEnv('SSL_KEY_B64');

    const certPem = Buffer.from(certB64, 'base64').toString('utf8').trim();
    const keyPem = Buffer.from(keyB64, 'base64').toString('utf8').trim();

    if (!certPem.includes('BEGIN CERTIFICATE')) {
        console.error('[prep-ssl] Decoded cert does not look like a PEM.');
        process.exit(1);
    }
    if (!keyPem.includes('BEGIN PRIVATE KEY')) {
        console.error('[prep-ssl] Decoded key does not look like a PEM.');
        process.exit(1);
    }

    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    writeFile(CERT_OUT, certPem + '\n');
    writeFile(KEY_OUT, keyPem + '\n');

    // petite sécurité de perms (best-effort, ignore Windows)
    try { fs.chmodSync(KEY_OUT, 0o600); } catch { }
})();
