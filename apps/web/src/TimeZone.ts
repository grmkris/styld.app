import { Effect } from 'effect'
import { Command } from 'foldkit'
import { Message } from './Message.ts'

/** The browser's own time zone, once the page runs. The server renders in UTC and the first paint matches it; times
 * and days, such as Styld's earlier chats and the review tray's, then read in the person's zone. */
export const ReadTimeZone = Command.define('ReadTimeZone', {
  messages: [Message.SucceededReadTimeZone],
  execute: Effect.sync(() =>
    Message.SucceededReadTimeZone({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }),
  ),
})
