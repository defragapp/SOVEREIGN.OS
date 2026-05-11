import { z } from "zod";

export const DispatchSchema = z.object({
  requestId: z.string().optional(),
  action: z.string(),
  payload: z.record(z.any()).optional(),
  meta: z.object({
    userId: z.string().optional()
  }).optional()
});

export type Dispatch = z.infer<typeof DispatchSchema>;