package com.alveryn.api.staffing.service;

import static com.alveryn.api.staffing.dto.StaffingPlanQueryDtos.*;

import com.alveryn.api.common.exception.NotFoundException;
import com.alveryn.api.organization.entity.OrganizationPermission;
import com.alveryn.api.organization.entity.OrganizationUnit;
import com.alveryn.api.organization.repository.OrganizationUnitRepository;
import com.alveryn.api.organization.service.OrganizationAccessService;
import com.alveryn.api.staffing.service.StaffingPlanCoverageService.CoverageProjection;
import com.alveryn.api.staffing.service.StaffingPlanCoverageService.CoverageResult;
import com.alveryn.api.staffing.service.StaffingPlanCoverageService.RequirementCoverage;
import java.math.BigDecimal;
import java.text.Normalizer;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.function.Predicate;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Privacy-reviewed, deterministic candidate read model for one open plan requirement. */
@Service
@RequiredArgsConstructor
public class StaffingAssignmentCandidateService {
  private static final List<String> LIMITATIONS = List.of(
      "DECLARED_SKILLS_NOT_CONFIGURED",
      "DECLARED_AVAILABILITY_NOT_CONFIGURED",
      "UNIT_MEMBERSHIP_ELIGIBILITY_NOT_ENFORCED_BY_CURRENT_ASSIGNMENT_MODEL");

  private final NamedParameterJdbcTemplate jdbc;
  private final OrganizationUnitRepository units;
  private final OrganizationAccessService access;
  private final StaffingPlanCoverageService coverageService;

  @Transactional(readOnly = true)
  public QueryResult<AssignmentCandidatesResponse> candidates(UUID organizationId, UUID planId,
      UUID requirementId, String ifNoneMatch) {
    AuthorizedRequirement authorized = authorize(organizationId, planId, requirementId);
    String etag = StaffingPlanMutationCoordinator.etag(planId, authorized.plan.draftRevision);
    if (StaffingPlanQueryService.matches(ifNoneMatch, etag)) {
      return new QueryResult<>(null, etag, false, true);
    }

    LinkedHashMap<UUID, CandidateBuilder> candidates = loadCandidates(authorized.plan);
    loadTargetDayStatuses(authorized, candidates);
    loadPendingRequests(authorized, candidates);
    loadWeekAssignments(authorized, candidates);
    loadWorkTypeHistory(authorized, candidates);
    evaluate(authorized, candidates);

    List<CandidateBuilder> eligible = candidates.values().stream()
        .filter(value -> value.eligibility != Eligibility.INELIGIBLE)
        .sorted(candidateComparator()).toList();
    int minimumLoad = eligible.stream().mapToInt(value -> value.weeklyMinutes).min().orElse(0);
    for (int index = 0; index < eligible.size(); index++) {
      CandidateBuilder value = eligible.get(index);
      value.rank = index + 1;
      value.recommended = index == 0;
      if (value.weeklyMinutes == minimumLoad) {
        value.reason("LOWER_WEEKLY_LOAD", Map.of("minutes",
            Integer.toString(value.weeklyMinutes)));
      }
    }

    CandidateBuilder recommended = eligible.isEmpty() ? null : eligible.getFirst();
    CoverageResult before;
    CoverageResult after;
    if (recommended == null) {
      before = coverageService.calculate(organizationId, authorized.plan.unitId, planId);
      after = before;
    } else {
      CoverageProjection projection = coverageService.projectAssignment(organizationId,
          authorized.plan.unitId, planId, requirementId, recommended.id);
      before = projection.before();
      after = projection.after();
    }
    RequirementCoverage beforeRequirement = requireCoverage(before, requirementId);
    RequirementCoverage afterRequirement = requireCoverage(after, requirementId);
    CoverageTotals beforeTotals = totals(beforeRequirement);
    CoverageTotals afterTotals = totals(afterRequirement);
    CandidateCoverageProjection projection = recommended == null ? null
        : new CandidateCoverageProjection(recommended.id, beforeTotals, afterTotals,
            afterRequirement.covered() > beforeRequirement.covered()
                && afterRequirement.missing() < beforeRequirement.missing());

    List<AssignmentCandidateResponse> responses = candidates.values().stream()
        .sorted(Comparator.comparing((CandidateBuilder value) ->
                value.rank == null ? Integer.MAX_VALUE : value.rank)
            .thenComparing(value -> normalizeName(value.displayName))
            .thenComparing(value -> value.id))
        .map(CandidateBuilder::response).toList();
    RequirementRow requirement = authorized.requirement;
    CandidateRequirementResponse requirementResponse = new CandidateRequirementResponse(
        requirement.id, requirement.date, requirement.workTypeId, requirement.workTypeCode,
        requirement.workTypeName, requirement.start, requirement.end,
        requirement.requiredWorkers, beforeTotals);
    AssignmentCandidatesResponse response = new AssignmentCandidatesResponse(planId,
        requirementId, authorized.plan.draftRevision, etag, requirementResponse, responses,
        projection, LIMITATIONS, authorized.capabilities);
    return new QueryResult<>(response, etag, false, false);
  }

  private AuthorizedRequirement authorize(UUID organizationId, UUID planId, UUID requirementId) {
    if (!access.permissions(organizationId).contains(OrganizationPermission.VIEW_SCHEDULE)) {
      throw new AccessDeniedException("Required organization permission is missing");
    }
    List<AuthorizedRequirement> rows = jdbc.query("""
        select p.id plan_id,p.organization_id,p.unit_id,p.week_start,p.draft_revision,
          r.id requirement_id,r.work_date,r.work_type_id,wt.code work_type_code,
          wt.name work_type_name,wt.active work_type_active,r.start_time,r.end_time,
          r.required_workers
        from staffing_plans p
        join staffing_plan_days d on d.plan_id=p.id and d.organization_id=p.organization_id
        join staffing_requirements r on r.plan_day_id=d.id
          and r.organization_id=p.organization_id and r.unit_id=p.unit_id
        join organization_work_types wt on wt.id=r.work_type_id
          and wt.organization_id=p.organization_id
        where p.id=:plan and p.organization_id=:organization and r.id=:requirement
        """, params("plan", planId, "organization", organizationId,
            "requirement", requirementId), (rs, row) -> {
          PlanRow plan = new PlanRow(rs.getObject("plan_id", UUID.class),
              rs.getObject("organization_id", UUID.class), rs.getObject("unit_id", UUID.class),
              rs.getObject("week_start", LocalDate.class), rs.getLong("draft_revision"));
          RequirementRow requirement = new RequirementRow(
              rs.getObject("requirement_id", UUID.class),
              rs.getObject("work_date", LocalDate.class),
              rs.getObject("work_type_id", UUID.class), rs.getString("work_type_code"),
              rs.getString("work_type_name"), rs.getBoolean("work_type_active"),
              rs.getObject("start_time", LocalTime.class),
              rs.getObject("end_time", LocalTime.class), rs.getInt("required_workers"));
          return new AuthorizedRequirement(plan, requirement, null);
        });
    AuthorizedRequirement found = rows.stream().findFirst()
        .orElseThrow(() -> new NotFoundException("Staffing requirement", requirementId));
    OrganizationUnit unit = units.findByIdAndOrganizationId(found.plan.unitId, organizationId)
        .orElseThrow(() -> new NotFoundException("Organization unit", found.plan.unitId));
    Predicate<OrganizationUnit> view = access.unitAccessFilter(organizationId,
        OrganizationPermission.VIEW_SCHEDULE);
    if (!view.test(unit)) throw new NotFoundException("Organization unit", found.plan.unitId);
    boolean manage = access.canAccess(organizationId, unit,
        OrganizationPermission.MANAGE_SCHEDULE);
    boolean publish = access.canAccess(organizationId, unit,
        OrganizationPermission.PUBLISH_SCHEDULE);
    return new AuthorizedRequirement(found.plan, found.requirement,
        new PlanCapabilities(true, manage, publish));
  }

  private LinkedHashMap<UUID, CandidateBuilder> loadCandidates(PlanRow plan) {
    LinkedHashMap<UUID, CandidateBuilder> result = new LinkedHashMap<>();
    jdbc.query("""
        select id,
          coalesce(nullif(btrim(concat_ws(' ',first_name,last_name)),''),
            'Member ' || left(id::text,8)) display_name,
          membership_status
        from organization_memberships
        where organization_id=:organization
        order by lower(coalesce(nullif(btrim(concat_ws(' ',first_name,last_name)),''),
          'Member ' || left(id::text,8))),id
        """, params("organization", plan.organizationId), (RowCallbackHandler) rs -> {
          UUID id = rs.getObject("id", UUID.class);
          result.put(id, new CandidateBuilder(id, rs.getString("display_name"),
              rs.getString("membership_status")));
        });
    return result;
  }

  private void loadTargetDayStatuses(AuthorizedRequirement source,
      Map<UUID, CandidateBuilder> candidates) {
    if (candidates.isEmpty()) return;
    jdbc.query("""
        select membership_id,entry_type
        from staffing_member_day_entries
        where organization_id=:organization and membership_id in (:members)
          and work_date=:date
        order by membership_id
        """, params("organization", source.plan.organizationId, "members", candidates.keySet(),
            "date", source.requirement.date), (RowCallbackHandler) rs ->
          candidates.get(rs.getObject("membership_id", UUID.class)).dayStatus =
              rs.getString("entry_type"));
  }

  private void loadPendingRequests(AuthorizedRequirement source,
      Map<UUID, CandidateBuilder> candidates) {
    if (candidates.isEmpty()) return;
    jdbc.query("""
        select membership_id,absence_type
        from staffing_absence_requests
        where organization_id=:organization and membership_id in (:members)
          and request_status='PENDING' and start_date<=:date and end_date>=:date
        order by membership_id,id
        """, params("organization", source.plan.organizationId, "members", candidates.keySet(),
            "date", source.requirement.date), (RowCallbackHandler) rs -> {
          CandidateBuilder candidate = candidates.get(rs.getObject("membership_id", UUID.class));
          candidate.pendingRequest = true;
          candidate.pendingRequestType = rs.getString("absence_type");
        });
  }

  private void loadWeekAssignments(AuthorizedRequirement source,
      Map<UUID, CandidateBuilder> candidates) {
    if (candidates.isEmpty()) return;
    jdbc.query("""
        select a.membership_id,r.id requirement_id,r.work_date,r.unit_id,
          coalesce(a.start_time,r.start_time) effective_start,
          coalesce(a.end_time,r.end_time) effective_end
        from staffing_assignments a
        join staffing_requirements r on r.id=a.requirement_id
        where r.organization_id=:organization and a.membership_id in (:members)
          and a.assignment_status='ASSIGNED' and r.work_date between :from and :to
        order by a.membership_id,r.work_date,effective_start nulls first,a.id
        """, params("organization", source.plan.organizationId, "members", candidates.keySet(),
            "from", source.plan.weekStart, "to", source.plan.weekStart.plusDays(6)),
        (RowCallbackHandler) rs -> {
          CandidateBuilder candidate = candidates.get(rs.getObject("membership_id", UUID.class));
          LocalDate date = rs.getObject("work_date", LocalDate.class);
          LocalTime start = rs.getObject("effective_start", LocalTime.class);
          LocalTime end = rs.getObject("effective_end", LocalTime.class);
          UUID requirementId = rs.getObject("requirement_id", UUID.class);
          UUID unitId = rs.getObject("unit_id", UUID.class);
          if (hasTimedInterval(start, end)) {
            candidate.weeklyMinutes += (int) Duration.between(start, end).toMinutes();
          }
          if (!date.equals(source.requirement.date)) return;
          candidate.assignmentsOnDay++;
          candidate.assignedThisDay = true;
          if (requirementId.equals(source.requirement.id)) candidate.duplicate = true;
          if (!unitId.equals(source.plan.unitId)) candidate.otherUnitAssignment = true;
          if (hasTimedInterval(start, end) && hasTimedInterval(source.requirement.start,
              source.requirement.end) && overlaps(start, end, source.requirement.start,
              source.requirement.end)) candidate.overlap = true;
        });
  }

  private void loadWorkTypeHistory(AuthorizedRequirement source,
      Map<UUID, CandidateBuilder> candidates) {
    if (candidates.isEmpty()) return;
    jdbc.query("""
        select a.membership_id,count(*) total_assignments,
          count(*) filter (where r.work_type_id=:workType) matching_assignments
        from staffing_assignments a
        join staffing_requirements r on r.id=a.requirement_id
        where r.organization_id=:organization and a.membership_id in (:members)
          and a.assignment_status='ASSIGNED'
        group by a.membership_id
        order by a.membership_id
        """, params("organization", source.plan.organizationId, "members", candidates.keySet(),
            "workType", source.requirement.workTypeId), (RowCallbackHandler) rs -> {
          CandidateBuilder candidate = candidates.get(rs.getObject("membership_id", UUID.class));
          candidate.totalHistoricalAssignments = rs.getInt("total_assignments");
          candidate.matchingWorkTypeAssignments = rs.getInt("matching_assignments");
        });
  }

  private void evaluate(AuthorizedRequirement source, Map<UUID, CandidateBuilder> candidates) {
    for (CandidateBuilder value : candidates.values()) {
      if (!"ACTIVE".equals(value.status)) {
        value.ineligible("INACTIVE_MEMBERSHIP",
            "INVITED".equals(value.status) ? "INVITATION_PENDING" : "INACTIVE_MEMBERSHIP");
      }
      if (!source.requirement.workTypeActive
          || !validRequirementInterval(source.requirement.start, source.requirement.end)) {
        value.ineligible("INVALID_REQUIREMENT", "INVALID_REQUIREMENT");
      }
      if ("REST_DAY".equals(value.dayStatus) || "VACATION".equals(value.dayStatus)
          || "SICK".equals(value.dayStatus)) {
        value.ineligible("APPROVED_TIME_AWAY", "APPROVED_TIME_AWAY",
            Map.of("type", value.dayStatus));
      }
      if (value.duplicate) {
        value.ineligible("DUPLICATE_ASSIGNMENT", "DUPLICATE_ASSIGNMENT");
      } else if (value.overlap) {
        value.ineligible("OVERLAP_CONFLICT", "OVERLAP_CONFLICT");
      }
      if (value.eligibility != Eligibility.INELIGIBLE) {
        value.availability = value.pendingRequest ? "PENDING_REQUEST" : "AVAILABLE";
        value.reason(source.requirement.start == null
            ? "AVAILABLE_FOR_DAY" : "AVAILABLE_FOR_INTERVAL");
        if (value.pendingRequest) {
          value.warn("PENDING_REQUEST", Map.of("type",
              Objects.toString(value.pendingRequestType, "UNKNOWN")));
        }
        if (value.otherUnitAssignment) value.warn("OTHER_UNIT_ASSIGNMENT");
        if (value.totalHistoricalAssignments > 0 && value.matchingWorkTypeAssignments == 0) {
          value.warn("UNUSUAL_WORK_TYPE");
        }
      }
      if (value.matchingWorkTypeAssignments > 0) {
        value.reason("USUAL_WORK_TYPE", Map.of("occurrences",
            Integer.toString(value.matchingWorkTypeAssignments)));
      }
      if (!value.assignedThisDay) value.reason("NO_ASSIGNMENT_THIS_DAY");
    }
  }

  private Comparator<CandidateBuilder> candidateComparator() {
    return Comparator.comparingInt((CandidateBuilder value) -> value.matchingWorkTypeAssignments)
        .reversed().thenComparing(value -> value.assignedThisDay)
        .thenComparingInt(value -> value.weeklyMinutes)
        .thenComparing(value -> value.pendingRequest)
        .thenComparing(value -> normalizeName(value.displayName))
        .thenComparing(value -> value.id);
  }

  private static RequirementCoverage requireCoverage(CoverageResult value, UUID requirementId) {
    RequirementCoverage result = value.requirement(requirementId);
    if (result == null) throw new NotFoundException("Staffing requirement", requirementId);
    return result;
  }

  private static CoverageTotals totals(RequirementCoverage value) {
    return new CoverageTotals(value.required(), value.assigned(), value.effectiveAssigned(),
        value.covered(), value.missing(), value.overstaffed(), value.percentage(),
        value.missing());
  }

  private static boolean hasTimedInterval(LocalTime start, LocalTime end) {
    return start != null && end != null && end.isAfter(start);
  }

  /** A requirement may be day-based or have a known start with an open end. */
  private static boolean validRequirementInterval(LocalTime start, LocalTime end) {
    return end == null || hasTimedInterval(start, end);
  }

  private static boolean overlaps(LocalTime firstStart, LocalTime firstEnd,
      LocalTime secondStart, LocalTime secondEnd) {
    return firstStart.isBefore(secondEnd) && secondStart.isBefore(firstEnd);
  }

  private static String normalizeName(String value) {
    return Normalizer.normalize(Objects.toString(value, ""), Normalizer.Form.NFKD)
        .replaceAll("\\p{M}", "").toLowerCase(Locale.ROOT).trim();
  }

  private static MapSqlParameterSource params(Object... values) {
    MapSqlParameterSource result = new MapSqlParameterSource();
    for (int index = 0; index < values.length; index += 2) {
      result.addValue((String) values[index], values[index + 1]);
    }
    return result;
  }

  private enum Eligibility { ELIGIBLE, ELIGIBLE_WITH_WARNING, INELIGIBLE }

  private record PlanRow(UUID id, UUID organizationId, UUID unitId, LocalDate weekStart,
      long draftRevision) {}

  private record RequirementRow(UUID id, LocalDate date, UUID workTypeId, String workTypeCode,
      String workTypeName, boolean workTypeActive, LocalTime start, LocalTime end,
      int requiredWorkers) {}

  private record AuthorizedRequirement(PlanRow plan, RequirementRow requirement,
      PlanCapabilities capabilities) {}

  private static final class CandidateBuilder {
    final UUID id;
    final String displayName;
    final String status;
    final List<CandidateReasonResponse> reasons = new ArrayList<>();
    Eligibility eligibility = Eligibility.ELIGIBLE;
    String availability = "AVAILABLE";
    String dayStatus;
    boolean pendingRequest;
    String pendingRequestType;
    boolean assignedThisDay;
    boolean duplicate;
    boolean overlap;
    boolean otherUnitAssignment;
    int assignmentsOnDay;
    int weeklyMinutes;
    int totalHistoricalAssignments;
    int matchingWorkTypeAssignments;
    Integer rank;
    boolean recommended;

    CandidateBuilder(UUID id, String displayName, String status) {
      this.id = id;
      this.displayName = displayName;
      this.status = status;
    }

    void ineligible(String reason, String availability) {
      ineligible(reason, availability, Map.of());
    }

    void ineligible(String reason, String availability, Map<String, String> parameters) {
      eligibility = Eligibility.INELIGIBLE;
      this.availability = availability;
      reason(reason, parameters);
    }

    void warn(String reason) { warn(reason, Map.of()); }

    void warn(String reason, Map<String, String> parameters) {
      if (eligibility == Eligibility.ELIGIBLE) eligibility = Eligibility.ELIGIBLE_WITH_WARNING;
      reason(reason, parameters);
    }

    void reason(String code) { reason(code, Map.of()); }

    void reason(String code, Map<String, String> parameters) {
      if (reasons.stream().noneMatch(value -> value.code().equals(code))) {
        reasons.add(new CandidateReasonResponse(code,
            "staffing.candidate.reason." + code.toLowerCase(Locale.ROOT), Map.copyOf(parameters)));
      }
    }

    AssignmentCandidateResponse response() {
      reasons.sort(Comparator.comparing(CandidateReasonResponse::code));
      return new AssignmentCandidateResponse(id, displayName, status, recommended, rank,
          eligibility.name(), availability, assignedThisDay, weeklyMinutes,
          matchingWorkTypeAssignments == 0 ? null : matchingWorkTypeAssignments,
          new CandidateConflictResponse(duplicate, overlap, assignmentsOnDay),
          List.copyOf(reasons));
    }
  }
}
