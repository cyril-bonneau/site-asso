import { z } from 'zod';

export const passwordUpdateInputSchema = z.object({
    oldPassword: z.string().min(8).max(128),
    newPassword: z.string().min(8).max(128),
}).strict();