package com.alveryn.api.staffing.dto;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Stable, privacy-reviewed read models for aggregate-native Business planning reads. */
public final class StaffingPlanQueryDtos {
  private StaffingPlanQueryDtos() {}

  public record QueryResult<T>(T body, String etag, boolean immutable, boolean notModified) {}

  public record PlanLookupResponse(boolean found, PlanHeaderResponse plan) {}

  public record PlanCapabilities(boolean view, boolean manage, boolean publish) {}

  public record PublishedVersionSummary(UUID versionId, int versionNumber,
      long sourceDraftRevision, OffsetDateTime publishedAt, String publicationKind,
      String coverageBasis, String checksum) {}

  public record PlanHeaderResponse(UUID planId, UUID organizationId, UUID unitId,
      String unitName, LocalDate weekStart, LocalDate weekEnd, String timezone, String status,
      long draftRevision, String etag, PublishedVersionSummary latestPublishedVersion,
      Long publishedRevision, OffsetDateTime publishedAt, boolean hasUnpublishedChanges,
      PlanCapabilities capabilities) {}

  public record IssueResponse(String issueKey, String code, String severity, LocalDate date,
      UUID requirementId, UUID assignmentId, UUID membershipId, String messageKey,
      Map<String, String> parameters, boolean acknowledgementRequired, boolean publishBlocking) {}

  public record CoverageTotals(int required, int rawAssigned, int effectiveAssigned,
      int covered, int missing, int overstaffed, BigDecimal percentage, int openPositions) {}

  public record RequirementDemandResponse(UUID requirementId, UUID planDayId,
      UUID workTypeId, String workTypeCode, String workTypeName, LocalTime startTime,
      LocalTime endTime, int breakMinutes, int requiredWorkers, BigDecimal requiredQuantity,
      String legacyPublicationStatus, String notes, CoverageTotals coverage,
      List<String> issueKeys) {}

  public record DemandDayResponse(UUID planDayId, LocalDate date, boolean persisted,
      Integer roomsContext, String notes, String source, CoverageTotals coverage,
      List<RequirementDemandResponse> requirements, List<String> issueKeys) {}

  public record DemandResponse(UUID planId, UUID organizationId, UUID unitId,
      LocalDate weekStart, LocalDate weekEnd, long draftRevision, String etag,
      CoverageTotals coverage, List<DemandDayResponse> days) {}

  public record AssignmentResponse(UUID assignmentId, UUID requirementId, UUID membershipId,
      String memberDisplayName, String membershipStatus, String status, LocalTime startTime,
      LocalTime endTime, boolean intervalOverride, boolean effective, List<String> issueKeys) {}

  public record DayStatusResponse(UUID membershipId, LocalDate date, String status,
      String source, boolean pending) {}

  public record MemberResponse(UUID membershipId, String displayName, String membershipStatus,
      Set<UUID> assignmentIds, List<DayStatusResponse> dayStatuses, OffsetDateTime createdAt,
      int displayOrder) {}

  public record ScheduleRequirementResponse(UUID requirementId, UUID planDayId,
      LocalDate date, UUID workTypeId, String workTypeCode, String workTypeName,
      LocalTime startTime, LocalTime endTime, int breakMinutes, int requiredWorkers,
      CoverageTotals coverage, List<AssignmentResponse> assignments, List<String> issueKeys) {}

  public record ScheduleDayResponse(UUID planDayId, LocalDate date, boolean persisted,
      Integer roomsContext, String source, CoverageTotals coverage,
      List<ScheduleRequirementResponse> requirements, List<String> issueKeys) {}

  public record ScheduleResponse(UUID planId, UUID organizationId, UUID unitId,
      LocalDate weekStart, LocalDate weekEnd, long draftRevision, String etag,
      CoverageTotals coverage, List<ScheduleDayResponse> days, List<MemberResponse> members,
      List<IssueResponse> issues) {}

  public record CandidateRequirementResponse(UUID requirementId, LocalDate date,
      UUID workTypeId, String workTypeCode, String workTypeName, LocalTime startTime,
      LocalTime endTime, int requiredWorkers, CoverageTotals coverage) {}

  public record CandidateReasonResponse(String code, String messageKey,
      Map<String, String> parameters) {}

  public record CandidateConflictResponse(boolean duplicateAssignment,
      boolean overlappingAssignment, int assignmentsOnDay) {}

  public record AssignmentCandidateResponse(UUID membershipId, String displayName,
      String membershipStatus, boolean recommended, Integer rank, String eligibility,
      String availability, boolean alreadyAssignedThisDay, int weeklyScheduledMinutes,
      Integer matchingWorkTypeAssignments, CandidateConflictResponse conflict,
      List<CandidateReasonResponse> reasons) {}

  public record CandidateCoverageProjection(UUID membershipId, CoverageTotals before,
      CoverageTotals after, boolean resolvesOpenPosition) {}

  public record AssignmentCandidatesResponse(UUID planId, UUID requirementId,
      long draftRevision, String etag, CandidateRequirementResponse requirement,
      List<AssignmentCandidateResponse> candidates, CandidateCoverageProjection projection,
      List<String> limitations, PlanCapabilities capabilities) {}

  public record CoverageResponse(UUID planId, UUID organizationId, UUID unitId,
      LocalDate weekStart, long draftRevision, String etag, CoverageTotals totals,
      List<RequirementCoverageResponse> requirements, List<DayCoverageResponse> days,
      List<IssueResponse> issues, int blockingIssueCount, int warningCount,
      int informationCount, boolean publishable) {}

  public record RequirementCoverageResponse(UUID requirementId, UUID planDayId,
      LocalDate date, UUID workTypeId, String workTypeCode, String workTypeName,
      LocalTime startTime, LocalTime endTime, CoverageTotals totals,
      List<UUID> assignmentIds, List<UUID> effectiveAssignmentIds, List<String> issueKeys) {}

  public record DayCoverageResponse(LocalDate date, CoverageTotals totals,
      List<String> issueKeys) {}

  public record IssueGroupResponse(String severity, int count, List<IssueResponse> issues) {}

  public record ReviewResponse(UUID planId, UUID organizationId, UUID unitId,
      LocalDate weekStart, long draftRevision, String etag, CoverageTotals coverage,
      List<IssueGroupResponse> groups, int blockingIssueCount, int warningCount,
      int informationCount, boolean publishable, List<String> requiredAcknowledgementKeys) {}

  public record VersionListItem(UUID versionId, int versionNumber, long sourceDraftRevision,
      Integer required, Integer rawAssigned, Integer effectiveAssigned, Integer covered,
      Integer missing, Integer overstaffed, BigDecimal percentage, String coverageBasis,
      int warningCount, String checksum, String publicationKind, boolean sourceDraftComplete,
      String publisherDisplayName, OffsetDateTime publishedAt,
      boolean latest) {}

  public record VersionsResponse(UUID planId, UUID organizationId, UUID unitId,
      int limit, Integer nextBeforeVersion, boolean hasMore, List<VersionListItem> versions) {}

  public record VersionDayResponse(UUID sourcePlanDayId, LocalDate date,
      Integer roomsContext, String source) {}

  public record VersionRequirementResponse(UUID sourceRequirementId, UUID sourcePlanDayId,
      LocalDate date, UUID unitId, String unitName, UUID workTypeId, String workTypeCode,
      String workTypeName, LocalTime startTime, LocalTime endTime, int breakMinutes,
      int requiredWorkers, BigDecimal requiredQuantity, String legacyPublicationStatus) {}

  public record VersionAssignmentResponse(UUID sourceAssignmentId, UUID sourceRequirementId,
      UUID membershipId, String memberDisplayName, String membershipStatus, LocalDate date,
      UUID unitId, String unitName, UUID workTypeId, String workTypeCode, String workTypeName,
      LocalTime startTime, LocalTime endTime, String status, String checkInMode,
      OffsetDateTime checkedInAt, OffsetDateTime checkedOutAt) {}

  public record VersionMemberDayResponse(UUID sourceDayEntryId, UUID membershipId,
      String memberDisplayName, LocalDate date, String status, String source) {}

  public record VersionAcknowledgementResponse(String issueKey, String severity,
      OffsetDateTime acknowledgedAt) {}

  public record VersionRequirementCoverageResponse(UUID sourceRequirementId, LocalDate date,
      String workTypeCode, String workTypeName, int required, int rawAssigned,
      int effectiveAssigned, int covered, int missing, int overstaffed,
      BigDecimal percentage, int openPositions) {}

  public record VersionDayCoverageResponse(LocalDate date, int required, int rawAssigned,
      int effectiveAssigned, int covered, int missing, int overstaffed,
      BigDecimal percentage, int openPositions) {}

  public record VersionDetailResponse(UUID versionId, UUID planId, UUID organizationId,
      UUID unitId, int versionNumber, long sourceDraftRevision, Integer required,
      Integer rawAssigned, Integer effectiveAssigned, Integer covered, Integer missing,
      Integer overstaffed, BigDecimal percentage, String coverageBasis, int warningCount,
      String checksum, int checksumFormatVersion, boolean granularCoverageAvailable,
      String publicationKind, boolean sourceDraftComplete,
      OffsetDateTime publishedAt,
      String timezone, LocalDate weekStart, List<VersionDayResponse> days,
      List<VersionRequirementResponse> requirements,
      List<VersionAssignmentResponse> assignments,
      List<VersionMemberDayResponse> memberDays,
      List<VersionAcknowledgementResponse> acknowledgements,
      List<VersionRequirementCoverageResponse> requirementCoverage,
      List<VersionDayCoverageResponse> dayCoverage) {}
}
