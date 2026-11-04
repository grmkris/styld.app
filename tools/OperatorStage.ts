// What the operator's scripts that call a deployed stage read from the environment: the stage's address and its
// `STYLD_OPERATOR_TOKEN` (from the stage's private env file, `bun --env-file=.env.preview.local`). Never printed.

/** An environment variable the script cannot run without. */
export const required = (name: string) => {
  const value = process.env[name]
  if (value === undefined || value.length === 0) throw new Error(`Set ${name}`)
  return value
}

/** The stage's origin and the operator's token. */
export const operatorStage = () => ({
  origin: new URL(required('STYLD_URL')).origin,
  operatorToken: required('STYLD_OPERATOR_TOKEN'),
})
