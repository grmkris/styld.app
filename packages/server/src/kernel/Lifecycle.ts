import { Effect } from 'effect'

// A lifecycle is one state column's table of moves: for each state, the states a row may move on to. Each lifecycle
// lives in its module's `*Lifecycle.ts`, beside the one writer of its column, which moves a row only from the state it
// was read in (compare-and-set) and only along the table. A move off the table is a broken invariant, never written.

/** For each state, the states a row in it may move on to. */
export type Moves<State extends string> = { readonly [From in State]: ReadonlyArray<State> }

/** A state column's moves, and whether one is allowed. */
export interface Lifecycle<State extends string> {
  /** What the column holds, for the defect a refused move is. */
  readonly name: string
  readonly moves: Moves<State>
  readonly canMove: (from: State, to: State) => boolean
}

export const lifecycle = <State extends string>(name: string, moves: Moves<State>): Lifecycle<State> => ({
  name,
  moves,
  canMove: (from, to) => moves[from].includes(to),
})

/** Nothing when every one of `from` may move to `to`; a defect otherwise, before anything is written. */
export const allowed = <State extends string>(
  { name, canMove }: Lifecycle<State>,
  from: ReadonlyArray<State>,
  to: State,
): Effect.Effect<void> =>
  from.every((state) => canMove(state, to))
    ? Effect.void
    : Effect.die(new Error(`${name}: no move from ${from.join(' or ')} to ${to}`))
