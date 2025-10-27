import { z } from "zod";

export const updateUserSchema = z.object({
    // garde les noms que tu utilises en base
    displayName: z.string().min(1).max(120).optional(),
    familyName: z.string().min(1).max(120).optional(),
    phone: z.string().min(6).max(30).optional(),
    // email modifiable => Transact
    email: z.string().email().optional(),
    // version requise pour optimistic locking
    version: z.number().int().nonnegative(),
}).strict();
