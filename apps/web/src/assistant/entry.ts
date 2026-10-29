import { Runtime } from 'foldkit'
import { connectHost } from './Bridge.ts'
import { makeViews } from './Views.ts'

// The assistant views' entry: one self-contained HTML file a host renders inside its sandboxed frame.
const container = document.getElementById('styld-view')
if (container !== null) connectHost(Runtime.embed(makeViews(container)))
