import { Option } from 'effect'

/** Where a parent holds a child Submodel, in its `field`, and how the child's Messages reach the parent: the slot that
 * `Update.foldChild` and `Update.foldChildStep` take beside the child's `update` or step. Each child module that
 * several pages hold exports its own `heldBy`, built with this. */
export const heldIn = <
  Parent extends Readonly<Record<Field, Child>>,
  Field extends string,
  Child,
  ChildMessage,
  ParentMessage,
>(
  field: Field,
  toParentMessage: (message: ChildMessage) => ParentMessage,
) => ({
  read: (parent: Parent): Option.Option<Child> => Option.some(parent[field]),
  write: (parent: Parent, child: Child): Parent => ({ ...parent, [field]: child }),
  toParentMessage,
})
