export type RelationshipKind = 'parent_of' | 'spouse_of' | 'sibling_of' | 'guardian_of';
export type RelationshipBasis =
  | 'biological'
  | 'legal'
  | 'adoptive'
  | 'step'
  | 'partner'
  | 'unspecified';
export type PersonGender = 'female' | 'male' | 'unspecified' | null;

export type RelationshipEdge = {
  fromMemberId: string;
  toMemberId: string;
  kind: RelationshipKind;
  basis: RelationshipBasis;
};

export type FamilyGraphPerson = {
  id: string;
  gender: PersonGender;
};

export type RelationshipPresentation = {
  label: string;
  status: 'verified' | 'ambiguous' | 'needs_review';
};

const directedFamilyKinds = new Set<RelationshipKind>(['parent_of', 'guardian_of']);
const kinshipBases = new Set<RelationshipBasis>(['biological', 'legal', 'adoptive']);

export function relationshipKindForInput(
  value: 'parent' | 'child' | 'spouse' | 'sibling' | 'guardian' | 'ward',
): { kind: RelationshipKind; newPersonIsFrom: boolean } {
  if (value === 'parent') return { kind: 'parent_of', newPersonIsFrom: true };
  if (value === 'child') return { kind: 'parent_of', newPersonIsFrom: false };
  if (value === 'guardian') return { kind: 'guardian_of', newPersonIsFrom: true };
  if (value === 'ward') return { kind: 'guardian_of', newPersonIsFrom: false };
  return { kind: value === 'spouse' ? 'spouse_of' : 'sibling_of', newPersonIsFrom: false };
}

export function legacyRelationshipLabel(
  value: 'parent' | 'child' | 'spouse' | 'sibling' | 'guardian' | 'ward',
): string {
  const labels = {
    parent: 'والد',
    child: 'فرزند',
    spouse: 'همسر',
    sibling: 'خواهر یا برادر',
    guardian: 'سرپرست',
    ward: 'تحت سرپرستی',
  } as const;
  return labels[value];
}

export function validateRelationshipGraph(
  existing: readonly RelationshipEdge[],
  candidate: RelationshipEdge,
): 'duplicate' | 'contradictory' | 'cycle' | null {
  if (candidate.fromMemberId === candidate.toMemberId) return 'contradictory';

  const samePair = existing.filter((edge) =>
    sameUndirectedPair(
      edge.fromMemberId,
      edge.toMemberId,
      candidate.fromMemberId,
      candidate.toMemberId,
    ),
  );
  if (samePair.some((edge) => edge.kind === candidate.kind)) return 'duplicate';
  if (
    samePair.some(
      (edge) =>
        (edge.kind === 'spouse_of' && directedFamilyKinds.has(candidate.kind)) ||
        (candidate.kind === 'spouse_of' && directedFamilyKinds.has(edge.kind)) ||
        (edge.kind === 'sibling_of' && directedFamilyKinds.has(candidate.kind)) ||
        (candidate.kind === 'sibling_of' && directedFamilyKinds.has(edge.kind)),
    )
  ) {
    return 'contradictory';
  }

  if (candidate.kind === 'spouse_of' || candidate.kind === 'sibling_of') {
    if (samePair.some((edge) => edge.kind === candidate.kind)) return 'duplicate';
    return null;
  }

  const directedEdges = existing.filter((edge) => directedFamilyKinds.has(edge.kind));
  if (hasDirectedPath(directedEdges, candidate.toMemberId, candidate.fromMemberId)) return 'cycle';
  if (
    existing.some(
      (edge) =>
        edge.kind === candidate.kind &&
        edge.fromMemberId === candidate.fromMemberId &&
        edge.toMemberId === candidate.toMemberId,
    )
  ) {
    return 'duplicate';
  }
  return null;
}

export function deriveRelationshipPresentation(
  viewerId: string | null,
  targetId: string,
  people: readonly FamilyGraphPerson[],
  edges: readonly RelationshipEdge[],
): RelationshipPresentation {
  if (!viewerId || viewerId === targetId) {
    return viewerId === targetId
      ? { label: 'من', status: 'verified' }
      : { label: 'نسبت مشخص نشده', status: 'needs_review' };
  }
  const personById = new Map(people.map((person) => [person.id, person]));
  const target = personById.get(targetId);
  const direct = deriveDirectLabel(viewerId, targetId, target?.gender ?? null, edges);
  if (direct) {
    return direct.label === 'نسبت دقیق مشخص نیست'
      ? { label: direct.label, status: 'ambiguous' }
      : { label: direct.label, status: 'verified' };
  }

  const parents = edges.filter((edge) => edge.kind === 'parent_of' && kinshipBases.has(edge.basis));
  const viewerAncestors = ancestorPaths(viewerId, parents, 3);
  const targetAncestors = ancestorPaths(targetId, parents, 3);
  const candidates: string[] = [];
  const pathPairs = new Set<string>();
  for (const [ancestorId, viewerPaths] of viewerAncestors) {
    const targetPaths = targetAncestors.get(ancestorId);
    if (!targetPaths) continue;
    for (const viewerPath of viewerPaths) {
      for (const targetPath of targetPaths) {
        pathPairs.add(`${viewerPath.join('>')}|${targetPath.join('>')}`);
        const label = extendedLabel(viewerPath, targetPath, target, personById);
        if (label) candidates.push(label);
      }
    }
  }
  const unique = [...new Set(candidates)];
  if (pathPairs.size === 1 && unique.length === 1) return { label: unique[0]!, status: 'verified' };
  if (pathPairs.size > 1 || unique.length > 1)
    return { label: 'نسبت دقیق مشخص نیست', status: 'ambiguous' };
  return { label: 'نسبت مشخص نشده', status: 'needs_review' };
}

function deriveDirectLabel(
  viewerId: string,
  targetId: string,
  targetGender: PersonGender,
  edges: readonly RelationshipEdge[],
): { label: string } | null {
  const direct = edges.filter(
    (edge) =>
      (edge.fromMemberId === viewerId && edge.toMemberId === targetId) ||
      (edge.fromMemberId === targetId && edge.toMemberId === viewerId),
  );
  const kinds = new Set(direct.map((edge) => edge.kind));
  if (kinds.size > 1) return { label: 'نسبت دقیق مشخص نیست' };
  const kind = direct[0]?.kind;
  if (kind === 'spouse_of')
    return { label: direct[0]?.basis === 'partner' ? 'شریک زندگی' : 'همسر' };
  if (kind === 'sibling_of') {
    if (direct[0]?.basis === 'step') {
      return {
        label:
          targetGender === 'female'
            ? 'خواهر ناتنی'
            : targetGender === 'male'
              ? 'برادر ناتنی'
              : 'خواهر یا برادر ناتنی',
      };
    }
    return {
      label:
        targetGender === 'female' ? 'خواهر' : targetGender === 'male' ? 'برادر' : 'خواهر یا برادر',
    };
  }
  if (kind === 'parent_of') {
    const basis = direct[0]?.basis ?? 'unspecified';
    const isChild = direct[0]?.fromMemberId === viewerId;
    if (basis === 'legal')
      return { label: isChild ? 'فرزندِ تحت سرپرستی قانونی' : 'سرپرست قانونی' };
    if (basis === 'step')
      return {
        label: isChild
          ? 'فرزند ناتنی'
          : targetGender === 'female'
            ? 'نامادری'
            : targetGender === 'male'
              ? 'ناپدری'
              : 'والد ناتنی',
      };
    if (basis === 'adoptive')
      return {
        label: isChild
          ? 'فرزندخوانده'
          : targetGender === 'female'
            ? 'مادرخوانده'
            : targetGender === 'male'
              ? 'پدرخوانده'
              : 'والدخوانده',
      };
    if (isChild)
      return {
        label: targetGender === 'female' ? 'دختر' : targetGender === 'male' ? 'پسر' : 'فرزند',
      };
    return { label: targetGender === 'female' ? 'مادر' : targetGender === 'male' ? 'پدر' : 'والد' };
  }
  if (kind === 'guardian_of') {
    return {
      label:
        direct[0]?.fromMemberId === viewerId
          ? 'تحت سرپرستی شما'
          : direct[0]?.basis === 'legal'
            ? 'سرپرست قانونی'
            : 'سرپرست',
    };
  }
  return null;
}

function ancestorPaths(
  start: string,
  parentEdges: readonly RelationshipEdge[],
  maxDepth: number,
): Map<string, string[][]> {
  const result = new Map<string, string[][]>();
  const pending: Array<{ current: string; path: string[] }> = [{ current: start, path: [] }];
  while (pending.length > 0) {
    const { current, path } = pending.shift()!;
    if (path.length >= maxDepth) continue;
    for (const edge of parentEdges) {
      if (edge.toMemberId !== current || path.includes(edge.fromMemberId)) continue;
      const nextPath = [...path, edge.fromMemberId];
      const paths = result.get(edge.fromMemberId) ?? [];
      if (!paths.some((existing) => existing.join(':') === nextPath.join(':'))) {
        paths.push(nextPath);
        result.set(edge.fromMemberId, paths);
      }
      pending.push({ current: edge.fromMemberId, path: nextPath });
    }
  }
  return result;
}

function extendedLabel(
  viewerPath: readonly string[],
  targetPath: readonly string[],
  target: FamilyGraphPerson | undefined,
  people: ReadonlyMap<string, FamilyGraphPerson>,
): string | null {
  const viewerSteps = viewerPath.length;
  const targetSteps = targetPath.length;
  if (viewerSteps === 1 && targetSteps === 1) {
    const gender = target?.gender;
    return gender === 'female' ? 'خواهر' : gender === 'male' ? 'برادر' : 'خواهر یا برادر';
  }
  if (viewerSteps === 1 && targetSteps === 2) return 'فرزندِ خواهر یا برادرِ شما';
  if (viewerSteps === 2 && targetSteps === 1) {
    const targetGender = target?.gender;
    const viewerParentGender = people.get(viewerPath[0] ?? '')?.gender;
    if (
      !targetGender ||
      targetGender === 'unspecified' ||
      !viewerParentGender ||
      viewerParentGender === 'unspecified'
    ) {
      return 'خواهر یا برادرِ والد';
    }
    if (viewerParentGender === 'male') return targetGender === 'female' ? 'عمه' : 'عمو';
    return targetGender === 'female' ? 'خاله' : 'دایی';
  }
  if (viewerSteps === 2 && targetSteps === 2) {
    const targetGender = target?.gender;
    const viewerParentGender = people.get(viewerPath[0] ?? '')?.gender;
    const targetParentGender = people.get(targetPath[0] ?? '')?.gender;
    if (
      !targetGender ||
      targetGender === 'unspecified' ||
      !viewerParentGender ||
      viewerParentGender === 'unspecified' ||
      !targetParentGender ||
      targetParentGender === 'unspecified'
    ) {
      return 'فرزندِ خواهر یا برادرِ والد';
    }
    const prefix = targetGender === 'female' ? 'دختر' : 'پسر';
    const branch =
      viewerParentGender === 'female'
        ? targetParentGender === 'female'
          ? 'خاله'
          : 'دایی'
        : targetParentGender === 'female'
          ? 'عمه'
          : 'عمو';
    return `${prefix}${branch}`;
  }
  return null;
}

function hasDirectedPath(
  edges: readonly RelationshipEdge[],
  start: string,
  target: string,
): boolean {
  const pending = [start];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current === target) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const edge of edges) {
      if (edge.fromMemberId === current && !visited.has(edge.toMemberId))
        pending.push(edge.toMemberId);
    }
  }
  return false;
}

function sameUndirectedPair(a: string, b: string, left: string, right: string): boolean {
  return (a === left && b === right) || (a === right && b === left);
}
