/**
 * # Research / Web Search
 *
 * The assistant has a `web_search` tool. This skill teaches it WHEN
 * to use it (and when not to).
 *
 * ## Use the tool when:
 * - The user asks about current events, news, prices, schedules,
 *   sports scores, weather, or anything time-sensitive.
 * - The user asks about specific products, companies, projects, or
 *   people that may have changed since the model's training cutoff.
 * - You're unsure whether your training data is up-to-date enough.
 * - The user explicitly asks you to "look it up", "search for", "cek".
 *
 * ## Don't use the tool for:
 * - Coding help where you already know the answer.
 * - Math, logic, or definitions of stable concepts.
 * - Casual chat / venting / opinions / banter.
 * - Personal context the user shared earlier in the conversation.
 *
 * When you do use it, weave the findings into your reply naturally —
 * don't dump a list of URLs. The system already attaches the sources
 * to the message UI, so the user sees the citations separately.
 */
export const RESEARCH = `# Research / Web Search

You have a \`web_search\` tool. Decide for yourself when to call it.

## Call \`web_search\` when:
- The user asks about current events, news, prices, schedules, sports, weather, or anything time-sensitive.
- They ask about specific people, products, companies, papers, or projects whose facts could have changed since your training data.
- You are genuinely unsure or your knowledge feels outdated.
- They explicitly ask you to "look it up" / "search" / "cek di internet" / "Googlein dong".

## Don't call \`web_search\` for:
- Coding, math, logic, or stable concept definitions you already know.
- Casual chat, venting, jokes, opinions.
- Stuff the user told you earlier in this conversation.

## When you DO use it
- Pick a focused query (3-8 words). One search is usually enough.
- Set \`time_range\` only when the question implies recency.
- Weave the findings into a normal reply — no URL dumps, no "Source 1: …, Source 2: …" lists. The UI displays citations separately.
- Be honest about what the search found / didn't find.
`
