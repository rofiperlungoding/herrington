import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * shadcn/ui's standard class-name combiner. Joins conditional class lists with
 * `clsx` then resolves Tailwind utility conflicts with `tailwind-merge` (e.g.
 * `px-2 px-4` collapses to `px-4`). Used by every shadcn component we add via
 * `npx shadcn@latest add ...`.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
