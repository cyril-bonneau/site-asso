import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { importSPKI } from "jose";

let cachedPublicKey = null;          // KeyLike JOSE
let cachedPem = null;                // optionnel (debug)
let inflight = null;                 // évite double fetch au cold start (concurrence)

const ssm = new SSMClient({});

function getParamName() {
    if (process.env.JWT_ACCESS_PUB_SSM_PARAM) return process.env.JWT_ACCESS_PUB_SSM_PARAM;

    const stage = process.env.STAGE || "dev";
    return `/site-asso/${stage}/cfg/jwtAccessPub`;
}

export async function getAccessPublicKey() {
    if (cachedPublicKey) {
        console.log("cachedPublicKey", cachedPublicKey);
        return cachedPublicKey;
    }
    if (inflight) {
        return inflight;
    }

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

        const key = await importSPKI(pem, "RS256");

        cachedPublicKey = key;
        cachedPem = pem;
        return cachedPublicKey;
    })();

    try {
        console.log("inflight fetch for public key", inflight);
        return await inflight;
    } finally {
        inflight = null;
    }
}

// (Optionnel) utile en test ou debug
export function _dangerouslyGetCachedPem() {
    console.log("cachedPem", cachedPem);
    return cachedPem;
}
