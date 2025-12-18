import { z } from 'zod';

export const registerInputSchema = z.object({
    email: z.email().trim().toLowerCase(),
    password: z.string().min(8).max(128),
    firstName: z.string().trim().min(1).max(50),
    lastName: z.string().trim().min(1).max(50),
}).strict();