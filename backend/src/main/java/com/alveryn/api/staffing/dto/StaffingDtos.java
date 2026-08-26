package com.alveryn.api.staffing.dto;

import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import com.alveryn.api.worktype.entity.*;

public final class StaffingDtos {
  private StaffingDtos() {}
  public record WorkTypeRequest(UUID unitId, UUID parentId, @NotBlank @Size(max=20) String code,
      @Size(max=120) String name, @Size(max=20) String color,
      LocalTime defaultStartTime, LocalTime defaultEndTime, @PositiveOrZero Integer defaultBreakMinutes,
      CalculationMethod calculationMethod, CompensationMethod compensationMethod,
      @Size(max=100) String unitLabel,@Size(max=20) String unitSymbol,@Positive BigDecimal unitsPerHour,
      @Positive BigDecimal ratePerUnit,@Size(min=3,max=3) String currency,Boolean teamworkEnabled,
      Boolean extraPayEnabled,Boolean compositeEnabled,@PositiveOrZero Integer displayOrder,Boolean active) {}
  public record WorkTypeResponse(UUID id, UUID unitId, UUID parentId, String code, String name, String color,
      LocalTime defaultStartTime, LocalTime defaultEndTime, int defaultBreakMinutes,CalculationMethod calculationMethod,
      CompensationMethod compensationMethod,String unitLabel,String unitSymbol,BigDecimal unitsPerHour,BigDecimal ratePerUnit,
      String currency,boolean teamworkEnabled,boolean extraPayEnabled,boolean compositeEnabled,int displayOrder,boolean active) {}
  public record RequirementRequest(@NotNull UUID unitId, @NotNull UUID workTypeId, @NotNull LocalDate date,
      LocalTime startTime, LocalTime endTime, @Positive int requiredWorkers,
      @Positive BigDecimal requiredQuantity, @Size(max=500) String notes) {}
  public record BulkRequirementRequest(@NotNull UUID unitId, @NotNull UUID workTypeId,
      @NotEmpty @Size(max=31) Set<@NotNull LocalDate> dates, LocalTime startTime, LocalTime endTime,
      @Positive int requiredWorkers, @Positive BigDecimal requiredQuantity, @Size(max=500) String notes) {}
  public record AssignmentRequest(@NotNull UUID membershipId, LocalTime startTime, LocalTime endTime) {}
  public record AssignmentTimeRequest(LocalTime startTime, LocalTime endTime) {}
  public record MemberOrderRequest(@NotEmpty @Size(max=500) List<@NotNull UUID> membershipIds) {}
  public record RequirementUpdateRequest(LocalTime startTime, LocalTime endTime, @Positive int requiredWorkers,
      @Positive BigDecimal requiredQuantity, @Size(max=500) String notes,
      UUID unitId, UUID workTypeId, LocalDate date) {}
  public record PublishRequest(@NotNull LocalDate from, @NotNull LocalDate to, Set<UUID> requirementIds) {}
  public record PublishResponse(int publishedRequirements, int publishedAssignments) {}
  public record ResultRequest(LocalTime actualStartTime, LocalTime actualEndTime,
      @PositiveOrZero Integer breakMinutes, @PositiveOrZero BigDecimal completedQuantity,
      @Size(max=1000) String notes, boolean submit) {}
  public record ResultReviewRequest(LocalTime actualStartTime, LocalTime actualEndTime,
      @PositiveOrZero Integer breakMinutes, @PositiveOrZero BigDecimal completedQuantity,
      @Size(max=1000) String notes) {}
  public record AssignmentResultResponse(UUID id, UUID assignmentId, UUID organizationId, String organizationName,
      String memberName, LocalDate date, String workTypeName, String workTypeCode, String unitName,
      LocalTime actualStartTime, LocalTime actualEndTime, int breakMinutes, BigDecimal completedQuantity, Integer calculatedMinutes,
      String notes, String approvalStatus, OffsetDateTime submittedAt, OffsetDateTime reviewedAt,
      OffsetDateTime checkedInAt, OffsetDateTime checkedOutAt, String timeCaptureSource) {}
  public record TeamHoursDayResponse(LocalDate date, Integer plannedMinutes, Integer workedMinutes,
      int completedSessions, int openSessions, int incompleteSessions, int correctedSessions) {}
  public record TeamHoursPeriodResponse(LocalDate startDate, LocalDate endDate, int plannedMinutes,
      int workedMinutes) {}
  /** Chronological manager-only history. Deliberately contains no technical identifiers. */
  public record TeamHoursSessionResponse(LocalDate date, String unitName, String workTypeName,
      LocalTime plannedStartTime, LocalTime plannedEndTime, LocalTime actualStartTime,
      LocalTime actualEndTime, int breakMinutes, Integer netMinutes, String state) {}
  public record TeamHoursAbsenceResponse(LocalDate date, String type, String notes) {}
  public record TeamMemberHoursResponse(UUID membershipId, String memberName, LocalDate from, LocalDate to,
      int daysWorked, int plannedMinutes, int workedMinutes, List<TeamHoursDayResponse> days,
      List<TeamHoursPeriodResponse> weeks, List<TeamHoursPeriodResponse> months,
      List<TeamHoursSessionResponse> sessions, int totalSessions, int offset,
      List<TeamHoursAbsenceResponse> absences) {}
  public record AssignmentResponse(UUID id, UUID membershipId, String memberName, LocalTime startTime,
      LocalTime endTime, boolean hasConflict, List<UUID> conflictingAssignmentIds, boolean viewed,
      AssignmentResultResponse result) {}
  public record DayEntryRequest(@NotBlank String type, @Size(max=500) String notes) {}
  public record DayEntryResponse(UUID id, UUID membershipId, LocalDate date, String type, String notes,
      boolean hasWorkConflict) {}
  public record RequirementResponse(UUID id, UUID unitId, String unitName, UUID workTypeId, String code,
      String workTypeName, String color, LocalDate date, LocalTime startTime, LocalTime endTime,
      int requiredWorkers, BigDecimal requiredQuantity, int assignedWorkers, int coverageDifference,
      String coverageStatus, String publicationStatus, String checkInMode,
      List<AssignmentResponse> assignments) {}
  public record PersonalAssignmentResultResponse(UUID id, LocalTime actualStartTime,
      LocalTime actualEndTime, int breakMinutes, BigDecimal completedQuantity,
      Integer calculatedMinutes, String notes, String approvalStatus,
      OffsetDateTime submittedAt, OffsetDateTime reviewedAt, OffsetDateTime checkedInAt,
      OffsetDateTime checkedOutAt, String timeCaptureSource) {}
  public record PersonalAssignmentResponse(UUID id, UUID versionId, LocalDate date,
      UUID unitId, String unitName,
      UUID workTypeId, String workTypeCode, String workTypeName, String color,
      LocalTime startTime, LocalTime endTime, String checkInMode,
      PersonalAssignmentResultResponse result) {}
  public record PersonalDayEntryResponse(UUID id, UUID versionId, LocalDate date,
      String type, String notes,
      boolean hasWorkConflict) {}
  public record PersonalPublishedVersionResponse(UUID planId, UUID unitId, UUID versionId,
      int versionNumber, OffsetDateTime publishedAt, LocalDate weekStart) {}
  public record PersonalScheduleResponse(UUID organizationId, String organizationName, LocalDate from, LocalDate to,
      List<PersonalPublishedVersionResponse> publishedVersions,
      List<PersonalAssignmentResponse> assignments, List<PersonalDayEntryResponse> dayEntries) {}
  public record ChangeEventResponse(UUID id, String eventType, String entityType, UUID entityId, LocalDate workDate,
      String summary, String actorName, OffsetDateTime createdAt) {}
  public record AbsenceRequestCreate(@NotNull UUID organizationId,@NotBlank String type,@NotNull LocalDate startDate,@NotNull LocalDate endDate,@Size(max=1000) String notes) {}
  public record AbsenceDecisionRequest(boolean approve) {}
  public record AbsenceRequestResponse(UUID id,UUID organizationId,String organizationName,UUID membershipId,String memberName,String type,LocalDate startDate,LocalDate endDate,String notes,String status,OffsetDateTime createdAt,OffsetDateTime reviewedAt) {}
}
