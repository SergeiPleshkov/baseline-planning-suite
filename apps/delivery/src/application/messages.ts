import type { AddItemError, MoveItemError } from '../domain/breakdown';

export type TreeCommandError =
  AddItemError | MoveItemError | 'blank-name' | 'changed-since-confirmation';

/** What the person is told when the domain refuses a command before it is even sent. */
const MESSAGES = {
  'blank-name': 'An item needs a name.',
  'duplicate-id': 'An item with this id already exists.',
  'unknown-item': 'That item no longer exists.',
  'unknown-project': 'That project no longer exists.',
  'unknown-parent': 'The chosen parent no longer exists.',
  'parent-in-other-project': 'An item and its parent belong to the same project.',
  'into-own-subtree': 'An item cannot be moved under itself or one of its own children.',
  'too-deep': 'The breakdown is at most three levels deep.',
  'parent-has-allocations':
    'That item holds allocations, so nothing can be moved under it. Add a new child to it instead: its allocations move onto the child.',
  'changed-since-confirmation':
    'The item changed since the summary was shown. Review it again before deleting.',
} as const satisfies Record<TreeCommandError, string>;

export const messageFor = (error: TreeCommandError): string => MESSAGES[error];

/** R4: adding a child to a leaf that holds allocations moves them onto the child. */
export function movedAllocationsNotice(count: number, from: string, to: string): string | null {
  if (count === 0) return null;
  const what = count === 1 ? '1 allocation was' : `${String(count)} allocations were`;
  return `${what} moved from “${from}” onto the new item “${to}”, because an item that has children holds none itself.`;
}
