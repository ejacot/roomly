package com.alveryn.api.staffing.service;

import static com.alveryn.api.staffing.dto.StaffingPlanQueryDtos.*;

import com.alveryn.api.common.exception.NotFoundException;
import com.alveryn.api.organization.entity.OrganizationPermission;
import com.alveryn.api.organization.entity.OrganizationUnit;
import com.alveryn.api.organization.repository.OrganizationUnitRepository;
import com.alveryn.api.organization.service.OrganizationAccessService;
import com.alveryn.api.staffing.service.StaffingPlanCoverageService.CoverageResult;
import com.alveryn.api.staffing.service.StaffingPlanCoverageService.PlanningIssue;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import java.util.function.Predicate;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Read-only aggregate-native manager queries. This service never creates plan rows and never reads
 * Personal data. Draft reads are assembled from the weekly aggregate; version reads use immutable
 * snapshot tables only.
 */
@Service
@RequiredArgsConstructor
public class StaffingPlanQueryService {
  private static final String DRAFT_CACHE_ETAG_PREFIX = "plan-";
  private static final int DEFAULT_VERSION_PAGE_SIZE = 20;
  private static final int MAX_VERSION_PAGE_SIZE = 100;

  private final NamedParameterJdbcTemplate jdbc;
  private final OrganizationUnitRepository units;
  private final OrganizationAccessService access;
  private final StaffingPlanCoverageService coverageService;

  @Transactional(readOnly = true)
  public QueryResult<PlanLookupResponse> find(UUID organizationId, UUID unitId,
      LocalDate weekStart, String ifNoneMatch) {
    requireMonday(weekStart);
    UnitAuthorization authorization = authorizeUnit(organizationId, unitId);
    List<PlanRow> plans = jdbc.query(PLAN_HEADER_SQL
            + " and plan.unit_id=:unit and plan.week_start=:weekStart",
        params("organization", organizationId, "unit", unitId, "weekStart", weekStart),
        (rs, row) -> planRow(rs));
    if (plans.isEmpty()) {
      return new QueryResult<>(new PlanLookupResponse(false, null), null, false, false);
    }
    QueryResult<PlanLookupResponse> conditional = conditionalDraft(plans.getFirst(), ifNoneMatch);
    if (conditional != null) return conditional;
    PlanHeaderResponse header = header(plans.getFirst(), authorization);
    return draft(new PlanLookupResponse(true, header), plans.getFirst());
  }

  @Transactional(readOnly = true)
  public QueryResult<PlanHeaderResponse> header(UUID organizationId, UUID planId,
      String ifNoneMatch) {
    AuthorizedPlan authorized = authorizePlan(organizationId, planId);
    QueryResult<PlanHeaderResponse> conditional = conditionalDraft(authorized.plan, ifNoneMatch);
    if (conditional != null) return conditional;
    return draft(header(authorized.plan, authorized.authorization), authorized.plan);
  }

  @Transactional(readOnly = true)
  public QueryResult<DemandResponse> demand(UUID organizationId, UUID planId,
      String ifNoneMatch) {
    AuthorizedPlan authorized = authorizePlan(organizationId, planId);
    QueryResult<DemandResponse> conditional = conditionalDraft(authorized.plan, ifNoneMatch);
    if (conditional != null) return conditional;
    CoverageResult coverage = coverageService.calculate(organizationId, authorized.plan.unitId,
        planId);
    DemandSource source = loadDemandSource(authorized.plan, coverage);
    DemandResponse response = new DemandResponse(planId, organizationId, authorized.plan.unitId,
        authorized.plan.weekStart, authorized.plan.weekStart.plusDays(6),
        authorized.plan.draftRevision, draftEtag(authorized.plan), totals(coverage), source.days);
    return draft(response, authorized.plan);
  }

  @Transactional(readOnly = true)
  public QueryResult<ScheduleResponse> schedule(UUID organizationId, UUID planId,
      String ifNoneMatch) {
    AuthorizedPlan authorized = authorizePlan(organizationId, planId);
    QueryResult<ScheduleResponse> conditional = conditionalDraft(authorized.plan, ifNoneMatch);
    if (conditional != null) return conditional;
    CoverageResult coverage = coverageService.calculate(organizationId, authorized.plan.unitId,
        planId);
    DemandSource demand = loadDemandSource(authorized.plan, coverage);
    ScheduleAssembly schedule = loadSchedule(authorized.plan, coverage, demand);
    ScheduleResponse response = new ScheduleResponse(planId, organizationId,
        authorized.plan.unitId, authorized.plan.weekStart, authorized.plan.weekStart.plusDays(6),
        authorized.plan.draftRevision, draftEtag(authorized.plan), totals(coverage), schedule.days,
        schedule.members, coverage.issues().stream().map(this::issue).toList());
    return draft(response, authorized.plan);
  }

  @Transactional(readOnly = true)
  public QueryResult<CoverageResponse> coverage(UUID organizationId, UUID planId,
      String ifNoneMatch) {
    AuthorizedPlan authorized = authorizePlan(organizationId, planId);
    QueryResult<CoverageResponse> conditional = conditionalDraft(authorized.plan, ifNoneMatch);
    if (conditional != null) return conditional;
    CoverageResult coverage = coverageService.calculate(organizationId, authorized.plan.unitId,
        planId);
    CoverageResponse response = new CoverageResponse(planId, organizationId,
        authorized.plan.unitId, authorized.plan.weekStart, authorized.plan.draftRevision,
        draftEtag(authorized.plan), totals(coverage), coverage.requirementCoverage().stream()
            .map(value -> new RequirementCoverageResponse(value.requirementId(), value.planDayId(),
                value.date(), value.workTypeId(), value.workTypeCode(), value.workTypeName(),
                value.startTime(), value.endTime(), totals(value.required(), value.assigned(),
                    value.effectiveAssigned(), value.covered(), value.missing(),
                    value.overstaffed(), value.percentage()), value.assignmentIds(),
                value.effectiveAssignmentIds(), value.issueKeys()))
            .toList(), coverage.dayCoverage().stream()
            .map(value -> new DayCoverageResponse(value.date(), totals(value.required(),
                value.assigned(), value.effectiveAssigned(), value.covered(), value.missing(),
                value.overstaffed(), value.percentage()), value.issueKeys()))
            .toList(), coverage.issues().stream().map(this::issue).toList(),
        coverage.blockingIssueCount(), coverage.warningCount(), coverage.informationCount(),
        coverage.publishable());
    return draft(response, authorized.plan);
  }

  @Transactional(readOnly = true)
  public QueryResult<ReviewResponse> review(UUID organizationId, UUID planId,
      String ifNoneMatch) {
    AuthorizedPlan authorized = authorizePlan(organizationId, planId);
    QueryResult<ReviewResponse> conditional = conditionalDraft(authorized.plan, ifNoneMatch);
    if (conditional != null) return conditional;
    CoverageResult coverage = coverageService.calculate(organizationId, authorized.plan.unitId,
        planId);
    Map<StaffingPlanCoverageService.IssueSeverity, List<IssueResponse>> grouped =
        new EnumMap<>(StaffingPlanCoverageService.IssueSeverity.class);
    coverage.issues().forEach(value -> grouped.computeIfAbsent(value.severity(), ignored ->
        new ArrayList<>()).add(issue(value)));
    List<IssueGroupResponse> groups = grouped.entrySet().stream()
        .sorted(Map.Entry.comparingByKey())
        .map(entry -> new IssueGroupResponse(entry.getKey().name(), entry.getValue().size(),
            List.copyOf(entry.getValue())))
        .toList();
    List<String> acknowledgements = coverage.issues().stream()
        .filter(PlanningIssue::acknowledgementRequired).map(PlanningIssue::issueKey).sorted().toList();
    ReviewResponse response = new ReviewResponse(planId, organizationId, authorized.plan.unitId,
        authorized.plan.weekStart, authorized.plan.draftRevision, draftEtag(authorized.plan),
        totals(coverage), groups, coverage.blockingIssueCount(), coverage.warningCount(),
        coverage.informationCount(), coverage.publishable(), acknowledgements);
    return draft(response, authorized.plan);
  }

  @Transactional(readOnly = true)
  public QueryResult<VersionsResponse> versions(UUID organizationId, UUID planId,
      Integer requestedLimit, Integer beforeVersion, String ifNoneMatch) {
    AuthorizedPlan authorized = authorizePlan(organizationId, planId);
    int limit = requestedLimit == null ? DEFAULT_VERSION_PAGE_SIZE : requestedLimit;
    if (limit < 1 || limit > MAX_VERSION_PAGE_SIZE) {
      throw new IllegalArgumentException("limit must be between 1 and " + MAX_VERSION_PAGE_SIZE);
    }
    if (beforeVersion != null && beforeVersion < 1) {
      throw new IllegalArgumentException("beforeVersion must be positive");
    }
    MapSqlParameterSource pageScope = scope(authorized.plan)
        .addValue("limit", limit + 1)
        .addValue("beforeVersion", beforeVersion);
    String beforeClause = beforeVersion == null ? "" : " and version_number < :beforeVersion\n";
    List<VersionListItem> versions = jdbc.query("""
        select id, version_number, source_draft_revision, coverage_required,
          coverage_raw_assigned, coverage_effective_assigned, coverage_covered,
          coverage_missing, coverage_overstaffed, coverage_percentage, coverage_basis,
          warning_count, checksum, publication_kind, source_draft_complete,
          published_by_display_name, published_at
        from staffing_plan_versions
        where organization_id=:organization and unit_id=:unit and plan_id=:plan
        """ + beforeClause + """
        order by version_number desc
        limit :limit
        """, pageScope, (rs, row) -> new VersionListItem(
        rs.getObject("id", UUID.class), rs.getInt("version_number"),
        rs.getLong("source_draft_revision"), integer(rs, "coverage_required"),
        integer(rs, "coverage_raw_assigned"), integer(rs, "coverage_effective_assigned"),
        integer(rs, "coverage_covered"), integer(rs, "coverage_missing"),
        integer(rs, "coverage_overstaffed"), rs.getBigDecimal("coverage_percentage"),
        rs.getString("coverage_basis"), rs.getInt("warning_count"), rs.getString("checksum"),
        rs.getString("publication_kind"), rs.getBoolean("source_draft_complete"),
        rs.getString("published_by_display_name"), rs.getObject("published_at", OffsetDateTime.class),
        Objects.equals(rs.getObject("id", UUID.class), authorized.plan.latestVersionId)));
    boolean hasMore = versions.size() > limit;
    List<VersionListItem> page = hasMore ? List.copyOf(versions.subList(0, limit))
        : List.copyOf(versions);
    Integer nextBeforeVersion = hasMore && !page.isEmpty()
        ? page.getLast().versionNumber() : null;
    String etag = versionsEtag(planId, limit, beforeVersion, hasMore, page);
    if (matches(ifNoneMatch, etag)) return notModified(etag, false);
    return new QueryResult<>(new VersionsResponse(planId, organizationId,
        authorized.plan.unitId, limit, nextBeforeVersion, hasMore, page), etag, false, false);
  }

  @Transactional(readOnly = true)
  public QueryResult<VersionDetailResponse> version(UUID organizationId, UUID planId,
      int versionNumber, String ifNoneMatch) {
    AuthorizedPlan authorized = authorizePlan(organizationId, planId);
    List<VersionRow> headers = jdbc.query("""
        select id, version_number, source_draft_revision, coverage_required,
          coverage_raw_assigned, coverage_effective_assigned, coverage_covered,
          coverage_missing, coverage_overstaffed, coverage_percentage, coverage_basis,
          warning_count, checksum, checksum_format_version, publication_kind,
          source_draft_complete, publication_note,
          published_by_display_name, published_at, timezone, week_start
        from staffing_plan_versions
        where organization_id=:organization and unit_id=:unit and plan_id=:plan
          and version_number=:version
        """, scope(authorized.plan).addValue("version", versionNumber),
        (rs, row) -> versionRow(rs));
    VersionRow version = headers.stream().findFirst()
        .orElseThrow(() -> new NotFoundException("Staffing plan version", versionNumber));
    String etag = versionEtag(version);
    if (matches(ifNoneMatch, etag)) return notModified(etag, true);
    MapSqlParameterSource versionParam = params("version", version.id);
    List<VersionDayResponse> days = jdbc.query("""
        select source_plan_day_id, work_date, rooms_context, source
        from staffing_plan_version_days where version_id=:version order by work_date
        """, versionParam, (rs, row) -> new VersionDayResponse(
        rs.getObject("source_plan_day_id", UUID.class), rs.getObject("work_date", LocalDate.class),
        integer(rs, "rooms_context"), rs.getString("source")));
    List<VersionRequirementResponse> requirements = jdbc.query("""
        select source_requirement_id, source_plan_day_id, work_date, unit_id, unit_name,
          work_type_id, work_type_code, work_type_name, start_time, end_time, break_minutes,
          required_workers, required_quantity, legacy_publication_status
        from staffing_plan_version_requirements where version_id=:version
        order by work_date, start_time nulls first, work_type_code, source_requirement_id
        """, versionParam, (rs, row) -> new VersionRequirementResponse(
        rs.getObject("source_requirement_id", UUID.class),
        rs.getObject("source_plan_day_id", UUID.class), rs.getObject("work_date", LocalDate.class),
        rs.getObject("unit_id", UUID.class), rs.getString("unit_name"),
        rs.getObject("work_type_id", UUID.class), rs.getString("work_type_code"),
        rs.getString("work_type_name"), rs.getObject("start_time", LocalTime.class),
        rs.getObject("end_time", LocalTime.class), rs.getInt("break_minutes"),
        rs.getInt("required_workers"), rs.getBigDecimal("required_quantity"),
        rs.getString("legacy_publication_status")));
    List<VersionAssignmentResponse> assignments = jdbc.query("""
        select source_assignment_id, source_requirement_id, organization_membership_id,
          member_display_name, membership_status_snapshot, work_date, unit_id, unit_name,
          work_type_id, work_type_code, work_type_name, start_time, end_time,
          assignment_status, check_in_mode, checked_in_at, checked_out_at
        from staffing_plan_version_assignments where version_id=:version
        order by work_date, work_type_code, member_display_name, source_assignment_id
        """, versionParam, (rs, row) -> new VersionAssignmentResponse(
        rs.getObject("source_assignment_id", UUID.class),
        rs.getObject("source_requirement_id", UUID.class),
        rs.getObject("organization_membership_id", UUID.class), rs.getString("member_display_name"),
        rs.getString("membership_status_snapshot"), rs.getObject("work_date", LocalDate.class),
        rs.getObject("unit_id", UUID.class), rs.getString("unit_name"),
        rs.getObject("work_type_id", UUID.class), rs.getString("work_type_code"),
        rs.getString("work_type_name"), rs.getObject("start_time", LocalTime.class),
        rs.getObject("end_time", LocalTime.class), rs.getString("assignment_status"),
        rs.getString("check_in_mode"), rs.getObject("checked_in_at", OffsetDateTime.class),
        rs.getObject("checked_out_at", OffsetDateTime.class)));
    List<VersionMemberDayResponse> memberDays = jdbc.query("""
        select source_day_entry_id, organization_membership_id, member_display_name,
          work_date, status, source
        from staffing_plan_version_member_days where version_id=:version
        order by work_date, member_display_name, source_day_entry_id
        """, versionParam, (rs, row) -> new VersionMemberDayResponse(
        rs.getObject("source_day_entry_id", UUID.class),
        rs.getObject("organization_membership_id", UUID.class), rs.getString("member_display_name"),
        rs.getObject("work_date", LocalDate.class), rs.getString("status"),
        rs.getString("source")));
    List<VersionAcknowledgementResponse> acknowledgements = jdbc.query("""
        select issue_key, severity, acknowledged_at
        from staffing_plan_version_acknowledgements where version_id=:version
        order by issue_key
        """, versionParam, (rs, row) -> new VersionAcknowledgementResponse(
        rs.getString("issue_key"), rs.getString("severity"),
        rs.getObject("acknowledged_at", OffsetDateTime.class)));
    List<VersionRequirementCoverageResponse> requirementCoverage = jdbc.query("""
        select c.source_requirement_id, c.work_date, r.work_type_code, r.work_type_name,
          c.required, c.raw_assigned, c.effective_assigned, c.covered, c.missing,
          c.overstaffed, c.percentage, c.open_positions
        from staffing_plan_version_requirement_coverage c
        join staffing_plan_version_requirements r
          on r.id=c.version_requirement_id and r.version_id=c.version_id
        where c.version_id=:version
        order by c.work_date, r.work_type_code, c.source_requirement_id
        """, versionParam, (rs, row) -> new VersionRequirementCoverageResponse(
        rs.getObject("source_requirement_id", UUID.class),
        rs.getObject("work_date", LocalDate.class), rs.getString("work_type_code"),
        rs.getString("work_type_name"), rs.getInt("required"), rs.getInt("raw_assigned"),
        rs.getInt("effective_assigned"), rs.getInt("covered"), rs.getInt("missing"),
        rs.getInt("overstaffed"), rs.getBigDecimal("percentage"),
        rs.getInt("open_positions")));
    List<VersionDayCoverageResponse> dayCoverage = jdbc.query("""
        select work_date, required, raw_assigned, effective_assigned, covered, missing,
          overstaffed, percentage, open_positions
        from staffing_plan_version_day_coverage
        where version_id=:version order by work_date
        """, versionParam, (rs, row) -> new VersionDayCoverageResponse(
        rs.getObject("work_date", LocalDate.class), rs.getInt("required"),
        rs.getInt("raw_assigned"), rs.getInt("effective_assigned"), rs.getInt("covered"),
        rs.getInt("missing"), rs.getInt("overstaffed"), rs.getBigDecimal("percentage"),
        rs.getInt("open_positions")));
    boolean granularCoverageAvailable = version.checksumFormatVersion == 2
        && requirementCoverage.size() == requirements.size() && dayCoverage.size() == 7;
    VersionDetailResponse response = new VersionDetailResponse(version.id, planId, organizationId,
        authorized.plan.unitId, version.versionNumber, version.sourceDraftRevision,
        version.required, version.rawAssigned, version.effectiveAssigned, version.covered,
        version.missing, version.overstaffed, version.percentage, version.coverageBasis,
        version.warningCount, version.checksum, version.checksumFormatVersion,
        granularCoverageAvailable, version.publicationKind,
        version.sourceDraftComplete, version.publishedAt, version.timezone, version.weekStart,
        days, requirements, assignments,
        memberDays, acknowledgements, granularCoverageAvailable ? requirementCoverage : List.of(),
        granularCoverageAvailable ? dayCoverage : List.of());
    return new QueryResult<>(response, etag, true, false);
  }

  private DemandSource loadDemandSource(PlanRow plan, CoverageResult coverage) {
    Map<UUID, StaffingPlanCoverageService.RequirementCoverage> coverageByRequirement =
        coverage.requirementCoverage().stream().collect(Collectors.toMap(
            StaffingPlanCoverageService.RequirementCoverage::requirementId, value -> value));
    Map<LocalDate, StaffingPlanCoverageService.DayCoverage> coverageByDay =
        coverage.dayCoverage().stream().collect(Collectors.toMap(
            StaffingPlanCoverageService.DayCoverage::date, value -> value));
    Map<LocalDate, DayBuilder> builders = new TreeMap<>();
    for (int index = 0; index < 7; index++) {
      LocalDate date = plan.weekStart.plusDays(index);
      builders.put(date, new DayBuilder(date));
    }
    jdbc.query("""
        select d.id plan_day_id, d.work_date, d.rooms_context, d.notes day_notes, d.source,
          r.id requirement_id, r.work_type_id, wt.code work_type_code, wt.name work_type_name,
          r.start_time, r.end_time, wt.default_break_minutes, r.required_workers,
          r.required_quantity, r.publication_status, r.notes requirement_notes
        from staffing_plan_days d
        left join staffing_requirements r on r.plan_day_id=d.id
        left join organization_work_types wt on wt.id=r.work_type_id
        where d.plan_id=:plan and d.organization_id=:organization
        order by d.work_date, r.start_time nulls first, wt.code, r.id
        """, params("plan", plan.id, "organization", plan.organizationId),
        (RowCallbackHandler) rs -> {
          try {
            LocalDate date = rs.getObject("work_date", LocalDate.class);
            DayBuilder day = builders.get(date);
            if (day == null) return;
            day.id = rs.getObject("plan_day_id", UUID.class);
            day.rooms = integer(rs, "rooms_context");
            day.notes = rs.getString("day_notes");
            day.source = rs.getString("source");
            UUID requirementId = rs.getObject("requirement_id", UUID.class);
            if (requirementId == null) return;
            var value = coverageByRequirement.get(requirementId);
            CoverageTotals requirementCoverage = value == null ? emptyTotals()
                : totals(value.required(), value.assigned(), value.effectiveAssigned(),
                    value.covered(), value.missing(), value.overstaffed(), value.percentage());
            day.requirements.add(new RequirementDemandResponse(requirementId, day.id,
                rs.getObject("work_type_id", UUID.class), rs.getString("work_type_code"),
                rs.getString("work_type_name"), rs.getObject("start_time", LocalTime.class),
                rs.getObject("end_time", LocalTime.class), rs.getInt("default_break_minutes"),
                rs.getInt("required_workers"), rs.getBigDecimal("required_quantity"),
                rs.getString("publication_status"), rs.getString("requirement_notes"),
                requirementCoverage, value == null ? List.of() : value.issueKeys()));
          } catch (SQLException exception) {
            throw new IllegalStateException("Could not read staffing demand", exception);
          }
        });
    List<DemandDayResponse> days = builders.values().stream().map(day -> {
      var value = coverageByDay.get(day.date);
      CoverageTotals dayCoverage = value == null ? emptyTotals()
          : totals(value.required(), value.assigned(), value.effectiveAssigned(), value.covered(),
              value.missing(), value.overstaffed(), value.percentage());
      return new DemandDayResponse(day.id, day.date, day.id != null, day.rooms, day.notes,
          day.source, dayCoverage, List.copyOf(day.requirements),
          value == null ? List.of() : value.issueKeys());
    }).toList();
    return new DemandSource(days);
  }

  private ScheduleAssembly loadSchedule(PlanRow plan, CoverageResult coverage, DemandSource demand) {
    Map<UUID, StaffingPlanCoverageService.RequirementCoverage> requirementCoverage =
        coverage.requirementCoverage().stream().collect(Collectors.toMap(
            StaffingPlanCoverageService.RequirementCoverage::requirementId, value -> value));
    Map<UUID, List<PlanningIssue>> issuesByAssignment = coverage.issues().stream()
        .filter(value -> value.assignmentId() != null)
        .collect(Collectors.groupingBy(PlanningIssue::assignmentId));
    Map<UUID, AssignmentBuilder> assignments = new LinkedHashMap<>();
    Map<UUID, MemberBuilder> members = new LinkedHashMap<>();
    jdbc.query("""
        select id, created_at, display_order,
          coalesce(nullif(btrim(concat_ws(' ',first_name,last_name)),''),
            'Member ' || left(id::text,8)) display_name,
          membership_status
        from organization_memberships
        where organization_id=:organization and membership_status='ACTIVE'
        order by display_order, created_at, id
        """, params("organization", plan.organizationId), (RowCallbackHandler) rs -> {
          try {
            UUID membershipId = rs.getObject("id", UUID.class);
            members.put(membershipId, new MemberBuilder(membershipId,
                rs.getString("display_name"), rs.getString("membership_status"),
                rs.getObject("created_at", OffsetDateTime.class), rs.getInt("display_order")));
          } catch (SQLException exception) {
            throw new IllegalStateException("Could not read organization members", exception);
          }
        });
    jdbc.query("""
        select a.id assignment_id, r.id requirement_id, a.membership_id,
          coalesce(nullif(btrim(concat_ws(' ',m.first_name,m.last_name)),''),
            'Member ' || left(m.id::text,8)) member_display_name,
          m.membership_status, a.assignment_status,
          coalesce(a.start_time,r.start_time) effective_start,
          coalesce(a.end_time,r.end_time) effective_end,
          (a.start_time is not null and a.start_time is distinct from r.start_time)
            or (a.end_time is not null and a.end_time is distinct from r.end_time) interval_override
        from staffing_plan_days d
        join staffing_requirements r on r.plan_day_id=d.id
        join staffing_assignments a on a.requirement_id=r.id
        join organization_memberships m on m.id=a.membership_id
        where d.plan_id=:plan and d.organization_id=:organization
          and m.membership_status='ACTIVE'
        order by r.work_date, r.start_time nulls first, a.created_at, a.id
        """, params("plan", plan.id, "organization", plan.organizationId),
        (RowCallbackHandler) rs -> {
          try {
            UUID id = rs.getObject("assignment_id", UUID.class);
            UUID requirementId = rs.getObject("requirement_id", UUID.class);
            UUID membershipId = rs.getObject("membership_id", UUID.class);
            String memberDisplayName = rs.getString("member_display_name");
            String membershipStatus = rs.getString("membership_status");
            var reqCoverage = requirementCoverage.get(requirementId);
            boolean effective = reqCoverage != null
                && reqCoverage.effectiveAssignmentIds().contains(id);
            List<String> issueKeys = issuesByAssignment.getOrDefault(id, List.of()).stream()
                .map(PlanningIssue::issueKey).sorted().toList();
            assignments.put(id, new AssignmentBuilder(new AssignmentResponse(id, requirementId,
                membershipId, memberDisplayName, membershipStatus, rs.getString("assignment_status"),
                rs.getObject("effective_start", LocalTime.class),
                rs.getObject("effective_end", LocalTime.class),
                rs.getBoolean("interval_override"), effective, issueKeys)));
            members.computeIfAbsent(membershipId, ignored -> new MemberBuilder(membershipId,
                memberDisplayName, membershipStatus, null, Integer.MAX_VALUE)).assignmentIds.add(id);
          } catch (SQLException exception) {
            throw new IllegalStateException("Could not read staffing assignments", exception);
          }
        });
    if (!members.isEmpty()) {
      MapSqlParameterSource memberScope = params("organization", plan.organizationId,
          "members", members.keySet(), "from", plan.weekStart, "to", plan.weekStart.plusDays(6));
      jdbc.query("""
          select membership_id, work_date, entry_type
          from staffing_member_day_entries
          where organization_id=:organization and membership_id in (:members)
            and work_date between :from and :to
          order by work_date, membership_id
          """, memberScope, (RowCallbackHandler) rs -> {
        try {
          UUID membershipId = rs.getObject("membership_id", UUID.class);
          members.get(membershipId).statuses.add(new DayStatusResponse(membershipId,
              rs.getObject("work_date", LocalDate.class), rs.getString("entry_type"),
              "MEMBER_DAY", false));
        } catch (SQLException exception) {
          throw new IllegalStateException("Could not read staffing day status", exception);
        }
      });
      jdbc.query("""
          select membership_id, absence_type, start_date, end_date
          from staffing_absence_requests
          where organization_id=:organization and membership_id in (:members)
            and request_status='PENDING' and end_date>=:from and start_date<=:to
          order by start_date, membership_id, id
          """, memberScope, (RowCallbackHandler) rs -> {
        try {
          UUID membershipId = rs.getObject("membership_id", UUID.class);
          LocalDate start = rs.getObject("start_date", LocalDate.class);
          LocalDate end = rs.getObject("end_date", LocalDate.class);
          for (LocalDate date = start.isBefore(plan.weekStart) ? plan.weekStart : start;
              !date.isAfter(end) && !date.isAfter(plan.weekStart.plusDays(6)); date = date.plusDays(1)) {
            members.get(membershipId).statuses.add(new DayStatusResponse(membershipId, date,
                rs.getString("absence_type"), "PENDING_REQUEST", true));
          }
        } catch (SQLException exception) {
          throw new IllegalStateException("Could not read pending staffing request", exception);
        }
      });
    }
    Map<UUID, List<AssignmentResponse>> byRequirement = assignments.values().stream()
        .map(value -> value.value).collect(Collectors.groupingBy(AssignmentResponse::requirementId,
            LinkedHashMap::new, Collectors.toList()));
    List<ScheduleDayResponse> days = demand.days.stream().map(day ->
        new ScheduleDayResponse(day.planDayId(), day.date(), day.persisted(), day.roomsContext(),
            day.source(), day.coverage(), day.requirements().stream().map(requirement ->
                new ScheduleRequirementResponse(requirement.requirementId(),
                    requirement.planDayId(), day.date(), requirement.workTypeId(),
                    requirement.workTypeCode(), requirement.workTypeName(),
                    requirement.startTime(), requirement.endTime(), requirement.breakMinutes(),
                    requirement.requiredWorkers(), requirement.coverage(),
                    byRequirement.getOrDefault(requirement.requirementId(), List.of()),
                    requirement.issueKeys())).toList(), day.issueKeys())).toList();
    List<MemberResponse> memberResponses = members.values().stream()
        .sorted(Comparator.comparingInt((MemberBuilder value) -> value.displayOrder)
            .thenComparing(value -> value.createdAt, Comparator.nullsLast(Comparator.naturalOrder()))
            .thenComparing(value -> value.id))
        .map(value -> new MemberResponse(value.id, value.displayName, value.status,
            Set.copyOf(value.assignmentIds), value.statuses.stream()
                .sorted(Comparator.comparing(DayStatusResponse::date)
                    .thenComparing(DayStatusResponse::source))
                .toList(), value.createdAt, value.displayOrder))
        .toList();
    return new ScheduleAssembly(days, memberResponses);
  }

  private AuthorizedPlan authorizePlan(UUID organizationId, UUID planId) {
    requireOrganizationView(organizationId);
    List<PlanRow> plans = jdbc.query(PLAN_HEADER_SQL + " and plan.id=:plan",
        params("organization", organizationId, "plan", planId), (rs, row) -> planRow(rs));
    PlanRow plan = plans.stream().findFirst()
        .orElseThrow(() -> new NotFoundException("Staffing plan", planId));
    UnitAuthorization authorization = authorizeUnitAfterOrganizationPermission(organizationId,
        plan.unitId);
    return new AuthorizedPlan(plan, authorization);
  }

  private UnitAuthorization authorizeUnit(UUID organizationId, UUID unitId) {
    requireOrganizationView(organizationId);
    return authorizeUnitAfterOrganizationPermission(organizationId, unitId);
  }

  private void requireOrganizationView(UUID organizationId) {
    if (!access.permissions(organizationId).contains(OrganizationPermission.VIEW_SCHEDULE)) {
      throw new AccessDeniedException("Required organization permission is missing");
    }
  }

  private UnitAuthorization authorizeUnitAfterOrganizationPermission(UUID organizationId,
      UUID unitId) {
    OrganizationUnit unit = units.findByIdAndOrganizationId(unitId, organizationId)
        .orElseThrow(() -> new NotFoundException("Organization unit", unitId));
    Predicate<OrganizationUnit> view = access.unitAccessFilter(organizationId,
        OrganizationPermission.VIEW_SCHEDULE);
    if (!view.test(unit)) throw new NotFoundException("Organization unit", unitId);
    boolean manage = access.canAccess(organizationId, unit, OrganizationPermission.MANAGE_SCHEDULE);
    boolean publish = access.canAccess(organizationId, unit,
        OrganizationPermission.PUBLISH_SCHEDULE);
    return new UnitAuthorization(unit, new PlanCapabilities(true, manage, publish));
  }

  private PlanHeaderResponse header(PlanRow plan, UnitAuthorization authorization) {
    PublishedVersionSummary latest = plan.latestVersionId == null ? null
        : new PublishedVersionSummary(plan.latestVersionId, plan.latestVersionNumber,
            plan.latestSourceRevision, plan.latestPublishedAt, plan.latestPublicationKind,
            plan.latestCoverageBasis, plan.latestChecksum);
    boolean unpublished = latest == null || plan.publishedRevision == null
        || !plan.latestSourceComplete || plan.draftRevision > plan.publishedRevision;
    return new PlanHeaderResponse(plan.id, plan.organizationId, plan.unitId,
        authorization.unit.getName(), plan.weekStart, plan.weekStart.plusDays(6), plan.timezone,
        plan.status, plan.draftRevision, draftEtag(plan), latest, plan.publishedRevision,
        plan.publishedAt, unpublished, authorization.capabilities);
  }

  private IssueResponse issue(PlanningIssue value) {
    return new IssueResponse(value.issueKey(), value.code().name(), value.severity().name(),
        value.date(), value.requirementId(), value.assignmentId(), value.membershipId(),
        value.messageKey(), sanitize(value.parameters()), value.acknowledgementRequired(),
        value.publishBlocking());
  }

  private Map<String, String> sanitize(Map<String, String> values) {
    if (values == null || values.isEmpty()) return Map.of();
    Map<String, String> result = new TreeMap<>();
    values.forEach((key, value) -> {
      if (key != null && value != null && key.matches("[A-Za-z][A-Za-z0-9_]{0,63}")
          && value.length() <= 160) result.put(key, value);
    });
    return Map.copyOf(result);
  }

  private static CoverageTotals totals(CoverageResult value) {
    return totals(value.required(), value.assigned(), value.effectiveAssigned(), value.covered(),
        value.missing(), value.overstaffed(), value.percentage());
  }

  private static CoverageTotals totals(int required, int raw, int effective, int covered,
      int missing, int overstaffed, BigDecimal percentage) {
    return new CoverageTotals(required, raw, effective, covered, missing, overstaffed,
        percentage, missing);
  }

  private static CoverageTotals emptyTotals() {
    return totals(0, 0, 0, 0, 0, 0, BigDecimal.ZERO.setScale(2));
  }

  private static <T> QueryResult<T> draft(T body, PlanRow plan) {
    return new QueryResult<>(body, draftEtag(plan), false, false);
  }

  private static <T> QueryResult<T> conditionalDraft(PlanRow plan, String ifNoneMatch) {
    String etag = draftEtag(plan);
    return matches(ifNoneMatch, etag) ? notModified(etag, false) : null;
  }

  private static <T> QueryResult<T> notModified(String etag, boolean immutable) {
    return new QueryResult<>(null, etag, immutable, true);
  }

  private static String draftEtag(PlanRow plan) {
    return '"' + DRAFT_CACHE_ETAG_PREFIX + plan.id + "-r" + plan.draftRevision + '"';
  }

  private static String versionEtag(VersionRow version) {
    return immutableVersionEtag(version.id, version.checksum);
  }

  public static String immutableVersionEtag(UUID versionId, String checksum) {
    String safeChecksum = checksum == null ? "missing" : checksum;
    return '"' + "plan-version-" + versionId + '-' + safeChecksum + '"';
  }

  private static String versionsEtag(UUID planId, int limit, Integer beforeVersion,
      boolean hasMore, List<VersionListItem> versions) {
    StringBuilder canonical = new StringBuilder("versions\n")
        .append(planId).append('\n').append(limit).append('\n')
        .append(beforeVersion == null ? "NULL" : beforeVersion).append('\n')
        .append(hasMore).append('\n');
    for (VersionListItem version : versions) {
      canonical.append(version.versionId()).append('|').append(version.versionNumber())
          .append('|').append(version.checksum()).append('|').append(version.latest()).append('\n');
    }
    return '"' + "plan-versions-" + sha256(canonical.toString()) + '"';
  }

  private static String sha256(String value) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
          .digest(value.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException exception) {
      throw new IllegalStateException("SHA-256 is unavailable", exception);
    }
  }

  static boolean matches(String header, String expected) {
    if (header == null || header.isBlank() || expected == null) return false;
    for (String rawCandidate : header.split(",", -1)) {
      String candidate = rawCandidate.trim();
      if (candidate.equals("*")) return true;
      if (candidate.startsWith("W/")) candidate = candidate.substring(2).trim();
      if (candidate.length() < 2 || !candidate.startsWith("\"")
          || !candidate.endsWith("\"")) continue;
      if (candidate.substring(1, candidate.length() - 1).contains("\"")) continue;
      if (candidate.equals(expected)) return true;
    }
    return false;
  }

  private static void requireMonday(LocalDate value) {
    if (value == null || value.getDayOfWeek() != DayOfWeek.MONDAY) {
      throw new IllegalArgumentException("weekStart must be Monday");
    }
  }

  private static PlanRow planRow(ResultSet rs) throws SQLException {
    return new PlanRow(rs.getObject("plan_id", UUID.class),
        rs.getObject("organization_id", UUID.class), rs.getObject("unit_id", UUID.class),
        rs.getObject("week_start", LocalDate.class), rs.getString("timezone"),
        rs.getString("plan_status"), rs.getLong("draft_revision"),
        rs.getObject("latest_published_version_id", UUID.class),
        integer(rs, "latest_version_number"), longObject(rs, "latest_source_revision"),
        rs.getObject("latest_published_at", OffsetDateTime.class),
        rs.getString("latest_publication_kind"), rs.getString("latest_coverage_basis"),
        rs.getString("latest_checksum"), booleanObject(rs, "latest_source_complete"),
        longObject(rs, "published_revision"), rs.getObject("published_at", OffsetDateTime.class));
  }

  private static VersionRow versionRow(ResultSet rs) throws SQLException {
    return new VersionRow(rs.getObject("id", UUID.class), rs.getInt("version_number"),
        rs.getLong("source_draft_revision"), integer(rs, "coverage_required"),
        integer(rs, "coverage_raw_assigned"), integer(rs, "coverage_effective_assigned"),
        integer(rs, "coverage_covered"), integer(rs, "coverage_missing"),
        integer(rs, "coverage_overstaffed"), rs.getBigDecimal("coverage_percentage"),
        rs.getString("coverage_basis"), rs.getInt("warning_count"), rs.getString("checksum"),
        rs.getInt("checksum_format_version"),
        rs.getString("publication_kind"), rs.getBoolean("source_draft_complete"),
        rs.getString("publication_note"), rs.getString("published_by_display_name"),
        rs.getObject("published_at", OffsetDateTime.class), rs.getString("timezone"),
        rs.getObject("week_start", LocalDate.class));
  }

  private static Integer integer(ResultSet rs, String column) throws SQLException {
    int value = rs.getInt(column);
    return rs.wasNull() ? null : value;
  }

  private static Long longObject(ResultSet rs, String column) throws SQLException {
    long value = rs.getLong(column);
    return rs.wasNull() ? null : value;
  }

  private static Boolean booleanObject(ResultSet rs, String column) throws SQLException {
    boolean value = rs.getBoolean(column);
    return rs.wasNull() ? null : value;
  }

  private static MapSqlParameterSource params(Object... values) {
    MapSqlParameterSource result = new MapSqlParameterSource();
    for (int index = 0; index < values.length; index += 2) {
      result.addValue((String) values[index], values[index + 1]);
    }
    return result;
  }

  private static MapSqlParameterSource scope(PlanRow plan) {
    return params("organization", plan.organizationId, "unit", plan.unitId, "plan", plan.id);
  }

  private static final String PLAN_HEADER_SQL = """
      select plan.id plan_id, plan.organization_id, plan.unit_id, plan.week_start,
        plan.timezone, plan.plan_status, plan.draft_revision,
        plan.latest_published_version_id, plan.published_revision, plan.published_at,
        latest.version_number latest_version_number,
        latest.source_draft_revision latest_source_revision,
        latest.published_at latest_published_at,
        latest.publication_kind latest_publication_kind,
        latest.coverage_basis latest_coverage_basis,
        latest.checksum latest_checksum,
        latest.source_draft_complete latest_source_complete
      from staffing_plans plan
      left join staffing_plan_versions latest on latest.id=plan.latest_published_version_id
      where plan.organization_id=:organization
      """;

  private record AuthorizedPlan(PlanRow plan, UnitAuthorization authorization) {}
  private record UnitAuthorization(OrganizationUnit unit, PlanCapabilities capabilities) {}

  private record PlanRow(UUID id, UUID organizationId, UUID unitId, LocalDate weekStart,
      String timezone, String status, long draftRevision, UUID latestVersionId,
      Integer latestVersionNumber, Long latestSourceRevision, OffsetDateTime latestPublishedAt,
      String latestPublicationKind, String latestCoverageBasis, String latestChecksum,
      Boolean latestSourceComplete, Long publishedRevision, OffsetDateTime publishedAt) {}

  private record VersionRow(UUID id, int versionNumber, long sourceDraftRevision,
      Integer required, Integer rawAssigned, Integer effectiveAssigned, Integer covered,
      Integer missing, Integer overstaffed, BigDecimal percentage, String coverageBasis,
      int warningCount, String checksum, int checksumFormatVersion, String publicationKind,
      boolean sourceDraftComplete,
      String publicationNote, String publisherDisplayName, OffsetDateTime publishedAt,
      String timezone, LocalDate weekStart) {}

  private static final class DayBuilder {
    final LocalDate date;
    UUID id;
    Integer rooms;
    String notes;
    String source;
    final List<RequirementDemandResponse> requirements = new ArrayList<>();
    DayBuilder(LocalDate date) { this.date = date; }
  }

  private record DemandSource(List<DemandDayResponse> days) {}
  private record AssignmentBuilder(AssignmentResponse value) {}

  private static final class MemberBuilder {
    final UUID id;
    final String displayName;
    final String status;
    final OffsetDateTime createdAt;
    final int displayOrder;
    final Set<UUID> assignmentIds = new LinkedHashSet<>();
    final List<DayStatusResponse> statuses = new ArrayList<>();
    MemberBuilder(UUID id, String displayName, String status, OffsetDateTime createdAt,
        int displayOrder) {
      this.id = id; this.displayName = displayName; this.status = status; this.createdAt = createdAt;
      this.displayOrder = displayOrder;
    }
  }

  private record ScheduleAssembly(List<ScheduleDayResponse> days,
      List<MemberResponse> members) {}
}
