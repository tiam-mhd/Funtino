import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canTransitionResponseStatus, responseStatusTransitions } from '../src/domain/response-status.js';

describe('form response status transitions', () => {
  it('allows only the documented workflow transitions', () => {
    assert.deepEqual(responseStatusTransitions, {
      new: ['in_review', 'closed', 'spam'],
      in_review: ['followed_up', 'closed', 'spam'],
      followed_up: ['in_review', 'closed', 'spam'],
      closed: ['in_review'],
      spam: ['in_review', 'closed'],
    });
  });

  it('rejects self-transitions and direct transitions outside the workflow', () => {
    const statuses = Object.keys(responseStatusTransitions) as Array<keyof typeof responseStatusTransitions>;
    for (const from of statuses) {
      for (const to of statuses) {
        assert.equal(canTransitionResponseStatus(from, to), responseStatusTransitions[from].includes(to), `${from} -> ${to}`);
      }
    }
  });
});
