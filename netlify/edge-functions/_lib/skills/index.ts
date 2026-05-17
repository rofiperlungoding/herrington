/**
 * Compose all skill modules into a single system prompt.
 *
 * Each skill is a focused doc. Splitting them keeps each one easy to
 * iterate on without breaking the others. Order matters a bit — persona
 * first sets identity, then voice/formatting/emoji shape output, then
 * the domain context (productivity) goes last.
 */
import { PERSONA } from './persona.ts'
import { VOICE } from './voice.ts'
import { FORMATTING } from './formatting.ts'
import { EMOJI } from './emoji.ts'
import { PRODUCTIVITY } from './productivity.ts'
import { RESEARCH } from './research.ts'
import { WORKSPACE } from './workspace.ts'

export function buildSystemPrompt(): string {
  return [PERSONA, VOICE, FORMATTING, EMOJI, PRODUCTIVITY, RESEARCH, WORKSPACE].join('\n\n---\n\n')
}
