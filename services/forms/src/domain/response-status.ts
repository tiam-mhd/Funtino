import type { ResponseStatus } from '@funtino/forms-schema';

export const responseStatusTransitions: Record<ResponseStatus, readonly ResponseStatus[]> = {
  new: ['in_review', 'closed', 'spam'],
  in_review: ['followed_up', 'closed', 'spam'],
  followed_up: ['in_review', 'closed', 'spam'],
  closed: ['in_review'],
  spam: ['in_review', 'closed'],
};

export function canTransitionResponseStatus(from: ResponseStatus, to: ResponseStatus): boolean {
  return responseStatusTransitions[from].includes(to);
}
