// How Styld, the stylist in the app, answers (owner, 2026-10-31).

/** The model Styld answers with, on Workers AI through the Worker's binding: DeepSeek V4.1 Flash ($0.30 a million
 * tokens in, $1.20 out). Of five models probed through Styld's own turn on 31 October it wrote the best Slovenian and
 * called tools reliably. */
export const stylistModelId = '@cf/deepseek-ai/deepseek-v4.1-flash-1017'

/** Model calls a reply may take, each answering the tools the last one called. */
export const maxSteps = 6
