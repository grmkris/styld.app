import type { TextTask } from '../ai/LanguageModel.ts'
import { deadlines } from '../providers/Call.ts'
import { textModels } from '../providers/Costs.ts'

// How Styld, the stylist in the app, answers (owner, 2026-10-31).

/** The model Styld answers with, on Workers AI through the Worker's binding: DeepSeek V4.1 Flash. */
export const styldModel: TextTask = { model: textModels.deepSeekFlash, kind: 'chat', deadline: deadlines.chat }

/** Model calls a reply may take, each answering the tools the last one called. */
export const maxSteps = 6
