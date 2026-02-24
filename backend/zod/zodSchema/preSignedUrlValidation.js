import { z } from "zod";
import { sanitizeText } from "../../helpers/toolbox.js";

export const preSignedUrlSchema = z.object({
    contentType: z.literal("image/png"),
    size: z.number().max(1 * 1024 * 1024).optional(), // Max size 1MB
    checksum: z.string().length(64).optional(), // Assuming SHA-256 checksum
    fileName: z.string().min(1).max(100).transform((val) => sanitizeText(val, { maxLength: 80, allowNewLines: false, fallback: "" })),
})