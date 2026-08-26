export type StaffingPlanCapabilities = {
  view: boolean;
  manage: boolean;
  publish: boolean;
};

export type StaffingCoverageTotals = {
  required: number;
  rawAssigned: number;
  effectiveAssigned: number;
  covered: number;
  missing: number;
  overstaffed: number;
  percentage: number;
  openPositions: number;
};

export type StaffingPublishedVersionSummary = {
  versionId: string;
  versionNumber: number;
  sourceDraftRevision: number;
  publishedAt: string;
  publicationKind: string;
  coverageBasis: string;
  checksum: string;
};

export type StaffingPlanHeader = {
  planId: string;
  organizationId: string;
  unitId: string;
  unitName: string;
  weekStart: string;
  weekEnd: string;
  timezone: string;
  status: "ACTIVE" | "ARCHIVED";
  draftRevision: number;
  etag: string;
  latestPublishedVersion: StaffingPublishedVersionSummary | null;
  publishedRevision: number | null;
  publishedAt: string | null;
  hasUnpublishedChanges: boolean;
  capabilities: StaffingPlanCapabilities;
};

export type StaffingPlanLookup = {
  found: boolean;
  plan: StaffingPlanHeader | null;
};

export type StaffingDemandRequirement = {
  requirementId: string;
  planDayId: string;
  workTypeId: string;
  workTypeCode: string;
  workTypeName: string;
  startTime: string | null;
  endTime: string | null;
  breakMinutes: number;
  requiredWorkers: number;
  requiredQuantity: number | null;
  legacyPublicationStatus: "DRAFT" | "PUBLISHED";
  notes: string | null;
  coverage: StaffingCoverageTotals;
  issueKeys: string[];
};

export type StaffingDemandDay = {
  planDayId: string | null;
  date: string;
  persisted: boolean;
  roomsContext: number | null;
  notes: string | null;
  source: "MANUAL" | "TEMPLATE" | "IMPORT" | "LEGACY_BACKFILL" | null;
  coverage: StaffingCoverageTotals;
  requirements: StaffingDemandRequirement[];
  issueKeys: string[];
};

export type StaffingDemand = {
  planId: string;
  organizationId: string;
  unitId: string;
  weekStart: string;
  weekEnd: string;
  draftRevision: number;
  etag: string;
  coverage: StaffingCoverageTotals;
  days: StaffingDemandDay[];
};

export type StaffingRequirementInput = {
  date: string;
  workTypeId: string;
  startTime: string | null;
  endTime: string | null;
  requiredWorkers: number;
  requiredQuantity: number | null;
  notes: string | null;
};

export type StaffingRequirementUpdateInput = Omit<
  StaffingRequirementInput,
  "date" | "workTypeId"
>;

export type StaffingDemandBatchAction =
  | {
      operation: "CREATE";
      requirementId: null;
      create: StaffingRequirementInput;
      update: null;
    }
  | {
      operation: "UPDATE";
      requirementId: string;
      create: null;
      update: StaffingRequirementUpdateInput;
    }
  | {
      operation: "DELETE";
      requirementId: string;
      create: null;
      update: null;
    };

export type StaffingMutationResult = {
  planId: string;
  previousDraftRevision: number;
  currentDraftRevision: number;
  changed: boolean;
  affectedResourceIds: string[];
};

export type StaffingIssue = {
  issueKey: string;
  code: string;
  severity: "BLOCKING_CONFLICT" | "WARNING" | "INFORMATION" | "PENDING_REQUEST" | "UNCONFIRMED_CHANGE";
  date: string | null;
  requirementId: string | null;
  assignmentId: string | null;
  membershipId: string | null;
  messageKey: string;
  parameters: Record<string, string>;
  acknowledgementRequired: boolean;
  publishBlocking: boolean;
};

export type StaffingRequirementCoverage = {
  requirementId: string;
  planDayId: string;
  date: string;
  workTypeId: string;
  workTypeCode: string;
  workTypeName: string;
  startTime: string | null;
  endTime: string | null;
  totals: StaffingCoverageTotals;
  assignmentIds: string[];
  effectiveAssignmentIds: string[];
  issueKeys: string[];
};

export type StaffingDayCoverage = {
  date: string;
  totals: StaffingCoverageTotals;
  issueKeys: string[];
};

export type StaffingCoverage = {
  planId: string;
  organizationId: string;
  unitId: string;
  weekStart: string;
  draftRevision: number;
  etag: string;
  totals: StaffingCoverageTotals;
  requirements: StaffingRequirementCoverage[];
  days: StaffingDayCoverage[];
  issues: StaffingIssue[];
  blockingIssueCount: number;
  warningCount: number;
  informationCount: number;
  publishable: boolean;
};

export type StaffingIssueGroup = {
  severity: StaffingIssue["severity"];
  count: number;
  issues: StaffingIssue[];
};

export type StaffingReview = {
  planId: string;
  organizationId: string;
  unitId: string;
  weekStart: string;
  draftRevision: number;
  etag: string;
  coverage: StaffingCoverageTotals;
  groups: StaffingIssueGroup[];
  blockingIssueCount: number;
  warningCount: number;
  informationCount: number;
  publishable: boolean;
  requiredAcknowledgementKeys: string[];
};

export type StaffingVersionListItem = {
  versionId: string;
  versionNumber: number;
  sourceDraftRevision: number;
  required: number | null;
  rawAssigned: number | null;
  effectiveAssigned: number | null;
  covered: number | null;
  missing: number | null;
  overstaffed: number | null;
  percentage: number | null;
  coverageBasis: string;
  warningCount: number;
  checksum: string;
  publicationKind: string;
  sourceDraftComplete: boolean;
  publisherDisplayName: string | null;
  publishedAt: string;
  latest: boolean;
};

export type StaffingVersions = {
  planId: string;
  organizationId: string;
  unitId: string;
  limit: number;
  nextBeforeVersion: number | null;
  hasMore: boolean;
  versions: StaffingVersionListItem[];
};

export type StaffingVersionDay = {
  sourcePlanDayId: string | null;
  date: string;
  roomsContext: number | null;
  source: string;
};

export type StaffingVersionRequirement = {
  sourceRequirementId: string | null;
  sourcePlanDayId: string | null;
  date: string;
  unitId: string;
  unitName: string;
  workTypeId: string | null;
  workTypeCode: string;
  workTypeName: string;
  startTime: string | null;
  endTime: string | null;
  breakMinutes: number;
  requiredWorkers: number;
  requiredQuantity: number | null;
  legacyPublicationStatus: string;
};

export type StaffingVersionAssignment = {
  sourceAssignmentId: string | null;
  sourceRequirementId: string | null;
  membershipId: string | null;
  memberDisplayName: string;
  membershipStatus: string;
  date: string;
  unitId: string;
  unitName: string;
  workTypeId: string | null;
  workTypeCode: string;
  workTypeName: string;
  startTime: string | null;
  endTime: string | null;
  status: string;
  checkInMode: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
};

export type StaffingVersionMemberDay = {
  sourceDayEntryId: string | null;
  membershipId: string | null;
  memberDisplayName: string;
  date: string;
  status: string;
  source: string;
};

export type StaffingVersionAcknowledgement = {
  issueKey: string;
  severity: StaffingIssue["severity"];
  acknowledgedAt: string;
};

export type StaffingVersionCoverage = {
  sourceRequirementId: string;
  date: string;
  workTypeCode: string;
  workTypeName: string;
  required: number;
  rawAssigned: number;
  effectiveAssigned: number;
  covered: number;
  missing: number;
  overstaffed: number;
  percentage: number;
  openPositions: number;
};

export type StaffingVersionDayCoverage = Omit<StaffingVersionCoverage,
  "sourceRequirementId" | "workTypeCode" | "workTypeName">;

export type StaffingVersionDetail = {
  versionId: string;
  planId: string;
  organizationId: string;
  unitId: string;
  versionNumber: number;
  sourceDraftRevision: number;
  required: number | null;
  rawAssigned: number | null;
  effectiveAssigned: number | null;
  covered: number | null;
  missing: number | null;
  overstaffed: number | null;
  percentage: number | null;
  coverageBasis: string;
  warningCount: number;
  checksum: string;
  checksumFormatVersion: number;
  granularCoverageAvailable: boolean;
  publicationKind: string;
  sourceDraftComplete: boolean;
  publishedAt: string;
  timezone: string;
  weekStart: string;
  days: StaffingVersionDay[];
  requirements: StaffingVersionRequirement[];
  assignments: StaffingVersionAssignment[];
  memberDays: StaffingVersionMemberDay[];
  acknowledgements: StaffingVersionAcknowledgement[];
  requirementCoverage: StaffingVersionCoverage[];
  dayCoverage: StaffingVersionDayCoverage[];
};

export type StaffingPublishInput = {
  acknowledgementKeys: string[];
  publicationNote: string | null;
};

export type StaffingPublishResult = {
  planId: string;
  versionId: string;
  versionNumber: number;
  sourceDraftRevision: number;
  publishedRevision: number;
  publishedAt: string;
  publicationKind: string;
  canonicalCoverage: Omit<StaffingCoverageTotals, "openPositions">;
  warningCount: number;
  checksum: string;
  idempotentReplay: boolean;
};

export type StaffingScheduleAssignment = {
  assignmentId: string;
  requirementId: string;
  membershipId: string;
  memberDisplayName: string;
  membershipStatus: "ACTIVE" | "INVITED" | "SUSPENDED";
  status: "ASSIGNED" | "CANCELLED";
  startTime: string | null;
  endTime: string | null;
  intervalOverride: boolean;
  effective: boolean;
  issueKeys: string[];
};

export type StaffingDayStatus = {
  membershipId: string;
  date: string;
  status: "REST_DAY" | "VACATION" | "SICK" | "UNAVAILABLE" | string;
  source: string;
  pending: boolean;
};

export type StaffingScheduleMember = {
  membershipId: string;
  displayName: string;
  membershipStatus: "ACTIVE" | "INVITED" | "SUSPENDED";
  assignmentIds: string[];
  dayStatuses: StaffingDayStatus[];
  /** Membership creation time, supplied by the schedule endpoint for local ordering only. */
  createdAt?: string | null;
  /** Shared, manager-defined planner row position. */
  displayOrder: number;
};

export type StaffingScheduleRequirement = {
  requirementId: string;
  planDayId: string;
  date: string;
  workTypeId: string;
  workTypeCode: string;
  workTypeName: string;
  startTime: string | null;
  endTime: string | null;
  breakMinutes: number;
  requiredWorkers: number;
  coverage: StaffingCoverageTotals;
  assignments: StaffingScheduleAssignment[];
  issueKeys: string[];
};

export type StaffingScheduleDay = {
  planDayId: string | null;
  date: string;
  persisted: boolean;
  roomsContext: number | null;
  source: string | null;
  coverage: StaffingCoverageTotals;
  requirements: StaffingScheduleRequirement[];
  issueKeys: string[];
};

export type StaffingSchedule = {
  planId: string;
  organizationId: string;
  unitId: string;
  weekStart: string;
  weekEnd: string;
  draftRevision: number;
  etag: string;
  coverage: StaffingCoverageTotals;
  days: StaffingScheduleDay[];
  members: StaffingScheduleMember[];
  issues: StaffingIssue[];
};

export type StaffingCandidateReason = {
  code: string;
  messageKey: string;
  parameters: Record<string, string>;
};

export type StaffingAssignmentCandidate = {
  membershipId: string;
  displayName: string;
  membershipStatus: "ACTIVE" | "INVITED" | "SUSPENDED";
  recommended: boolean;
  rank: number | null;
  eligibility: "ELIGIBLE" | "ELIGIBLE_WITH_WARNING" | "INELIGIBLE";
  availability: string;
  alreadyAssignedThisDay: boolean;
  weeklyScheduledMinutes: number;
  matchingWorkTypeAssignments: number | null;
  conflict: {
    duplicateAssignment: boolean;
    overlappingAssignment: boolean;
    assignmentsOnDay: number;
  };
  reasons: StaffingCandidateReason[];
};

export type StaffingAssignmentCandidates = {
  planId: string;
  requirementId: string;
  draftRevision: number;
  etag: string;
  requirement: {
    requirementId: string;
    date: string;
    workTypeId: string;
    workTypeCode: string;
    workTypeName: string;
    startTime: string | null;
    endTime: string | null;
    requiredWorkers: number;
    coverage: StaffingCoverageTotals;
  };
  candidates: StaffingAssignmentCandidate[];
  projection: {
    membershipId: string;
    before: StaffingCoverageTotals;
    after: StaffingCoverageTotals;
    resolvesOpenPosition: boolean;
  } | null;
  limitations: string[];
  capabilities: StaffingPlanCapabilities;
};

export type StaffingAssignmentInput = {
  requirementId: string;
  membershipId: string;
  startTime: string | null;
  endTime: string | null;
};

export type StaffingAssignmentUpdateInput = {
  startTime: string | null;
  endTime: string | null;
};

export type StaffingAssignmentBatchAction =
  | {
      operation: "CREATE";
      assignmentId: null;
      create: StaffingAssignmentInput;
      update: null;
    }
  | {
      operation: "UPDATE";
      assignmentId: string;
      create: null;
      update: StaffingAssignmentUpdateInput;
    }
  | {
      operation: "CANCEL";
      assignmentId: string;
      create: null;
      update: null;
    };

export type StaffingPlanBootstrapResult = {
  planId: string;
  organizationId: string;
  unitId: string;
  weekStart: string;
  timezone: string;
  status: "ACTIVE" | "ARCHIVED";
  draftRevision: number;
  created: boolean;
  idempotentReplay: boolean;
  capabilities: StaffingPlanCapabilities;
};

export type ApiEntityResult<T> = {
  data: T;
  etag: string | null;
  location: string | null;
  status: number;
  idempotentReplay: boolean;
};
