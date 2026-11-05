import { checkGraph, checkServerLayers } from './quality/graph.ts'

const result = await checkGraph()
const layers = await checkServerLayers()
console.log(
  `Graph: ${result.files} files; ${result.browserModules} browser modules; boundaries satisfied; server layers kept, ${layers.cycles} cycles allowed`,
)
