import { Record } from 'effect'
import { Pacing } from '../../src/kernel/Pacing.ts'
import { paces } from '../../src/kernel/Paces.ts'

/** Every pace allows every ask: unit tests that are not about pacing. */
export const unlimited = Pacing.layer(Record.map(paces, () => ({ limit: () => Promise.resolve({ success: true }) })))
