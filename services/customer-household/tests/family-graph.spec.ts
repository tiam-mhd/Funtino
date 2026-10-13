import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveRelationshipPresentation,
  relationshipKindForInput,
  validateRelationshipGraph,
  type FamilyGraphPerson,
  type RelationshipEdge,
} from '../src/domain/family/family-graph.js';

const person = (
  id: string,
  gender: FamilyGraphPerson['gender'] = 'unspecified',
): FamilyGraphPerson => ({
  id,
  gender,
});
const edge = (
  fromMemberId: string,
  toMemberId: string,
  kind: RelationshipEdge['kind'] = 'parent_of',
): RelationshipEdge => ({ fromMemberId, toMemberId, kind, basis: 'biological' });

test('relationship inputs preserve direction for parent, child, guardian, and ward', () => {
  assert.deepEqual(relationshipKindForInput('parent'), {
    kind: 'parent_of',
    newPersonIsFrom: true,
  });
  assert.deepEqual(relationshipKindForInput('child'), {
    kind: 'parent_of',
    newPersonIsFrom: false,
  });
  assert.deepEqual(relationshipKindForInput('guardian'), {
    kind: 'guardian_of',
    newPersonIsFrom: true,
  });
  assert.deepEqual(relationshipKindForInput('ward'), {
    kind: 'guardian_of',
    newPersonIsFrom: false,
  });
});

test('relationship writes reject duplicates, contradictions, and directed cycles', () => {
  assert.equal(
    validateRelationshipGraph([edge('parent', 'child')], edge('parent', 'child')),
    'duplicate',
  );
  assert.equal(
    validateRelationshipGraph([edge('parent', 'child')], edge('child', 'parent', 'spouse_of')),
    'contradictory',
  );
  assert.equal(
    validateRelationshipGraph([edge('a', 'b'), edge('b', 'c')], edge('c', 'a')),
    'cycle',
  );
});

test('direct relationships are presented from the viewer perspective without guessing gender', () => {
  const people = [
    person('parent', 'male'),
    person('mother', 'female'),
    person('daughter', 'female'),
    person('child'),
    person('sister', 'female'),
  ];
  assert.deepEqual(
    deriveRelationshipPresentation('parent', 'daughter', people, [edge('parent', 'daughter')]),
    { label: 'دختر', status: 'verified' },
  );
  assert.deepEqual(
    deriveRelationshipPresentation('child', 'parent', people, [edge('parent', 'child')]),
    { label: 'پدر', status: 'verified' },
  );
  assert.deepEqual(
    deriveRelationshipPresentation('child', 'mother', people, [edge('mother', 'child')]),
    { label: 'مادر', status: 'verified' },
  );
  assert.deepEqual(deriveRelationshipPresentation('child', 'child', people, []), {
    label: 'من',
    status: 'verified',
  });
  assert.equal(
    deriveRelationshipPresentation('parent', 'sister', people, [
      edge('parent', 'sister', 'sibling_of'),
    ]).label,
    'خواهر',
  );
  assert.deepEqual(
    deriveRelationshipPresentation('parent', 'unknown', [person('parent'), person('unknown')], []),
    { label: 'نسبت مشخص نشده', status: 'needs_review' },
  );
});

test('extended relationships require explicit graph and gender facts', () => {
  const auntGraph = [
    edge('grandparent', 'father'),
    edge('grandparent', 'aunt'),
    edge('father', 'viewer'),
  ];
  const aunt = deriveRelationshipPresentation(
    'viewer',
    'aunt',
    [person('viewer'), person('father', 'male'), person('aunt', 'female'), person('grandparent')],
    auntGraph,
  );
  assert.deepEqual(aunt, { label: 'عمه', status: 'verified' });

  const cousinGraph = [
    edge('grandparent', 'father'),
    edge('grandparent', 'aunt'),
    edge('father', 'viewer'),
    edge('aunt', 'cousin'),
  ];
  const cousin = deriveRelationshipPresentation(
    'viewer',
    'cousin',
    [
      person('viewer'),
      person('father', 'male'),
      person('aunt', 'female'),
      person('cousin', 'male'),
      person('grandparent'),
    ],
    cousinGraph,
  );
  assert.deepEqual(cousin, { label: 'پسرعمه', status: 'verified' });
});

test('extended labels distinguish paternal and maternal aunts, uncles, and all cousin branches', () => {
  const auntLabel = (parentGender: 'female' | 'male', relativeGender: 'female' | 'male') =>
    deriveRelationshipPresentation(
      'viewer',
      'relative',
      [
        person('viewer'),
        person('parent', parentGender),
        person('relative', relativeGender),
        person('grandparent'),
      ],
      [edge('grandparent', 'parent'), edge('parent', 'viewer'), edge('grandparent', 'relative')],
    ).label;

  assert.equal(auntLabel('male', 'female'), 'عمه');
  assert.equal(auntLabel('male', 'male'), 'عمو');
  assert.equal(auntLabel('female', 'female'), 'خاله');
  assert.equal(auntLabel('female', 'male'), 'دایی');

  const cousinLabel = (
    viewerParentGender: 'female' | 'male',
    targetParentGender: 'female' | 'male',
    targetGender: 'female' | 'male',
  ) => {
    const people = [
      person('viewer'),
      person('viewer-parent', viewerParentGender),
      person('target-parent', targetParentGender),
      person('target', targetGender),
      person('grandparent'),
    ];
    const edges = [
      edge('grandparent', 'viewer-parent'),
      edge('grandparent', 'target-parent'),
      edge('viewer-parent', 'viewer'),
      edge('target-parent', 'target'),
    ];
    return deriveRelationshipPresentation('viewer', 'target', people, edges).label;
  };

  assert.equal(cousinLabel('male', 'female', 'female'), 'دخترعمه');
  assert.equal(cousinLabel('male', 'female', 'male'), 'پسرعمه');
  assert.equal(cousinLabel('male', 'male', 'female'), 'دخترعمو');
  assert.equal(cousinLabel('male', 'male', 'male'), 'پسرعمو');
  assert.equal(cousinLabel('female', 'female', 'female'), 'دخترخاله');
  assert.equal(cousinLabel('female', 'female', 'male'), 'پسرخاله');
  assert.equal(cousinLabel('female', 'male', 'female'), 'دختردایی');
  assert.equal(cousinLabel('female', 'male', 'male'), 'پسردایی');
});

test('multiple explicit paths stay ambiguous even when they produce the same label', () => {
  const graph = [
    edge('parent-one', 'viewer'),
    edge('parent-one', 'target-parent'),
    edge('parent-two', 'viewer'),
    edge('parent-two', 'target-parent'),
    edge('target-parent', 'target'),
  ];
  assert.deepEqual(
    deriveRelationshipPresentation(
      'viewer',
      'target',
      [
        person('viewer'),
        person('target-parent'),
        person('target', 'female'),
        person('parent-one'),
        person('parent-two'),
      ],
      graph,
    ),
    { label: 'نسبت دقیق مشخص نیست', status: 'ambiguous' },
  );
});
