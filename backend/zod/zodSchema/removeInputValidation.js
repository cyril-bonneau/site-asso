import { z } from 'zod';

export const removeInputSchema = z.object({
    password: z.string().min(8).max(128),
}).strict();