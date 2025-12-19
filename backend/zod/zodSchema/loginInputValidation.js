import { z } from 'zod';

export const loginInputSchema = z.object({
    email: z.email().trim().toLowerCase(),
    password: z.string().min(8).max(128),
}).strict();