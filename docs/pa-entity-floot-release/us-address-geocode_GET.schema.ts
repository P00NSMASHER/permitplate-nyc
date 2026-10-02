import { z } from 'zod'

export const schema = z.object({
  address: z.string().optional(),
})

export type InputType = z.infer<typeof schema>
