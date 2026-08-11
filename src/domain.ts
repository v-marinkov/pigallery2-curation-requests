export const CURATION_PREFIX = 'pg-curation:';
export const TAG_DELETE_PENDING = `${CURATION_PREFIX}delete-pending`;
export const TAG_DELETE_APPROVED = `${CURATION_PREFIX}delete-approved`;
export const TAG_DELETE_ERROR = `${CURATION_PREFIX}delete-error`;
export const TAG_REQUESTED_BY_PREFIX = `${CURATION_PREFIX}requested-by:`;
export const TAG_CURATION_OPEN = `${CURATION_PREFIX}open`;
export const TAG_CATEGORY_PREFIX = `${CURATION_PREFIX}category:`;
export const TAG_ITEM_PREFIX = `${CURATION_PREFIX}item:`;

export const DELETION_STATES = ['PENDING', 'APPROVED', 'DECLINED', 'EXECUTED', 'ERROR'] as const;
export type DeletionState = typeof DELETION_STATES[number];

export const METADATA_CATEGORIES = [
  'faces',
  'tags',
  'location',
  'date-time',
  'title-caption',
  'duplicate',
  'other'
] as const;
export type MetadataCategory = typeof METADATA_CATEGORIES[number];

export const METADATA_REQUEST_STATES = ['OPEN', 'RESOLVED', 'DISMISSED', 'WITHDRAWN'] as const;
export type MetadataRequestState = typeof METADATA_REQUEST_STATES[number];

export interface Actor {
  id: string;
  name: string;
}

export interface FileFingerprint {
  fileSize: number;
  fileMtime: number;
  fileHash: string;
  hashAlgorithm: 'sha256';
}

export interface DeletionItem {
  id: number;
  relativePath: string;
  mediaType: string | null;
  fileSize: number | null;
  fileMtime: number | null;
  fileHash: string | null;
  hashAlgorithm: string | null;
  state: DeletionState;
  currentCycle: number;
  createdAt: string;
  updatedAt: string;
  approvedByUserId: string | null;
  approvedByUserName: string | null;
  approvedAt: string | null;
  declinedByUserId: string | null;
  declinedByUserName: string | null;
  declinedAt: string | null;
  executedAt: string | null;
  executionError: string | null;
}

export interface DeletionRequest {
  id: number;
  deletionItemId: number;
  cycle: number;
  requestedByUserId: string;
  requestedByUserName: string;
  requestedAt: string;
  reason: string | null;
  withdrawnAt: string | null;
}

export type RequestStatus = 'requested' | 'already_requested' | 'reopened';

export interface RequestDeletionResult {
  status: RequestStatus;
  item: DeletionItem;
}

export type WithdrawRequestStatus = 'withdrawn' | 'not_requester';

export interface WithdrawDeletionRequestResult {
  status: WithdrawRequestStatus;
  item: DeletionItem | null;
  remainingRequesters: number;
}

export interface CurationItemInfo {
  item: DeletionItem;
  requests: DeletionRequest[];
}

export interface CurationProjection {
  state: DeletionState | null;
  requesterNames: string[];
  metadataCategories?: MetadataCategory[];
  itemToken?: string | null;
}

export interface MetadataRequest {
  id: number;
  relativePath: string;
  category: MetadataCategory;
  state: MetadataRequestState;
  requestedByUserId: string;
  requestedByUserName: string;
  requestedAt: string;
  comment: string | null;
  updatedAt: string;
  closedByUserId: string | null;
  closedByUserName: string | null;
  closedAt: string | null;
  resolutionComment: string | null;
}

export interface ClientRequestDetail {
  kind: 'deletion' | 'metadata';
  category: 'deletion' | MetadataCategory;
  state: DeletionState | MetadataRequestState;
  requesterName: string;
  requestedAt: string;
  comment: string | null;
  ownRequest: boolean;
}

export const stateTag = (state: DeletionState | null | undefined): string | null => {
  switch (state) {
    case 'PENDING': return TAG_DELETE_PENDING;
    case 'APPROVED': return TAG_DELETE_APPROVED;
    case 'ERROR': return TAG_DELETE_ERROR;
    default: return null;
  }
};

export const applyCurationState = (keywords: string[] | null | undefined, state: DeletionState | null | undefined): string[] => {
  return applyCurationProjection(keywords, state ? {state, requesterNames: []} : null);
};

const requesterTag = (name: string): string | null => {
  const safeName = name.replace(/,/g, '‚').replace(/[\r\n]+/g, ' ').trim().slice(0, 100);
  return safeName ? `${TAG_REQUESTED_BY_PREFIX}${safeName}` : null;
};

export const applyCurationProjection = (
  keywords: string[] | null | undefined,
  projection: CurationProjection | null | undefined
): string[] => {
  const result = (keywords || []).filter(keyword => !keyword.startsWith(CURATION_PREFIX));
  const tag = stateTag(projection?.state);
  if (tag) {
    result.push(tag);
  }
  const metadataCategories = [...new Set(projection?.metadataCategories || [])];
  const activeDeletion = Boolean(tag);
  if (projection && (activeDeletion || metadataCategories.length > 0)) {
    result.push(TAG_CURATION_OPEN);
    for (const category of metadataCategories) {
      result.push(`${TAG_CATEGORY_PREFIX}${category}`);
    }
    if (projection.itemToken) {
      result.push(`${TAG_ITEM_PREFIX}${projection.itemToken}`);
    }
    const names = [...new Set(projection.requesterNames.map(name => name.trim()).filter(Boolean))];
    for (const name of names) {
      const requestedByTag = requesterTag(name);
      if (requestedByTag) {
        result.push(requestedByTag);
      }
    }
  }
  return result;
};
