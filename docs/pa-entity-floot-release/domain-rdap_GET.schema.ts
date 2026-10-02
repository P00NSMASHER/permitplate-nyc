import { z } from 'zod'

export const schema = z.object({
  domain: z.string().optional(),
})

export type InputType = z.infer<typeof schema>
