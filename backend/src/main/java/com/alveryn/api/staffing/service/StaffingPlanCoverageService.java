package com.alveryn.api.staffing.service;

import com.alveryn.api.common.exception.NotFoundException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Canonical, read-only coverage and planning review for one weekly Business plan.
 *
 * <p>The calculation deliberately uses a bounded query set rather than entity traversal: one plan
 * query, one plan-source query and, when assignments exist, one query each for day entries,
 * pending requests and same-organization assignments used by overlap detection. It never writes,
 * localizes issue text or reads Personal data.
 */
@Service
@RequiredArgsConstructor
public class StaffingPlanCoverageService {
  private static final Set<String> BLOCKING_DAY_TYPES = Set.of("REST_DAY", "VACATION", "SICK");

  private final NamedParameterJdbcTemplate jdbc;

  @Transactional(readOnly = true)
  public CoverageResult calculate(UUID organizationId, UUID unitId, UUID planId) {
    Objects.requireNonNull(organizationId, "organizationId is required");
    Objects.requireNonNull(unitId, "unitId is required");
    Objects.requireNonNull(planId, "planId is required");

    PlanRow plan = findPlan(organizationId, unitId, planId);
    LinkedHashMap<UUID, RequirementBuilder> requirements = loadPlanSource(plan);
    Set<UUID> memberIds = requirements.values().stream()
        .flatMap(value -> value.assignments.values().stream())
        .map(value -> value.membershipId).collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new));
    Map<MemberDate, String> dayEntries = loadDayEntries(plan, memberIds);
    List<PendingRequestRow> pendingRequests = loadPendingRequests(plan, memberIds);
    List<ComparableAssignment> comparableAssignments = loadComparableAssignments(plan, memberIds);

    Evaluation evaluation = evaluate(plan, requirements, dayEntries, pendingRequests,
        comparableAssignments);
    return assemble(plan, requirements, evaluation);
  }

  /**
   * Read-only projection of one proposed assignment through the canonical coverage evaluator.
   *
   * <p>The proposed row exists only in memory. This keeps candidate recommendations and the
   * manager review on exactly the same coverage semantics without writing a temporary assignment
   * or maintaining a second counter in the recommendation feature.
   */
  @Transactional(readOnly = true)
  public CoverageProjection projectAssignment(UUID organizationId, UUID unitId, UUID planId,
      UUID requirementId, UUID membershipId) {
    Objects.requireNonNull(requirementId, "requirementId is required");
    Objects.requireNonNull(membershipId, "membershipId is required");
    PlanRow plan = findPlan(organizationId, unitId, planId);
    LinkedHashMap<UUID, RequirementBuilder> requirements = loadPlanSource(plan);
    RequirementBuilder requirement = requirements.get(requirementId);
    if (requirement == null) throw new NotFoundException("Staffing requirement", requirementId);

    CandidateMembershipRow member = loadCandidateMembership(plan, membershipId);
    Set<UUID> memberIds = requirements.values().stream()
        .flatMap(value -> value.assignments.values().stream())
        .map(value -> value.membershipId)
        .collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new));
    memberIds.add(membershipId);
    Map<MemberDate, String> dayEntries = loadDayEntries(plan, memberIds);
    List<PendingRequestRow> pendingRequests = loadPendingRequests(plan, memberIds);
    List<ComparableAssignment> comparableAssignments = new ArrayList<>(
        loadComparableAssignments(plan, memberIds));

    Evaluation beforeEvaluation = evaluate(plan, requirements, dayEntries, pendingRequests,
        comparableAssignments);
    CoverageResult before = assemble(plan, requirements, beforeEvaluation);
    boolean alreadyAssigned = requirement.assignments.values().stream()
        .anyMatch(value -> value.membershipId.equals(membershipId)
            && "ASSIGNED".equals(value.status));
    if (alreadyAssigned) return new CoverageProjection(before, before);

    UUID projectedId = UUID.nameUUIDFromBytes(
        ("staffing-projection:" + planId + ':' + requirementId + ':' + membershipId)
            .getBytes(StandardCharsets.UTF_8));
    AssignmentRow projected = new AssignmentRow(projectedId, requirement.id, membershipId,
        member.organizationId, member.status, null, null, requirement.start, requirement.end,
        "ASSIGNED");
    requirement.assignments.put(projectedId, projected);
    comparableAssignments.add(new ComparableAssignment(projectedId, membershipId,
        requirement.id, requirement.date, requirement.unitId, requirement.start, requirement.end));
    Evaluation afterEvaluation = evaluate(plan, requirements, dayEntries, pendingRequests,
        comparableAssignments);
    return new CoverageProjection(before, assemble(plan, requirements, afterEvaluation));
  }

  private CandidateMembershipRow loadCandidateMembership(PlanRow plan, UUID membershipId) {
    List<CandidateMembershipRow> rows = jdbc.query("""
        select id, organization_id, membership_status
        from organization_memberships
        where id=:membership and organization_id=:organization
        """, params("membership", membershipId, "organization", plan.organizationId),
        (rs, row) -> new CandidateMembershipRow(rs.getObject("id", UUID.class),
            rs.getObject("organization_id", UUID.class), rs.getString("membership_status")));
    return rows.stream().findFirst()
        .orElseThrow(() -> new NotFoundException("Organization member", membershipId));
  }

  private PlanRow findPlan(UUID organizationId, UUID unitId, UUID planId) {
    List<PlanRow> rows = jdbc.query("""
        select id, organization_id, unit_id, week_start, timezone, draft_revision
        from staffing_plans
        where id=:plan and organization_id=:organization and unit_id=:unit
        """, params("plan", planId, "organization", organizationId, "unit", unitId),
        (rs, row) -> new PlanRow(rs.getObject("id", UUID.class),
            rs.getObject("organization_id", UUID.class), rs.getObject("unit_id", UUID.class),
            rs.getObject("week_start", LocalDate.class), rs.getString("timezone"),
            rs.getLong("draft_revision")));
    return rows.stream().findFirst().orElseThrow(() -> new NotFoundException("Staffing plan", planId));
  }

  private LinkedHashMap<UUID, RequirementBuilder> loadPlanSource(PlanRow plan) {
    LinkedHashMap<UUID, RequirementBuilder> result = new LinkedHashMap<>();
    jdbc.query("""
        select r.id requirement_id, r.organization_id requirement_organization_id,
          r.unit_id requirement_unit_id, r.work_type_id, r.work_date, r.start_time requirement_start,
          r.end_time requirement_end, r.required_workers, d.id plan_day_id,
          d.organization_id day_organization_id, d.work_date day_date,
          u.name unit_name, wt.organization_id work_type_organization_id,
          wt.unit_id work_type_unit_id, wt.code work_type_code, wt.name work_type_name,
          wt.active work_type_active,
          a.id assignment_id, a.membership_id, a.start_time assignment_start,
          a.end_time assignment_end, a.assignment_status,
          m.organization_id membership_organization_id, m.membership_status
        from staffing_requirements r
        join staffing_plan_days d on d.id=r.plan_day_id
        join organization_units u on u.id=r.unit_id
        join organization_work_types wt on wt.id=r.work_type_id
        left join staffing_assignments a on a.requirement_id=r.id
        left join organization_memberships m on m.id=a.membership_id
        where d.plan_id=:plan
        order by r.work_date, r.start_time nulls first, r.id, a.created_at, a.id
        """, params("plan", plan.id), (org.springframework.jdbc.core.RowCallbackHandler) rs -> {
          try {
            UUID requirementId = rs.getObject("requirement_id", UUID.class);
            RequirementBuilder requirement = result.get(requirementId);
            if (requirement == null) {
              requirement = requirement(rs);
              result.put(requirementId, requirement);
            }
            UUID assignmentId = rs.getObject("assignment_id", UUID.class);
            if (assignmentId != null) {
              requirement.assignments.putIfAbsent(assignmentId, assignment(rs, requirement));
            }
          } catch (SQLException exception) {
            throw new IllegalStateException("Could not read staffing plan source", exception);
          }
        });
    return result;
  }

  private Map<MemberDate, String> loadDayEntries(PlanRow plan, Set<UUID> memberIds) {
    if (memberIds.isEmpty()) return Map.of();
    Map<MemberDate, String> result = new HashMap<>();
    jdbc.query("""
        select membership_id, work_date, entry_type
        from staffing_member_day_entries
        where organization_id=:organization and membership_id in (:members)
          and work_date between :from and :to
        order by work_date, membership_id
        """, params("organization", plan.organizationId, "members", memberIds,
        "from", plan.weekStart, "to", plan.weekStart.plusDays(6)),
        (org.springframework.jdbc.core.RowCallbackHandler) rs -> result.put(
            new MemberDate(rs.getObject("membership_id", UUID.class),
                rs.getObject("work_date", LocalDate.class)), rs.getString("entry_type")));
    return Map.copyOf(result);
  }

  private List<PendingRequestRow> loadPendingRequests(PlanRow plan, Set<UUID> memberIds) {
    if (memberIds.isEmpty()) return List.of();
    return jdbc.query("""
        select id, membership_id, absence_type, start_date, end_date
        from staffing_absence_requests
        where organization_id=:organization and membership_id in (:members)
          and request_status='PENDING' and end_date>=:from and start_date<=:to
        order by start_date, membership_id, id
        """, params("organization", plan.organizationId, "members", memberIds,
        "from", plan.weekStart, "to", plan.weekStart.plusDays(6)),
        (rs, row) -> new PendingRequestRow(rs.getObject("id", UUID.class),
            rs.getObject("membership_id", UUID.class), rs.getString("absence_type"),
            rs.getObject("start_date", LocalDate.class), rs.getObject("end_date", LocalDate.class)));
  }

  private List<ComparableAssignment> loadComparableAssignments(PlanRow plan, Set<UUID> memberIds) {
    if (memberIds.isEmpty()) return List.of();
    return jdbc.query("""
        select a.id, a.membership_id, r.id requirement_id, r.work_date, r.unit_id,
          coalesce(a.start_time,r.start_time) effective_start,
          coalesce(a.end_time,r.end_time) effective_end
        from staffing_assignments a
        join staffing_requirements r on r.id=a.requirement_id
        where a.assignment_status='ASSIGNED' and r.organization_id=:organization
          and a.membership_id in (:members) and r.work_date between :from and :to
        order by r.work_date, a.membership_id, effective_start nulls first, a.id
        """, params("organization", plan.organizationId, "members", memberIds,
        "from", plan.weekStart, "to", plan.weekStart.plusDays(6)),
        (rs, row) -> new ComparableAssignment(rs.getObject("id", UUID.class),
            rs.getObject("membership_id", UUID.class), rs.getObject("requirement_id", UUID.class),
            rs.getObject("work_date", LocalDate.class), rs.getObject("unit_id", UUID.class),
            rs.getObject("effective_start", LocalTime.class),
            rs.getObject("effective_end", LocalTime.class)));
  }

  private Evaluation evaluate(PlanRow plan, Map<UUID, RequirementBuilder> requirements,
      Map<MemberDate, String> dayEntries, List<PendingRequestRow> pendingRequests,
      List<ComparableAssignment> comparableAssignments) {
    Evaluation evaluation = new Evaluation();
    if (requirements.isEmpty()) {
      evaluation.add(issue(IssueCode.EMPTY_PLAN, IssueSeverity.BLOCKING_CONFLICT,
          plan.id, null, null, null, null));
      return evaluation;
    }

    for (RequirementBuilder requirement : requirements.values()) {
      validateRequirement(plan, requirement, evaluation);
      for (AssignmentRow assignment : requirement.assignments.values()) {
        if (!"ASSIGNED".equals(assignment.status)) continue;
        validateAssignment(plan, requirement, assignment, dayEntries, evaluation);
      }
    }
    detectOverlapAndDuplicates(plan, requirements, comparableAssignments, evaluation);
    addPendingRequests(plan, requirements, pendingRequests, evaluation);

    for (RequirementBuilder requirement : requirements.values()) {
      List<AssignmentRow> assigned = requirement.assignments.values().stream()
          .filter(value -> "ASSIGNED".equals(value.status)).toList();
      requirement.assignedIds.addAll(assigned.stream().map(value -> value.id).toList());
      requirement.effectiveIds.addAll(assigned.stream().map(value -> value.id)
          .filter(value -> !evaluation.ineffectiveAssignments.contains(value)).toList());
      int effective = requirement.effectiveIds.size();
      if (effective < requirement.required) {
        evaluation.add(issue(IssueCode.UNDERCOVERAGE, IssueSeverity.WARNING, plan.id,
            requirement.date, requirement.id, null, null,
            Map.of("required", Integer.toString(requirement.required),
                "effectiveAssigned", Integer.toString(effective))));
      } else if (effective > requirement.required) {
        evaluation.add(issue(IssueCode.OVERSTAFFING, IssueSeverity.WARNING, plan.id,
            requirement.date, requirement.id, null, null,
            Map.of("required", Integer.toString(requirement.required),
                "effectiveAssigned", Integer.toString(effective))));
      }
    }
    evaluation.issues.sort(Comparator.comparing(PlanningIssue::issueKey));
    return evaluation;
  }

  private void validateRequirement(PlanRow plan, RequirementBuilder value, Evaluation evaluation) {
    if (!plan.organizationId.equals(value.organizationId)
        || !plan.organizationId.equals(value.dayOrganizationId)
        || !plan.organizationId.equals(value.workTypeOrganizationId)) {
      evaluation.blockRequirement(value.id, issue(IssueCode.TENANT_MISMATCH,
          IssueSeverity.BLOCKING_CONFLICT, plan.id, value.date, value.id, null, null));
    }
    if (!plan.unitId.equals(value.unitId)
        || (value.workTypeUnitId != null && !plan.unitId.equals(value.workTypeUnitId))) {
      evaluation.blockRequirement(value.id, issue(IssueCode.UNIT_MISMATCH,
          IssueSeverity.BLOCKING_CONFLICT, plan.id, value.date, value.id, null, null));
    }
    if (!plan.includes(value.date) || !value.date.equals(value.dayDate)) {
      evaluation.blockRequirement(value.id, issue(IssueCode.OUTSIDE_PLAN_WEEK,
          IssueSeverity.BLOCKING_CONFLICT, plan.id, value.date, value.id, null, null));
    }
    if (!validInterval(value.start, value.end)) {
      evaluation.blockRequirement(value.id, issue(IssueCode.INVALID_INTERVAL,
          IssueSeverity.BLOCKING_CONFLICT, plan.id, value.date, value.id, null, null));
    }
    if (!value.workTypeActive) {
      evaluation.blockRequirement(value.id, issue(IssueCode.INACTIVE_WORK_TYPE,
          IssueSeverity.BLOCKING_CONFLICT, plan.id, value.date, value.id, null, null));
    }
  }

  private void validateAssignment(PlanRow plan, RequirementBuilder requirement, AssignmentRow value,
      Map<MemberDate, String> dayEntries, Evaluation evaluation) {
    if (evaluation.blockedRequirements.contains(requirement.id)) {
      evaluation.ineffectiveAssignments.add(value.id);
    }
    if (!plan.organizationId.equals(value.membershipOrganizationId)) {
      evaluation.blockAssignment(value.id, issue(IssueCode.TENANT_MISMATCH,
          IssueSeverity.BLOCKING_CONFLICT, plan.id, requirement.date, requirement.id,
          value.id, value.membershipId));
    }
    if (!validInterval(value.effectiveStart, value.effectiveEnd)) {
      evaluation.blockAssignment(value.id, issue(IssueCode.INVALID_INTERVAL,
          IssueSeverity.BLOCKING_CONFLICT, plan.id, requirement.date, requirement.id,
          value.id, value.membershipId));
    }
    if ("SUSPENDED".equals(value.membershipStatus)) {
      evaluation.ineffectiveAssignments.add(value.id);
      evaluation.add(issue(IssueCode.SUSPENDED_MEMBER, IssueSeverity.WARNING, plan.id,
          requirement.date, requirement.id, value.id, value.membershipId));
    } else if ("INVITED".equals(value.membershipStatus)) {
      evaluation.ineffectiveAssignments.add(value.id);
      evaluation.add(issue(IssueCode.INVITATION_PENDING, IssueSeverity.WARNING, plan.id,
          requirement.date, requirement.id, value.id, value.membershipId));
    } else if (!"ACTIVE".equals(value.membershipStatus)) {
      evaluation.ineffectiveAssignments.add(value.id);
      evaluation.add(issue(IssueCode.SUSPENDED_MEMBER, IssueSeverity.WARNING, plan.id,
          requirement.date, requirement.id, value.id, value.membershipId));
    }
    String dayType = dayEntries.get(new MemberDate(value.membershipId, requirement.date));
    if (dayType != null && BLOCKING_DAY_TYPES.contains(dayType)) {
      IssueCode code = switch (dayType) {
        case "REST_DAY" -> IssueCode.APPROVED_REST_DAY_CONFLICT;
        case "VACATION" -> IssueCode.APPROVED_VACATION_CONFLICT;
        default -> IssueCode.APPROVED_SICK_CONFLICT;
      };
      evaluation.blockAssignment(value.id, issue(code, IssueSeverity.BLOCKING_CONFLICT,
          plan.id, requirement.date, requirement.id, value.id, value.membershipId));
    }
    if ((value.start != null && !Objects.equals(value.start, requirement.start))
        || (value.end != null && !Objects.equals(value.end, requirement.end))) {
      evaluation.add(issue(IssueCode.INTERVAL_OVERRIDE, IssueSeverity.WARNING, plan.id,
          requirement.date, requirement.id, value.id, value.membershipId));
    }
  }

  private void detectOverlapAndDuplicates(PlanRow plan,
      Map<UUID, RequirementBuilder> requirements, List<ComparableAssignment> comparable,
      Evaluation evaluation) {
    Map<UUID, AssignmentRow> current = new HashMap<>();
    requirements.values().forEach(requirement -> requirement.assignments.values().stream()
        .filter(value -> "ASSIGNED".equals(value.status)).forEach(value -> current.put(value.id, value)));
    Map<MemberDate, List<ComparableAssignment>> groups = new HashMap<>();
    comparable.forEach(value -> groups.computeIfAbsent(new MemberDate(value.membershipId, value.date),
        ignored -> new ArrayList<>()).add(value));
    for (List<ComparableAssignment> group : groups.values()) {
      group.sort(Comparator.comparing(value -> value.id));
      for (int i = 0; i < group.size(); i++) {
        for (int j = i + 1; j < group.size(); j++) {
          ComparableAssignment first = group.get(i);
          ComparableAssignment second = group.get(j);
          if (!hasTimedInterval(first.start, first.end)
              || !hasTimedInterval(second.start, second.end)
              || !overlaps(first.start, first.end, second.start, second.end)) continue;
          boolean duplicate = first.start.equals(second.start) && first.end.equals(second.end);
          IssueCode code = duplicate ? IssueCode.DUPLICATE_ASSIGNMENT
              : IssueCode.INCOMPATIBLE_OVERLAP;
          Set<UUID> affected = new LinkedHashSet<>();
          if (current.containsKey(first.id)) affected.add(first.id);
          if (current.containsKey(second.id)) affected.add(second.id);
          if (affected.isEmpty()) continue;
          UUID primary = affected.iterator().next();
          AssignmentRow assignment = current.get(primary);
          RequirementBuilder requirement = requirements.get(assignment.requirementId);
          String pair = orderedPair(first.id, second.id);
          boolean external = !current.containsKey(first.id) || !current.containsKey(second.id);
          String issueKey = external
              ? code.name() + ":" + primary + ":EXTERNAL:" + shortHash(pair)
              : code.name() + ":" + pair;
          Map<String, String> parameters = external
              ? Map.of("externalConflict", "true")
              : Map.of("assignmentPair", pair);
          PlanningIssue issue = issue(code, IssueSeverity.WARNING, plan.id,
              requirement.date, requirement.id, primary, assignment.membershipId, parameters);
          evaluation.addWithKey(issueKey, issue, affected.stream()
              .map(value -> current.get(value).requirementId).collect(java.util.stream.Collectors.toSet()));
          affected.forEach(evaluation.ineffectiveAssignments::add);
        }
      }
    }
  }

  private void addPendingRequests(PlanRow plan, Map<UUID, RequirementBuilder> requirements,
      List<PendingRequestRow> requests, Evaluation evaluation) {
    if (requests.isEmpty()) return;
    for (RequirementBuilder requirement : requirements.values()) {
      for (AssignmentRow assignment : requirement.assignments.values()) {
        if (!"ASSIGNED".equals(assignment.status)) continue;
        requests.stream().filter(request -> request.membershipId.equals(assignment.membershipId)
            && !requirement.date.isBefore(request.start) && !requirement.date.isAfter(request.end))
            .forEach(request -> evaluation.addWithKey(
                IssueCode.PENDING_REQUEST.name() + ":" + request.id + ":" + assignment.id,
                issue(IssueCode.PENDING_REQUEST, IssueSeverity.PENDING_REQUEST, plan.id,
                    requirement.date, requirement.id, assignment.id, assignment.membershipId,
                    Map.of("absenceType", request.type)), Set.of(requirement.id)));
      }
    }
  }

  private CoverageResult assemble(PlanRow plan, Map<UUID, RequirementBuilder> requirements,
      Evaluation evaluation) {
    List<RequirementCoverage> requirementResults = new ArrayList<>();
    for (RequirementBuilder value : requirements.values()) {
      int assigned = value.assignedIds.size();
      int effective = value.effectiveIds.size();
      int covered = Math.min(effective, value.required);
      int missing = Math.max(value.required - effective, 0);
      int overstaffed = Math.max(effective - value.required, 0);
      requirementResults.add(new RequirementCoverage(value.id, value.planDayId, value.date,
          value.unitId, value.unitName, value.workTypeId, value.workTypeCode, value.workTypeName,
          value.start, value.end, value.required, assigned, effective, covered, missing, overstaffed,
          percentage(covered, value.required), List.copyOf(value.assignedIds),
          List.copyOf(value.effectiveIds), evaluation.issueKeysForRequirement(value.id)));
    }
    requirementResults.sort(Comparator.comparing(RequirementCoverage::date)
        .thenComparing(value -> value.startTime() == null ? LocalTime.MIN : value.startTime())
        .thenComparing(RequirementCoverage::requirementId));

    TreeMap<LocalDate, List<RequirementCoverage>> grouped = new TreeMap<>();
    for (int day = 0; day < 7; day++) {
      grouped.put(plan.weekStart.plusDays(day), new ArrayList<>());
    }
    requirementResults.forEach(value -> grouped.computeIfAbsent(value.date(), ignored -> new ArrayList<>())
        .add(value));
    List<DayCoverage> days = grouped.entrySet().stream().map(entry -> {
      Counts counts = counts(entry.getValue());
      Set<String> issueKeys = new LinkedHashSet<>();
      entry.getValue().forEach(value -> issueKeys.addAll(value.issueKeys()));
      evaluation.issues.stream().filter(value -> entry.getKey().equals(value.date()))
          .map(PlanningIssue::issueKey).forEach(issueKeys::add);
      return new DayCoverage(entry.getKey(), counts.required, counts.assigned,
          counts.effectiveAssigned, counts.covered, counts.missing, counts.overstaffed,
          percentage(counts.covered, counts.required), counts.missing, List.copyOf(issueKeys));
    }).toList();
    Counts planCounts = counts(requirementResults);
    int blocking = (int) evaluation.issues.stream().filter(PlanningIssue::publishBlocking).count();
    int warnings = (int) evaluation.issues.stream()
        .filter(value -> policyFor(value.severity()).countInWarningCount).count();
    int information = (int) evaluation.issues.stream()
        .filter(value -> value.severity() == IssueSeverity.INFORMATION).count();
    return new CoverageResult(plan.id, plan.organizationId, plan.unitId, plan.weekStart,
        plan.draftRevision, planCounts.required, planCounts.assigned,
        planCounts.effectiveAssigned, planCounts.covered, planCounts.missing,
        planCounts.overstaffed, percentage(planCounts.covered, planCounts.required),
        planCounts.missing, List.copyOf(requirementResults), List.copyOf(days),
        List.copyOf(evaluation.issues), blocking, warnings, information, blocking == 0);
  }

  private static Counts counts(Collection<RequirementCoverage> values) {
    int required = 0;
    int assigned = 0;
    int effective = 0;
    int covered = 0;
    int missing = 0;
    int overstaffed = 0;
    for (RequirementCoverage value : values) {
      required += value.required();
      assigned += value.assigned();
      effective += value.effectiveAssigned();
      covered += value.covered();
      missing += value.missing();
      overstaffed += value.overstaffed();
    }
    return new Counts(required, assigned, effective, covered, missing, overstaffed);
  }

  private static BigDecimal percentage(int covered, int required) {
    if (required == 0) return BigDecimal.ZERO.setScale(2);
    return BigDecimal.valueOf(covered).multiply(BigDecimal.valueOf(100))
        .divide(BigDecimal.valueOf(required), 2, RoundingMode.HALF_UP);
  }

  private static boolean validInterval(LocalTime start, LocalTime end) {
    return end == null || hasTimedInterval(start, end);
  }

  private static boolean hasTimedInterval(LocalTime start, LocalTime end) {
    return start != null && end != null && end.isAfter(start);
  }

  private static boolean overlaps(LocalTime firstStart, LocalTime firstEnd,
      LocalTime secondStart, LocalTime secondEnd) {
    return firstStart.isBefore(secondEnd) && secondStart.isBefore(firstEnd);
  }

  private static String orderedPair(UUID first, UUID second) {
    return first.compareTo(second) <= 0 ? first + ":" + second : second + ":" + first;
  }

  private static String shortHash(String value) {
    try {
      byte[] digest = MessageDigest.getInstance("SHA-256")
          .digest(value.getBytes(StandardCharsets.UTF_8));
      return java.util.HexFormat.of().formatHex(digest, 0, 8);
    } catch (NoSuchAlgorithmException impossible) {
      throw new IllegalStateException(impossible);
    }
  }

  private static RequirementBuilder requirement(ResultSet rs) throws SQLException {
    return new RequirementBuilder(rs.getObject("requirement_id", UUID.class),
        rs.getObject("plan_day_id", UUID.class), rs.getObject("requirement_organization_id", UUID.class),
        rs.getObject("day_organization_id", UUID.class), rs.getObject("requirement_unit_id", UUID.class),
        rs.getString("unit_name"), rs.getObject("work_type_id", UUID.class),
        rs.getObject("work_type_organization_id", UUID.class),
        rs.getObject("work_type_unit_id", UUID.class), rs.getString("work_type_code"),
        rs.getString("work_type_name"), rs.getBoolean("work_type_active"),
        rs.getObject("work_date", LocalDate.class), rs.getObject("day_date", LocalDate.class),
        rs.getObject("requirement_start", LocalTime.class),
        rs.getObject("requirement_end", LocalTime.class), rs.getInt("required_workers"));
  }

  private static AssignmentRow assignment(ResultSet rs, RequirementBuilder requirement)
      throws SQLException {
    LocalTime start = rs.getObject("assignment_start", LocalTime.class);
    LocalTime end = rs.getObject("assignment_end", LocalTime.class);
    return new AssignmentRow(rs.getObject("assignment_id", UUID.class), requirement.id,
        rs.getObject("membership_id", UUID.class),
        rs.getObject("membership_organization_id", UUID.class), rs.getString("membership_status"),
        start, end, start == null ? requirement.start : start,
        end == null ? requirement.end : end, rs.getString("assignment_status"));
  }

  private static PlanningIssue issue(IssueCode code, IssueSeverity severity, UUID planId,
      LocalDate date, UUID requirementId, UUID assignmentId, UUID membershipId) {
    return issue(code, severity, planId, date, requirementId, assignmentId, membershipId, Map.of());
  }

  private static PlanningIssue issue(IssueCode code, IssueSeverity severity, UUID planId,
      LocalDate date, UUID requirementId, UUID assignmentId, UUID membershipId,
      Map<String, String> parameters) {
    UUID resource = assignmentId != null ? assignmentId : requirementId != null ? requirementId : planId;
    IssuePolicy policy = policyFor(severity);
    return new PlanningIssue(code.name() + ":" + resource, code, severity, planId, date,
        requirementId, assignmentId, membershipId, "staffing.issue." + code.name().toLowerCase(),
        Map.copyOf(parameters), policy.acknowledgementRequired, policy.publishBlocking);
  }

  public static IssuePolicy policyFor(IssueSeverity severity) {
    return switch (severity) {
      case BLOCKING_CONFLICT -> new IssuePolicy(false, true, false);
      case WARNING -> new IssuePolicy(true, false, true);
      case INFORMATION -> new IssuePolicy(false, false, false);
      case PENDING_REQUEST -> new IssuePolicy(true, false, true);
      case UNCONFIRMED_CHANGE -> new IssuePolicy(true, false, true);
    };
  }

  private static MapSqlParameterSource params(Object... values) {
    MapSqlParameterSource result = new MapSqlParameterSource();
    for (int index = 0; index < values.length; index += 2) {
      result.addValue((String) values[index], values[index + 1]);
    }
    return result;
  }

  private record PlanRow(UUID id, UUID organizationId, UUID unitId, LocalDate weekStart,
      String timezone, long draftRevision) {
    boolean includes(LocalDate value) {
      return value != null && !value.isBefore(weekStart) && !value.isAfter(weekStart.plusDays(6));
    }
  }

  private static final class RequirementBuilder {
    final UUID id;
    final UUID planDayId;
    final UUID organizationId;
    final UUID dayOrganizationId;
    final UUID unitId;
    final String unitName;
    final UUID workTypeId;
    final UUID workTypeOrganizationId;
    final UUID workTypeUnitId;
    final String workTypeCode;
    final String workTypeName;
    final boolean workTypeActive;
    final LocalDate date;
    final LocalDate dayDate;
    final LocalTime start;
    final LocalTime end;
    final int required;
    final LinkedHashMap<UUID, AssignmentRow> assignments = new LinkedHashMap<>();
    final LinkedHashSet<UUID> assignedIds = new LinkedHashSet<>();
    final LinkedHashSet<UUID> effectiveIds = new LinkedHashSet<>();

    RequirementBuilder(UUID id, UUID planDayId, UUID organizationId, UUID dayOrganizationId,
        UUID unitId, String unitName, UUID workTypeId, UUID workTypeOrganizationId,
        UUID workTypeUnitId, String workTypeCode, String workTypeName, boolean workTypeActive,
        LocalDate date, LocalDate dayDate, LocalTime start, LocalTime end, int required) {
      this.id = id;
      this.planDayId = planDayId;
      this.organizationId = organizationId;
      this.dayOrganizationId = dayOrganizationId;
      this.unitId = unitId;
      this.unitName = unitName;
      this.workTypeId = workTypeId;
      this.workTypeOrganizationId = workTypeOrganizationId;
      this.workTypeUnitId = workTypeUnitId;
      this.workTypeCode = workTypeCode;
      this.workTypeName = workTypeName;
      this.workTypeActive = workTypeActive;
      this.date = date;
      this.dayDate = dayDate;
      this.start = start;
      this.end = end;
      this.required = required;
    }
  }

  private record AssignmentRow(UUID id, UUID requirementId, UUID membershipId,
      UUID membershipOrganizationId, String membershipStatus, LocalTime start, LocalTime end,
      LocalTime effectiveStart, LocalTime effectiveEnd, String status) {}

  private record ComparableAssignment(UUID id, UUID membershipId, UUID requirementId,
      LocalDate date, UUID unitId, LocalTime start, LocalTime end) {}

  private record PendingRequestRow(UUID id, UUID membershipId, String type, LocalDate start,
      LocalDate end) {}

  private record CandidateMembershipRow(UUID id, UUID organizationId, String status) {}

  private record MemberDate(UUID membershipId, LocalDate date) {}

  private record Counts(int required, int assigned, int effectiveAssigned, int covered,
      int missing, int overstaffed) {}

  private static final class Evaluation {
    final List<PlanningIssue> issues = new ArrayList<>();
    final Set<String> issueKeys = new LinkedHashSet<>();
    final Map<String, Set<UUID>> issueRequirementIds = new HashMap<>();
    final Set<UUID> blockedRequirements = new LinkedHashSet<>();
    final Set<UUID> ineffectiveAssignments = new LinkedHashSet<>();

    void add(PlanningIssue issue) {
      addWithKey(issue.issueKey, issue,
          issue.requirementId == null ? Set.of() : Set.of(issue.requirementId));
    }

    void addWithKey(String key, PlanningIssue value, Set<UUID> requirements) {
      if (!issueKeys.add(key)) return;
      PlanningIssue issue = key.equals(value.issueKey) ? value
          : new PlanningIssue(key, value.code, value.severity, value.planId, value.date,
              value.requirementId, value.assignmentId, value.membershipId, value.messageKey,
              value.parameters, value.acknowledgementRequired, value.publishBlocking);
      issues.add(issue);
      issueRequirementIds.put(key, Set.copyOf(requirements));
    }

    void blockRequirement(UUID requirementId, PlanningIssue issue) {
      blockedRequirements.add(requirementId);
      add(issue);
    }

    void blockAssignment(UUID assignmentId, PlanningIssue issue) {
      ineffectiveAssignments.add(assignmentId);
      add(issue);
    }

    List<String> issueKeysForRequirement(UUID requirementId) {
      return issues.stream().filter(value -> issueRequirementIds
          .getOrDefault(value.issueKey, Set.of()).contains(requirementId))
          .map(PlanningIssue::issueKey).toList();
    }
  }

  public enum IssueSeverity {
    BLOCKING_CONFLICT,
    WARNING,
    INFORMATION,
    PENDING_REQUEST,
    UNCONFIRMED_CHANGE
  }

  public enum IssueCode {
    EMPTY_PLAN,
    TENANT_MISMATCH,
    UNIT_MISMATCH,
    OUTSIDE_PLAN_WEEK,
    INVALID_INTERVAL,
    INACTIVE_WORK_TYPE,
    SUSPENDED_MEMBER,
    ASSIGNMENT_REQUIREMENT_MISMATCH,
    DUPLICATE_ASSIGNMENT,
    INCOMPATIBLE_OVERLAP,
    APPROVED_VACATION_CONFLICT,
    APPROVED_SICK_CONFLICT,
    APPROVED_REST_DAY_CONFLICT,
    APPROVED_UNAVAILABLE_CONFLICT,
    UNDERCOVERAGE,
    OVERSTAFFING,
    INVITATION_PENDING,
    INTERVAL_OVERRIDE,
    PENDING_REQUEST,
    UNCONFIRMED_CHANGE
  }

  public record IssuePolicy(boolean acknowledgementRequired, boolean publishBlocking,
      boolean countInWarningCount) {}

  public record PlanningIssue(String issueKey, IssueCode code, IssueSeverity severity, UUID planId,
      LocalDate date, UUID requirementId, UUID assignmentId, UUID membershipId, String messageKey,
      Map<String, String> parameters, boolean acknowledgementRequired, boolean publishBlocking) {}

  public record RequirementCoverage(UUID requirementId, UUID planDayId, LocalDate date,
      UUID unitId, String unitName, UUID workTypeId, String workTypeCode, String workTypeName,
      LocalTime startTime, LocalTime endTime, int required, int assigned, int effectiveAssigned,
      int covered, int missing, int overstaffed, BigDecimal percentage, List<UUID> assignmentIds,
      List<UUID> effectiveAssignmentIds, List<String> issueKeys) {}

  public record DayCoverage(LocalDate date, int required, int assigned, int effectiveAssigned,
      int covered, int missing, int overstaffed, BigDecimal percentage, int openPositions,
      List<String> issueKeys) {}

  public record CoverageResult(UUID planId, UUID organizationId, UUID unitId, LocalDate weekStart,
      long draftRevision, int required, int assigned, int effectiveAssigned, int covered,
      int missing, int overstaffed, BigDecimal percentage, int openPositions,
      List<RequirementCoverage> requirementCoverage, List<DayCoverage> dayCoverage,
      List<PlanningIssue> issues, int blockingIssueCount, int warningCount,
      int informationCount, boolean publishable) {
    public RequirementCoverage requirement(UUID requirementId) {
      return requirementCoverage.stream().filter(value -> value.requirementId.equals(requirementId))
          .findFirst().orElse(null);
    }
  }

  public record CoverageProjection(CoverageResult before, CoverageResult after) {}
}
