import { hashRefreshToken, buildRefreshCookie, generateRefreshToken } from "../helpers/toolbox.js";
import { storeRefreshToken } from "../dal/tokenStore.js";

export async function generateNewRefreshToken(userId, REFRESH_JWT_HMAC, oldHashedToken) {

    const refreshToken = await generateRefreshToken(userId, REFRESH_JWT_HMAC);

    const hashedRefreshToken = hashRefreshToken(refreshToken);

    await storeRefreshToken(hashedRefreshToken, userId, oldHashedToken);

    const cookieString = buildRefreshCookie(refreshToken);

    return cookieString

}