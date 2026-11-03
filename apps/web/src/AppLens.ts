import { Option } from 'effect'
import { modifyFields } from 'foldkit/struct'
import type { Model } from './App.ts'
import { Message } from './Message.ts'
import type { PageLens } from './Page.ts'
import type * as ServerData from './ServerData.ts'

/** A page's lens (Page.ts) from the app's Model. */
export const at = <Child, ChildMessage>(lens: PageLens<Child, ChildMessage>) => ({
  read: (model: Model) => lens.read(model.page),
  write: (model: Model, child: Child) => modifyFields(model, { page: (page) => lens.write(page, child) }),
  toParentMessage: lens.toParentMessage,
})

export const data = {
  read: (model: Model) => Option.some(model.data),
  write: (model: Model, nextData: ServerData.Model) => modifyFields(model, { data: () => nextData }),
  toParentMessage: (message: ServerData.Message) => Message.GotServerDataMessage({ message }),
}
