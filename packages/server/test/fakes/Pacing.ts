import { Record } from 'effect'
import { Pacing, paces } from '../../src/kernel/Pacing.ts'

/** Every pace allows every ask: unit tests that are not about pacing. */
export const unlimited = Pacing.layer(Record.map(paces, () => ({ limit: () => Promise.resolve({ success: true }) })))
