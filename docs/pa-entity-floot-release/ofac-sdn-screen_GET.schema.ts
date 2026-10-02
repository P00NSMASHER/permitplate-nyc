import { z } from 'zod'

export const schema = z.object({
  name: z.string().optional(),
  limit: z.string().optional(),
  minScore: z.string().optional(),
})

export type InputType = z.infer<typeof schema>
