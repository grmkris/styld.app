import { glob, readFile } from 'node:fs/promises'
import { parseSync, Visitor } from 'oxc-parser'

export const sourceFiles = async (root = '.') => {
  const files: string[] = []
  const extensions = '{ts,tsx,mts,cts,js,jsx,mjs,cjs}'
  for await (const file of glob(
    ['apps', 'packages', 'tools', 'infra']
      .map((directory) => `${directory}/**/*.${extensions}`)
      .concat(`*.${extensions}`),
    { cwd: root, exclude: ['**/node_modules/**', '**/dist/**', 'tools/oxlint/anti-slop/**'] },
  ))
    files.push(file)
  return files.toSorted()
}

export const readSource = async (file: string) => {
  const source = await readFile(file, 'utf8')
  const parsed = parseSync(file, source)
  if (parsed.errors.length !== 0) throw new Error(`Cannot audit ${file}: ${parsed.errors[0]?.message}`)
  return { source, parsed }
}

/** The modules a file needs when it runs: its value imports, re-exports and literal dynamic imports, without the
 * type-only ones, which leave nothing in the program. */
export const valueImportsOf = (file: string, source: string): string[] => {
  const parsed = parseSync(file, source)
  if (parsed.errors.length !== 0) throw new Error(`Cannot parse ${file}`)
  const imports: string[] = []
  new Visitor({
    ImportDeclaration: (node) => {
      const typeOnly =
        node.importKind === 'type' ||
        (node.specifiers.length > 0 &&
          node.specifiers.every((specifier) => specifier.type === 'ImportSpecifier' && specifier.importKind === 'type'))
      if (!typeOnly) imports.push(node.source.value)
    },
    ExportNamedDeclaration: (node) => {
      if (node.source !== null && node.exportKind !== 'type') imports.push(node.source.value)
    },
    ExportAllDeclaration: (node) => {
      if (node.exportKind !== 'type') imports.push(node.source.value)
    },
    ImportExpression: (node) => {
      if (node.source.type === 'Literal' && typeof node.source.value === 'string') imports.push(node.source.value)
    },
  }).visit(parsed.program)
  return imports
}

/** Includes re-exports, type imports, literal dynamic imports and require calls. */
export const importsOf = (file: string, source: string): string[] => {
  const parsed = parseSync(file, source)
  if (parsed.errors.length !== 0) throw new Error(`Cannot parse ${file}`)
  const imports: string[] = []
  const add = (value: unknown) => {
    if (typeof value !== 'string') throw new Error(`Computed module import in ${file}; use explicit imports`)
    imports.push(value)
  }
  new Visitor({
    ImportDeclaration: (node) => add(node.source.value),
    ExportNamedDeclaration: (node) => {
      if (node.source !== null) add(node.source.value)
    },
    ExportAllDeclaration: (node) => add(node.source.value),
    TSImportType: (node) => {
      add(node.source.value)
    },
    TSImportEqualsDeclaration: (node) => {
      if (node.moduleReference.type === 'TSExternalModuleReference') add(node.moduleReference.expression.value)
    },
    ImportExpression: (node) => add(node.source.type === 'Literal' ? node.source.value : undefined),
    CallExpression: (node) => {
      if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
        const argument = node.arguments[0]
        add(argument?.type === 'Literal' ? argument.value : undefined)
      }
    },
  }).visit(parsed.program)
  return imports
}
