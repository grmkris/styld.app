import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import { Runtime } from 'foldkit'
import { Flags, Model, init, update } from './App.ts'
import { view } from './View.ts'
// oxlint-disable-next-line import/no-unassigned-import -- Vite loads the application stylesheet for its side effects
import './styles.css'

const application = Runtime.makeApplication({
  Model,
  Flags,
  init,
  update,
  view,
  container: document.getElementById('root'),
  resources: FetchHttpClient.layer,
})

Runtime.hydrate(application)
