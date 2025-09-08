const fs = require('fs');
const { importPKCS8, importSPKI } = require('jose');

const ALG = process.env.JWT_ALG;

function read(path) {
    if (!path) {
        throw new Error('missing key path');
    }
    return fs.readFileSync(path, 'utf8');
}

async function loadKeyPair(prefix) {
    const privPem = read(process.env[`${prefix}_PRIVATE_KEY_PATH`]);
    const pubPem = read(process.env[`${prefix}_PUBLIC_KEY_PATH`]);

    if (ALG === 'EdDSA') {
        return {
            privateKey: await importPKCS8(privPem, 'EdDSA'),
            publicKey: await importSPKI(pubPem, 'EdDSA'),
        }
    }

    if (ALG === 'RS256') {
        return {
            privateKey: await importPKCS8(privPem, 'RS256'),
            publicKey: await importSPKI(pubPem, 'RS256'),
        }
    }

    throw new Error(`unsupported alg: ${ALG}`);
}

async function loadAllKeys() {
    const access = await loadKeyPair('ACCESS');
    const refresh = await loadKeyPair('REFRESH');
    return { ALG, access, refresh };
}

module.exports = { loadAllKeys };