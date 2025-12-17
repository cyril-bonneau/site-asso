import argon2 from 'argon2';

export async function hashPassword(pwd) {
    return argon2.hash(pwd, {
        type: argon2.argon2id,
        memoryCost: 2 ** 16,
        timeCost: 3,
        parallelism: 1,
    });
}

export async function verifyPassword(hash, pwd) {
    return argon2.verify(hash, pwd);
}