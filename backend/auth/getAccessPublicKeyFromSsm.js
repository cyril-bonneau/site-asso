import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { importSPKI } from "jose";

let cachedPublicKey = null;          // KeyLike JOSE
let cachedPem = null;                // optionnel (debug)
let inflight = null;                 // évite double fetch au cold start (concurrence)

const ssm = new SSMClient({});

function getParamName() {
    if (process.env.JWT_ACCESS_PUB_SSM_PARAM) return process.env.JWT_ACCESS_PUB_SSM_PARAM;

    const stage = process.env.STAGE || process.env.NODE_ENV || "dev";
    return `/site-asso/${stage}/cfg/jwtAccessPub`;
}

export async function getAccessPublicKey() {
    if (cachedPublicKey) return cachedPublicKey;
    if (inflight) return inflight;

    inflight = (async () => {
        const Name = getParamName();

        const res = await ssm.send(
            new GetParameterCommand({
                Name,
                WithDecryption: false,
            })
        );

        const pem = res?.Parameter?.Value;
        if (!pem || typeof pem !== "string") {
            throw new Error("SSM_PUBLIC_KEY_MISSING");
        }

        // PEM -> KeyLike (JOSE)
        const key = await importSPKI(pem, "RS256");

        cachedPublicKey = key;
        cachedPem = pem;
        return cachedPublicKey;
    })();

    try {
        return await inflight;
    } finally {
        inflight = null;
    }
}

// (Optionnel) utile en test ou debug
export function _dangerouslyGetCachedPem() {
    return cachedPem;
}
