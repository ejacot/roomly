package com.alveryn.api.staffing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import com.alveryn.api.auth.security.AuthenticatedUser;
import com.alveryn.api.common.exception.ConflictException;
import com.alveryn.api.common.exception.PreconditionFailedException;
import com.alveryn.api.common.exception.ValidationException;
import com.alveryn.api.organization.entity.*;
import com.alveryn.api.organization.repository.*;
import com.alveryn.api.staffing.entity.StaffingPlanDaySource;
import com.alveryn.api.staffing.dto.StaffingPlanMutationDtos.RequirementUpdateInput;
import com.alveryn.api.staffing.repository.StaffingPlanRepository;
import com.alveryn.api.staffing.service.StaffingPlanDraftMutationService;
import com.alveryn.api.staffing.service.StaffingPlanFoundationService;
import com.alveryn.api.staffing.service.StaffingPlanPublicationService;
import com.alveryn.api.staffing.service.StaffingPlanPublicationService.PublishCommand;
import com.alveryn.api.staffing.service.StaffingPlanPublicationFaultProbe;
import com.alveryn.api.staffing.service.StaffingPlanMutationCoordinator;
import com.alveryn.api.staffing.service.StaffingPlanMutationFaultProbe;
import com.alveryn.api.staffing.service.StaffingPlanCoverageService;
import com.alveryn.api.user.entity.*;
import com.alveryn.api.user.repository.UserAccountRepository;
import java.time.LocalDate;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.context.annotation.*;
import org.springframework.context.ApplicationContext;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import com.alveryn.api.common.exception.NotFoundException;
import java.util.concurrent.*;
import jakarta.persistence.EntityManager;

@SpringBootTest
@Import(StaffingPlanPublicationIntegrationTest.FaultConfiguration.class)
class StaffingPlanPublicationIntegrationTest {
  private static final LocalDate WEEK = LocalDate.of(2026, 8, 10);
  @Autowired StaffingPlanPublicationService publication;
  @Autowired StaffingPlanFoundationService foundation;
  @Autowired StaffingPlanRepository plans;
  @Autowired OrganizationRepository organizations;
  @Autowired OrganizationUnitRepository units;
  @Autowired OrganizationMembershipRepository memberships;
  @Autowired UserAccountRepository users;
  @Autowired JdbcTemplate jdbc;
  @Autowired EntityManager entityManager;
  @Autowired TestFaultProbe faultProbe;
  @Autowired TestMutationFaultProbe mutationFaultProbe;
  @Autowired StaffingPlanMutationCoordinator mutations;
  @Autowired StaffingPlanDraftMutationService draftMutations;
  @MockitoSpyBean StaffingPlanCoverageService coverage;
  @Autowired ApplicationContext applicationContext;
  @Autowired PlatformTransactionManager transactionManager;

  @AfterEach void clearSecurity() {
    SecurityContextHolder.clearContext();
    faultProbe.reset();
    mutationFaultProbe.reset();
    reset(coverage);
    jdbc.execute("TRUNCATE TABLE organizations, user_accounts CASCADE");
  }

  @Test void publishesReplaysAndKeepsEarlierVersionImmutable() {
    Fixture fixture = fixture("atomic");
    UUID requirementId = requirement(fixture);
    long revision = fixture.planRevision();
    var command = command(fixture, revision, Set.of("UNDERCOVERAGE:" + requirementId), "first", "key-1");
    var first = publication.publishPlan(command);
    var replay = publication.publishPlan(command);
    assertThat(first.versionNumber()).isEqualTo(1);
    assertThat(first.publicationKind()).isEqualTo("ATOMIC_WEEKLY");
    assertThat(first.legacyCoverage().assigned()).isZero();
    assertThat(replay.versionId()).isEqualTo(first.versionId());
    assertThat(replay.idempotentReplay()).isTrue();
    assertThat(jdbc.queryForObject("select count(*) from staffing_plan_versions where plan_id=?", Integer.class,
        fixture.planId())).isEqualTo(1);
    assertThat(jdbc.queryForObject("select checksum_format_version from staffing_plan_versions where id=?",
        Integer.class, first.versionId())).isEqualTo(2);
    assertThat(jdbc.queryForObject("select count(*) from staffing_plan_version_requirement_coverage where version_id=?",
        Integer.class, first.versionId())).isEqualTo(1);
    assertThat(jdbc.queryForObject("select count(*) from staffing_plan_version_day_coverage where version_id=?",
        Integer.class, first.versionId())).isEqualTo(7);
    assertThat(jdbc.queryForObject("select count(*) from staffing_plan_version_day_coverage where version_id=? and required=0 and raw_assigned=0 and effective_assigned=0 and covered=0 and missing=0 and overstaffed=0 and percentage=0 and open_positions=0",
        Integer.class, first.versionId())).isEqualTo(6);
    assertThat(jdbc.queryForObject("select count(*) from staffing_change_events "
        + "where organization_id=? and entity_id=? and event_type='WEEKLY_PLAN_PUBLISHED'",
        Integer.class, fixture.organizationId(), fixture.planId())).isEqualTo(1);

    String checksum = first.checksum();
    mutations.mutateScopes(fixture.organizationId(), List.of(
            new StaffingPlanMutationCoordinator.Scope(fixture.planId(), fixture.unitId())),
        fixture.owner(), revision,
        () -> StaffingPlanMutationCoordinator.Change.changed("draft changed"));
    assertThat(jdbc.queryForObject(
        "select draft_revision > published_revision from staffing_plans where id=?",
        Boolean.class, fixture.planId())).isTrue();
    var second = publication.publishPlan(command(fixture, revision + 1,
        Set.of("UNDERCOVERAGE:" + requirementId), "second", "key-2"));
    assertThat(second.versionNumber()).isEqualTo(2);
    assertThat(jdbc.queryForObject("select checksum from staffing_plan_versions where plan_id=? and version_number=1",
        String.class, fixture.planId())).isEqualTo(checksum);
    assertThatThrownBy(() -> publication.publishPlan(command(fixture, revision,
        Set.of("UNDERCOVERAGE:" + requirementId), "stale", "key-3")))
        .isInstanceOf(PreconditionFailedException.class);
  }

  @Test void publishCalculatesCanonicalCoverageExactlyOnce() {
    Fixture fixture = fixture("single-coverage-result");
    UUID requirementId = requirement(fixture);
    clearInvocations(coverage);

    publication.publishPlan(command(fixture, fixture.planRevision(),
        Set.of("UNDERCOVERAGE:" + requirementId), null, "single-coverage-result"));

    verify(coverage, times(1)).calculate(
        fixture.organizationId(), fixture.unitId(), fixture.planId());
  }

  @Test void formatTwoPublicationRejectsMissingOrUnknownRequirementCoverageAtomically() {
    Fixture fixture = fixture("coverage-identity");
    UUID requirementId = requirement(fixture);
    var canonical = coverage.calculate(
        fixture.organizationId(), fixture.unitId(), fixture.planId());
    Set<String> acknowledgements = Set.of("UNDERCOVERAGE:" + requirementId);

    doReturn(withRequirementCoverage(canonical, List.of())).when(coverage).calculate(
        fixture.organizationId(), fixture.unitId(), fixture.planId());
    assertThatThrownBy(() -> publication.publishPlan(command(fixture, fixture.planRevision(),
        acknowledgements, null, "missing-requirement-coverage")))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("does not match the requirement snapshot");
    assertNoPartialPublication(fixture);

    reset(coverage);
    var unknown = withRequirementId(canonical.requirementCoverage().getFirst(), UUID.randomUUID());
    doReturn(withRequirementCoverage(canonical, List.of(unknown))).when(coverage).calculate(
        fixture.organizationId(), fixture.unitId(), fixture.planId());
    assertThatThrownBy(() -> publication.publishPlan(command(fixture, fixture.planRevision(),
        acknowledgements, null, "unknown-requirement-coverage")))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("does not match the requirement snapshot");
    assertNoPartialPublication(fixture);
  }

  @Test void formatTwoChecksumIgnoresPhysicalInsertionOrderAndDatabaseOrJvmTimezone() {
    Fixture fixture = fixture("checksum-format-two");
    UUID first = requirement(fixture);
    var secondDay = foundation.createDay(fixture.organizationId(), fixture.unitId(), fixture.planId(),
        WEEK.plusDays(1), null, null, StaffingPlanDaySource.MANUAL, fixture.owner().getId());
    UUID second = additionalRequirement(fixture, first, secondDay.getId(), WEEK.plusDays(1));
    long revision = revision(fixture.planId());
    var published = publication.publishPlan(command(fixture, revision,
        Set.of("UNDERCOVERAGE:" + first, "UNDERCOVERAGE:" + second), null,
        "checksum-format-two"));
    String original = published.checksum();

    jdbc.update("""
        with removed as (
          delete from staffing_plan_version_requirement_coverage where version_id=?
          returning organization_id,unit_id,version_id,week_start,version_requirement_id,
            source_requirement_id,work_date,required,raw_assigned,effective_assigned,covered,
            missing,overstaffed,percentage,open_positions,created_at)
        insert into staffing_plan_version_requirement_coverage(
          id,organization_id,unit_id,version_id,week_start,version_requirement_id,
          source_requirement_id,work_date,required,raw_assigned,effective_assigned,covered,
          missing,overstaffed,percentage,open_positions,created_at)
        select gen_random_uuid(),organization_id,unit_id,version_id,week_start,
          version_requirement_id,source_requirement_id,work_date,required,raw_assigned,
          effective_assigned,covered,missing,overstaffed,percentage,open_positions,created_at
        from removed order by work_date desc,source_requirement_id desc
        """, published.versionId());
    jdbc.update("""
        with removed as (
          delete from staffing_plan_version_day_coverage where version_id=?
          returning organization_id,unit_id,version_id,week_start,work_date,required,
            raw_assigned,effective_assigned,covered,missing,overstaffed,percentage,
            open_positions,created_at)
        insert into staffing_plan_version_day_coverage(
          id,organization_id,unit_id,version_id,week_start,work_date,required,raw_assigned,
          effective_assigned,covered,missing,overstaffed,percentage,open_positions,created_at)
        select gen_random_uuid(),organization_id,unit_id,version_id,week_start,work_date,
          required,raw_assigned,effective_assigned,covered,missing,overstaffed,percentage,
          open_positions,created_at from removed order by work_date desc
        """, published.versionId());

    TimeZone originalJvmTimezone = TimeZone.getDefault();
    try {
      TimeZone.setDefault(TimeZone.getTimeZone("America/Los_Angeles"));
      String losAngeles = checksumInDatabaseTimezone(published.versionId(), "Pacific/Auckland");
      TimeZone.setDefault(TimeZone.getTimeZone("Asia/Tokyo"));
      String tokyo = checksumInDatabaseTimezone(published.versionId(), "America/New_York");
      assertThat(losAngeles).isEqualTo(original);
      assertThat(tokyo).isEqualTo(original);
    } finally {
      TimeZone.setDefault(originalJvmTimezone);
    }
  }

  @Test void firstAtomicPublicationAfterLegacyPartialBecomesVersionTwo() {
    Fixture fixture = fixture("legacy-partial");
    UUID requirementId = requirement(fixture);
    UUID legacyVersionId = UUID.randomUUID();
    jdbc.update("""
        insert into staffing_plan_versions(
          id,organization_id,unit_id,plan_id,version_number,source_draft_revision,
          published_at,timezone,week_start,coverage_required,coverage_assigned,
          coverage_percentage,coverage_basis,warning_count,checksum,publication_kind,
          source_draft_complete,created_at)
        values(?,?,?,?,1,?,current_timestamp,'Europe/Berlin',?,1,0,0,'LEGACY_V90',1,?,
          'LEGACY_PARTIAL',false,current_timestamp)
        """, legacyVersionId, fixture.organizationId(), fixture.unitId(), fixture.planId(),
        fixture.planRevision(), WEEK, "a".repeat(64));
    jdbc.update("""
        update staffing_plans set latest_published_version_id=?,published_revision=?,
          published_at=current_timestamp where id=?
        """, legacyVersionId, fixture.planRevision(), fixture.planId());
    entityManager.clear();

    var result = publication.publishPlan(command(fixture, fixture.planRevision(),
        Set.of("UNDERCOVERAGE:" + requirementId), null, "after-legacy"));

    assertThat(result.versionNumber()).isEqualTo(2);
    assertThat(result.publicationKind()).isEqualTo("ATOMIC_WEEKLY");
    assertThat(jdbc.queryForObject("select count(*) from staffing_plan_versions where plan_id=?",
        Integer.class, fixture.planId())).isEqualTo(2);
    assertThat(jdbc.queryForList("""
        select publication_kind from staffing_plan_versions where plan_id=? order by version_number
        """, String.class, fixture.planId())).containsExactly("LEGACY_PARTIAL", "ATOMIC_WEEKLY");
  }

  @Test void invitedOperationalEmployeeAssignmentIsSnapshottedAndCounts() {
    Fixture fixture = fixture("invited");
    UUID requirementId = requirement(fixture);
    var invited = memberships.saveAndFlush(new OrganizationMembership(fixture.organization(), "Invited",
        "Worker", "invite-" + UUID.randomUUID() + "@example.com"));
    var activeUser = new UserAccount("active-" + UUID.randomUUID() + "@example.com", "hash");
    activeUser.verifyEmail();
    users.saveAndFlush(activeUser);
    var active = memberships.saveAndFlush(new OrganizationMembership(
        fixture.organization(), activeUser, MembershipRole.EMPLOYEE));
    UUID assignmentId = UUID.randomUUID();
    jdbc.update("insert into staffing_assignments(id,requirement_id,membership_id,assignment_status,assigned_by_membership_id,created_at,updated_at) values(?,?,?,'ASSIGNED',?,current_timestamp,current_timestamp)",
        assignmentId, requirementId, invited.getId(), fixture.owner().getId());
    jdbc.update("insert into staffing_assignments(id,requirement_id,membership_id,assignment_status,assigned_by_membership_id,created_at,updated_at) values(?,?,?,'ASSIGNED',?,current_timestamp,current_timestamp)",
        UUID.randomUUID(), requirementId, active.getId(), fixture.owner().getId());
    var canonical = coverage.calculate(fixture.organizationId(), fixture.unitId(), fixture.planId());
    Set<String> acknowledged = canonical.issues().stream()
        .filter(StaffingPlanCoverageService.PlanningIssue::acknowledgementRequired)
        .map(StaffingPlanCoverageService.PlanningIssue::issueKey)
        .collect(java.util.stream.Collectors.toSet());
    var result = publication.publishPlan(command(fixture, fixture.planRevision(), acknowledged, null,
        "invite-key"));
    assertThat(result.legacyCoverage().required()).isEqualTo(canonical.required());
    assertThat(result.legacyCoverage().assigned()).isEqualTo(canonical.effectiveAssigned());
    assertThat(result.legacyCoverage().percentage()).isEqualByComparingTo(canonical.percentage());
    assertThat(result.canonicalCoverage()).isEqualTo(
        new StaffingPlanPublicationService.CanonicalCoverage(canonical.required(),
            canonical.assigned(), canonical.effectiveAssigned(), canonical.covered(),
            canonical.missing(), canonical.overstaffed(), canonical.percentage()));
    assertThat(result.warningsAcknowledged()).containsExactlyInAnyOrderElementsOf(acknowledged);
    assertThat(jdbc.queryForObject("select membership_status_snapshot from staffing_plan_version_assignments where version_id=? and organization_membership_id=?",
        String.class, result.versionId(), invited.getId())).isEqualTo("ACTIVE");
  }

  @Test void atomicSnapshotPersistsRawEffectiveCoveredMissingAndOverstaffedSeparately() {
    Fixture fixture = fixture("canonical-snapshot");
    UUID requirementId = requirement(fixture);
    OrganizationMembership first = activeEmployee(fixture, "first-active");
    OrganizationMembership second = activeEmployee(fixture, "second-active");
    assignment(fixture, requirementId, first);
    assignment(fixture, requirementId, second);
    var invited = memberships.saveAndFlush(new OrganizationMembership(fixture.organization(),
        "Pending", "Worker", "pending-" + UUID.randomUUID() + "@example.com"));
    UUID invitedAssignment = UUID.randomUUID();
    jdbc.update("""
        insert into staffing_assignments(id,requirement_id,membership_id,assignment_status,
          assigned_by_membership_id,created_at,updated_at)
        values(?,?,?,'ASSIGNED',?,current_timestamp,current_timestamp)
        """, invitedAssignment, requirementId, invited.getId(), fixture.owner().getId());

    var canonical = coverage.calculate(fixture.organizationId(), fixture.unitId(), fixture.planId());
    assertThat(canonical.required()).isEqualTo(1);
    assertThat(canonical.assigned()).isEqualTo(3);
    assertThat(canonical.effectiveAssigned()).isEqualTo(3);
    assertThat(canonical.covered()).isEqualTo(1);
    assertThat(canonical.missing()).isZero();
    assertThat(canonical.overstaffed()).isEqualTo(2);

    var result = publication.publishPlan(command(fixture, fixture.planRevision(),
        Set.of("OVERSTAFFING:" + requirementId), null, "canonical-snapshot-key"));

    assertThat(result.legacyCoverage().assigned()).isEqualTo(3);
    assertThat(result.canonicalCoverage()).isEqualTo(
        new StaffingPlanPublicationService.CanonicalCoverage(1, 3, 3, 1, 0, 2,
            canonical.percentage()));
    assertThat(jdbc.queryForMap("""
        select coverage_assigned, coverage_raw_assigned, coverage_effective_assigned,
          coverage_covered, coverage_missing, coverage_overstaffed
        from staffing_plan_versions where id=?
        """, result.versionId())).containsAllEntriesOf(Map.of(
            "coverage_assigned", 3,
            "coverage_raw_assigned", 3,
            "coverage_effective_assigned", 3,
            "coverage_covered", 1,
            "coverage_missing", 0,
            "coverage_overstaffed", 2));
    assertThat(jdbc.queryForMap("""
        select sum(required)::int required,sum(raw_assigned)::int raw_assigned,
          sum(effective_assigned)::int effective_assigned,sum(covered)::int covered,
          sum(missing)::int missing,sum(overstaffed)::int overstaffed,
          sum(open_positions)::int open_positions
        from staffing_plan_version_requirement_coverage where version_id=?
        """, result.versionId())).containsAllEntriesOf(Map.of(
            "required", 1, "raw_assigned", 3, "effective_assigned", 3,
            "covered", 1, "missing", 0, "overstaffed", 2, "open_positions", 0));
    assertThat(jdbc.queryForMap("""
        select count(*)::int days,sum(required)::int required,
          sum(raw_assigned)::int raw_assigned,sum(effective_assigned)::int effective_assigned,
          sum(covered)::int covered,sum(missing)::int missing,
          sum(overstaffed)::int overstaffed,sum(open_positions)::int open_positions
        from staffing_plan_version_day_coverage where version_id=?
        """, result.versionId())).containsAllEntriesOf(Map.of(
            "days", 7, "required", 1, "raw_assigned", 3, "effective_assigned", 3,
            "covered", 1, "missing", 0, "overstaffed", 2, "open_positions", 0));
  }

  @Test void warningsRequireAcknowledgementAndFailuresRollbackOperation() {
    Fixture fixture = fixture("warnings");
    UUID requirementId = requirement(fixture);
    assertThatThrownBy(() -> publication.publishPlan(command(fixture, fixture.planRevision(), Set.of(), null,
        "warning-key"))).isInstanceOf(ConflictException.class).hasMessageContaining("acknowledged");
    assertThat(jdbc.queryForObject("select count(*) from staffing_plan_publication_operations where plan_id=?",
        Integer.class, fixture.planId())).isZero();
    var original = command(fixture, fixture.planRevision(), Set.of("UNDERCOVERAGE:" + requirementId),
        null, "warning-key");
    publication.publishPlan(original);
    assertThatThrownBy(() -> publication.publishPlan(command(fixture, fixture.planRevision(),
        Set.of("UNDERCOVERAGE:" + requirementId), "different", "warning-key")))
        .isInstanceOf(ConflictException.class).hasMessageContaining("another request");
  }

  @Test void publicationNoteIsCanonicalUnicodeSafeAndPartOfIdempotency() {
    Fixture fixture = fixture("publication-note");
    UUID requirementId = requirement(fixture);
    Set<String> warnings = Set.of("UNDERCOVERAGE:" + requirementId);

    var first = publication.publishPlan(command(fixture, fixture.planRevision(), warnings,
        "  Verifică\t planul\n înainte   de publicare  ", "canonical-note"));
    var replay = publication.publishPlan(command(fixture, fixture.planRevision(), warnings,
        "Verifică planul înainte de publicare", "canonical-note"));

    assertThat(replay.versionId()).isEqualTo(first.versionId());
    assertThat(replay.idempotentReplay()).isTrue();
    assertThat(jdbc.queryForObject(
        "select publication_note from staffing_plan_versions where id=?", String.class,
        first.versionId())).isEqualTo("Verifică planul înainte de publicare");
    assertThatThrownBy(() -> publication.publishPlan(command(fixture, fixture.planRevision(),
        warnings, "Altă notă", "canonical-note")))
        .isInstanceOf(ConflictException.class).hasMessageContaining("another request");

    Fixture invalid = fixture("publication-note-control");
    UUID invalidRequirement = requirement(invalid);
    assertThatThrownBy(() -> publication.publishPlan(command(invalid, invalid.planRevision(),
        Set.of("UNDERCOVERAGE:" + invalidRequirement), "unsafe\u0000note", "control-note")))
        .isInstanceOf(ValidationException.class).hasMessageContaining("control characters");
    assertThat(jdbc.queryForObject("select count(*) from staffing_plan_versions where plan_id=?",
        Integer.class, invalid.planId())).isZero();
  }

  @Test void acknowledgementsMustMatchEveryCurrentWarningAndNeverAcknowledgeBlockers() {
    Fixture fixture = fixture("acknowledgements");
    UUID firstRequirement = requirement(fixture);
    UUID secondRequirement = additionalRequirement(fixture, firstRequirement, fixture.planDayId(), WEEK);
    String firstWarning = "UNDERCOVERAGE:" + firstRequirement;
    String secondWarning = "UNDERCOVERAGE:" + secondRequirement;

    assertThatThrownBy(() -> publication.publishPlan(command(fixture, fixture.planRevision(),
        Set.of("UNDERCOVERAGE:" + UUID.randomUUID()), null, "unknown-warning")))
        .isInstanceOf(ValidationException.class).hasMessageContaining("current review");
    assertThatThrownBy(() -> publication.publishPlan(command(fixture, fixture.planRevision(),
        Set.of(firstWarning), null, "incomplete-warnings")))
        .isInstanceOfSatisfying(ConflictException.class,
            exception -> assertThat(exception.getErrors()).containsExactly(secondWarning));

    var result = publication.publishPlan(command(fixture, fixture.planRevision(),
        Set.of(firstWarning, secondWarning), null, "complete-warnings"));
    assertThat(jdbc.queryForList("""
        select issue_key from staffing_plan_version_acknowledgements
        where version_id=? order by issue_key
        """, String.class, result.versionId())).containsExactlyInAnyOrder(firstWarning, secondWarning);

    Fixture blocker = fixture("acknowledge-blocker");
    UUID blockerRequirement = requirement(blocker);
    jdbc.update("""
        update organization_work_types set active=false
        where id=(select work_type_id from staffing_requirements where id=?)
        """, blockerRequirement);
    assertThatThrownBy(() -> publication.publishPlan(command(blocker, blocker.planRevision(),
        Set.of("INACTIVE_WORK_TYPE:" + blockerRequirement), null, "blocker-as-warning")))
        .isInstanceOf(ConflictException.class).hasMessageContaining("blocking");
    assertThat(jdbc.queryForObject("""
        select count(*) from staffing_plan_version_acknowledgements acknowledgement
        join staffing_plan_versions version on version.id=acknowledgement.version_id
        where version.plan_id=?
        """, Integer.class, blocker.planId())).isZero();
  }

  @Test void warningThatDisappearedBeforePublicationCannotBeAcknowledged() {
    Fixture fixture = fixture("disappeared-warning");
    UUID requirementId = requirement(fixture);
    OrganizationMembership worker = activeEmployee(fixture, "warning-resolved");
    assignment(fixture, requirementId, worker);

    assertThatThrownBy(() -> publication.publishPlan(command(fixture, fixture.planRevision(),
        Set.of("UNDERCOVERAGE:" + requirementId), null, "stale-warning")))
        .isInstanceOf(ValidationException.class).hasMessageContaining("current review");
    assertThat(jdbc.queryForObject("select count(*) from staffing_plan_versions where plan_id=?",
        Integer.class, fixture.planId())).isZero();
  }

  @Test void blockerLeavesNoVersionOrOperation() {
    Fixture fixture = fixture("blocker");
    UUID requirementId = requirement(fixture);
    jdbc.update("update organization_work_types set active=false where id=(select work_type_id from staffing_requirements where id=?)",
        requirementId);
    assertThatThrownBy(() -> publication.publishPlan(command(fixture, fixture.planRevision(), Set.of(), null,
        "blocked-key"))).isInstanceOf(ConflictException.class).hasMessageContaining("blocking");
    assertThat(jdbc.queryForObject("select count(*) from staffing_plan_versions where plan_id=?", Integer.class,
        fixture.planId())).isZero();
    assertThat(jdbc.queryForObject("select count(*) from staffing_plan_publication_operations where plan_id=?",
        Integer.class, fixture.planId())).isZero();
  }

  @Test void failuresAfterEachSnapshotBoundaryRollbackEverything() {
    for (var stage : StaffingPlanPublicationFaultProbe.Stage.values()) {
      Fixture fixture = fixture("rollback-" + stage);
      UUID requirementId = requirement(fixture);
      faultProbe.failAt = stage;
      assertThatThrownBy(() -> publication.publishPlan(command(fixture, fixture.planRevision(),
          Set.of("UNDERCOVERAGE:" + requirementId), null, "rollback-" + stage)))
          .isInstanceOf(InjectedPublicationFailure.class);
      faultProbe.failAt = null;
      assertThat(jdbc.queryForObject("select count(*) from staffing_plan_versions where plan_id=?",
          Integer.class, fixture.planId())).isZero();
      assertThat(jdbc.queryForObject("select count(*) from staffing_plan_publication_operations where plan_id=?",
          Integer.class, fixture.planId())).isZero();
      assertThat(jdbc.queryForObject("select count(*) from staffing_plan_version_requirement_coverage c join staffing_plan_versions v on v.id=c.version_id where v.plan_id=?",
          Integer.class, fixture.planId())).isZero();
      assertThat(jdbc.queryForObject("select count(*) from staffing_plan_version_day_coverage c join staffing_plan_versions v on v.id=c.version_id where v.plan_id=?",
          Integer.class, fixture.planId())).isZero();
      assertThat(jdbc.queryForObject("select latest_published_version_id is null from staffing_plans where id=?",
          Boolean.class, fixture.planId())).isTrue();
    }
  }

  @Test void authorizationDistinguishesForbiddenFromHiddenScope() {
    Fixture fixture = fixture("authorization");
    UUID requirementId = requirement(fixture);
    var employeeUser = new UserAccount("employee-" + UUID.randomUUID() + "@example.com", "hash");
    employeeUser.verifyEmail(); users.saveAndFlush(employeeUser);
    var employee = memberships.saveAndFlush(new OrganizationMembership(
        fixture.organization(), employeeUser, MembershipRole.EMPLOYEE));
    authenticate(employeeUser);
    assertThatThrownBy(() -> publication.publishPlan(new PublishCommand(fixture.organizationId(),
        fixture.unitId(), fixture.planId(), fixture.planRevision(), employee.getId(),
        Set.of("UNDERCOVERAGE:" + requirementId), null, "forbidden")))
        .isInstanceOf(AccessDeniedException.class);

    Fixture other = fixture("other-tenant");
    authenticate(fixture.user());
    assertThatThrownBy(() -> publication.publishPlan(new PublishCommand(other.organizationId(),
        other.unitId(), fixture.planId(), fixture.planRevision(), fixture.owner().getId(), Set.of(),
        null, "hidden"))).isInstanceOf(NotFoundException.class);

    Fixture suspended = fixture("suspended-publisher");
    UUID suspendedRequirement = requirement(suspended);
    jdbc.update("update organization_memberships set membership_status='SUSPENDED' where id=?",
        suspended.owner().getId());
    entityManager.clear();
    authenticate(suspended.user());
    assertThatThrownBy(() -> publication.publishPlan(command(suspended, suspended.planRevision(),
        Set.of("UNDERCOVERAGE:" + suspendedRequirement), null, "suspended")))
        .isInstanceOf(NotFoundException.class);

    Fixture invitedPublisher = fixture("invited-publisher");
    UUID invitedRequirement = requirement(invitedPublisher);
    jdbc.update("update organization_memberships set membership_status='INVITED' where id=?",
        invitedPublisher.owner().getId());
    entityManager.clear();
    authenticate(invitedPublisher.user());
    assertThatThrownBy(() -> publication.publishPlan(command(invitedPublisher,
        invitedPublisher.planRevision(), Set.of("UNDERCOVERAGE:" + invitedRequirement), null,
        "invited-publisher"))).isInstanceOf(NotFoundException.class);
  }

  @Test void completedReplayStillRequiresCurrentActivePublisherAndPermission() {
    Fixture suspended = fixture("replay-suspended");
    UUID suspendedRequirement = requirement(suspended);
    PublishCommand suspendedCommand = command(suspended, suspended.planRevision(),
        Set.of("UNDERCOVERAGE:" + suspendedRequirement), null, "replay-suspended-key");
    publication.publishPlan(suspendedCommand);
    jdbc.update("update organization_memberships set membership_status='SUSPENDED' where id=?",
        suspended.owner().getId());
    entityManager.clear();
    authenticate(suspended.user());
    assertThatThrownBy(() -> publication.publishPlan(suspendedCommand))
        .isInstanceOf(NotFoundException.class);

    Fixture permissionLost = fixture("replay-permission-lost");
    UUID permissionRequirement = requirement(permissionLost);
    PublishCommand permissionCommand = command(permissionLost, permissionLost.planRevision(),
        Set.of("UNDERCOVERAGE:" + permissionRequirement), null, "replay-permission-key");
    publication.publishPlan(permissionCommand);
    jdbc.update("update organization_memberships set membership_role='EMPLOYEE' where id=?",
        permissionLost.owner().getId());
    entityManager.clear();
    authenticate(permissionLost.user());
    assertThatThrownBy(() -> publication.publishPlan(permissionCommand))
        .isInstanceOf(AccessDeniedException.class);
  }

  @Test void atomicSnapshotContainsTheCompleteExistingPlanWithoutChangingLegacyStatus() {
    Fixture fixture = fixture("complete-snapshot");
    UUID firstRequirement = requirement(fixture);
    UUID secondDay = foundation.createDay(fixture.organizationId(), fixture.unitId(), fixture.planId(),
        WEEK.plusDays(1), 40, "Tuesday context", StaffingPlanDaySource.MANUAL,
        fixture.owner().getId()).getId();
    UUID secondRequirement = additionalRequirement(fixture, firstRequirement, secondDay,
        WEEK.plusDays(1));
    OrganizationMembership worker = activeEmployee(fixture, "snapshot-worker");
    UUID assignmentId = assignment(fixture, firstRequirement, worker);
    UUID dayEntryId = UUID.randomUUID();
    jdbc.update("""
        insert into staffing_member_day_entries(id,organization_id,membership_id,work_date,
          entry_type,notes,created_by_membership_id,created_at,updated_at)
        values(?,?,?,?,'REST_DAY','Tuesday rest',?,current_timestamp,current_timestamp)
        """, dayEntryId, fixture.organizationId(), worker.getId(), WEEK.plusDays(1),
        fixture.owner().getId());
    long revision = jdbc.queryForObject("select draft_revision from staffing_plans where id=?",
        Long.class, fixture.planId());

    var result = publication.publishPlan(command(fixture, revision,
        Set.of("UNDERCOVERAGE:" + secondRequirement), "Complete snapshot", "complete-snapshot-key"));

    Map<String, Object> header = jdbc.queryForMap("""
        select publication_kind,coverage_basis,source_draft_complete,
          published_by_membership_id,publication_note
        from staffing_plan_versions where id=?
        """, result.versionId());
    assertThat(header.get("publication_kind")).isEqualTo("ATOMIC_WEEKLY");
    assertThat(header.get("coverage_basis")).isEqualTo("CANONICAL_REQUIREMENT_V1");
    assertThat(header.get("source_draft_complete")).isEqualTo(true);
    assertThat(header.get("published_by_membership_id")).isEqualTo(fixture.owner().getId());
    assertThat(header.get("publication_note")).isEqualTo("Complete snapshot");
    assertThat(jdbc.queryForObject("select count(*) from staffing_plan_version_days where version_id=?",
        Integer.class, result.versionId())).isEqualTo(2);
    assertThat(jdbc.queryForList("""
        select source_requirement_id from staffing_plan_version_requirements
        where version_id=? order by source_requirement_id
        """, UUID.class, result.versionId())).containsExactlyInAnyOrder(firstRequirement, secondRequirement);
    assertThat(jdbc.queryForList("""
        select source_assignment_id from staffing_plan_version_assignments where version_id=?
        """, UUID.class, result.versionId())).containsExactly(assignmentId);
    assertThat(jdbc.queryForList("""
        select source_day_entry_id from staffing_plan_version_member_days where version_id=?
        """, UUID.class, result.versionId())).containsExactly(dayEntryId);
    assertThat(jdbc.queryForList("""
        select distinct legacy_publication_status from staffing_plan_version_requirements where version_id=?
        """, String.class, result.versionId())).containsExactly("DRAFT");
    assertThat(jdbc.queryForList("""
        select distinct publication_status from staffing_requirements where id in (?,?)
        """, String.class, firstRequirement, secondRequirement)).containsExactly("DRAFT");
  }

  @Test void concurrentSameKeyReplaysAndDifferentKeysConflict() throws Exception {
    Fixture fixture = fixture("concurrent-same");
    UUID requirementId = requirement(fixture);
    PublishCommand same = command(fixture, fixture.planRevision(),
        Set.of("UNDERCOVERAGE:" + requirementId), null, "same-key");
    List<Object> sameResults = concurrent(fixture.user(), same, same);
    assertThat(sameResults).allMatch(value -> value instanceof StaffingPlanPublicationService.PublicationResult);
    var publications = sameResults.stream().map(StaffingPlanPublicationService.PublicationResult.class::cast).toList();
    assertThat(publications).extracting(StaffingPlanPublicationService.PublicationResult::versionId)
        .containsOnly(publications.getFirst().versionId());
    assertThat(publications).extracting(StaffingPlanPublicationService.PublicationResult::idempotentReplay)
        .containsExactlyInAnyOrder(false, true);

    Fixture different = fixture("concurrent-different");
    UUID differentRequirement = requirement(different);
    PublishCommand first = command(different, different.planRevision(),
        Set.of("UNDERCOVERAGE:" + differentRequirement), null, "different-1");
    PublishCommand second = command(different, different.planRevision(),
        Set.of("UNDERCOVERAGE:" + differentRequirement), null, "different-2");
    List<Object> results = concurrent(different.user(), first, second);
    assertThat(results.stream().filter(StaffingPlanPublicationService.PublicationResult.class::isInstance)).hasSize(1);
    assertThat(results.stream().filter(ConflictException.class::isInstance)).hasSize(1);
    assertThat(jdbc.queryForObject("select count(*) from staffing_plan_versions where plan_id=?", Integer.class,
        different.planId())).isEqualTo(1);
  }

  @Test void differentPlansPublishIndependently() throws Exception {
    Fixture first = fixture("parallel-first");
    Fixture second = fixture("parallel-second");
    UUID firstRequirement = requirement(first);
    UUID secondRequirement = requirement(second);

    List<Object> results = concurrent(first.user(), command(first, first.planRevision(),
        Set.of("UNDERCOVERAGE:" + firstRequirement), null, "parallel-first"), second.user(),
        command(second, second.planRevision(), Set.of("UNDERCOVERAGE:" + secondRequirement), null,
            "parallel-second"));

    assertThat(results).allMatch(
        StaffingPlanPublicationService.PublicationResult.class::isInstance);
    assertThat(jdbc.queryForObject("select count(*) from staffing_plan_versions where plan_id=?",
        Integer.class, first.planId())).isEqualTo(1);
    assertThat(jdbc.queryForObject("select count(*) from staffing_plan_versions where plan_id=?",
        Integer.class, second.planId())).isEqualTo(1);
  }

  @Test void mutationCoordinatorSerializesConcurrentDraftChangesAndRejectsStaleRevision()
      throws Exception {
    Fixture fixture = fixture("mutation-concurrency");
    long initial = fixture.planRevision();
    var scope = new StaffingPlanMutationCoordinator.Scope(fixture.planId(), fixture.unitId());
    ExecutorService executor = Executors.newFixedThreadPool(2);
    CountDownLatch ready = new CountDownLatch(2);
    CountDownLatch start = new CountDownLatch(1);
    try {
      List<Future<StaffingPlanMutationCoordinator.MutationResult<String>>> futures =
          java.util.stream.IntStream.range(0, 2).mapToObj(index -> executor.submit(() -> {
            var actor = memberships.findByIdAndOrganizationId(
                fixture.owner().getId(), fixture.organizationId()).orElseThrow();
            ready.countDown();
            start.await(10, TimeUnit.SECONDS);
            return mutations.mutateScopes(fixture.organizationId(), List.of(scope), actor, null,
                () -> StaffingPlanMutationCoordinator.Change.changed("change-" + index));
          })).toList();
      assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
      start.countDown();
      for (var future : futures) assertThat(future.get(20, TimeUnit.SECONDS).changed()).isTrue();
    } finally {
      executor.shutdownNow();
    }
    assertThat(jdbc.queryForObject("select draft_revision from staffing_plans where id=?",
        Long.class, fixture.planId())).isEqualTo(initial + 2);

    var actor = memberships.findByIdAndOrganizationId(
        fixture.owner().getId(), fixture.organizationId()).orElseThrow();
    long current = initial + 2;
    var changed = mutations.mutateScopes(fixture.organizationId(), List.of(scope), actor, current,
        () -> StaffingPlanMutationCoordinator.Change.changed("guarded"));
    assertThat(changed.currentRevisions()).containsEntry(fixture.planId(), current + 1);
    assertThat(StaffingPlanMutationCoordinator.etag(fixture.planId(), current + 1))
        .isEqualTo("\"plan-" + fixture.planId() + "-r" + (current + 1) + "\"");
    assertThatThrownBy(() -> mutations.mutateScopes(
        fixture.organizationId(), List.of(scope), actor, current,
        () -> StaffingPlanMutationCoordinator.Change.changed("stale")))
        .isInstanceOf(PreconditionFailedException.class);
  }

  @Test void mutationBeforePublishMakesTheOldRevisionStale() throws Exception {
    Fixture fixture = fixture("mutation-wins");
    UUID requirementId = requirement(fixture);
    long expected = fixture.planRevision();
    mutationFaultProbe.pause();
    ExecutorService executor = Executors.newFixedThreadPool(2);
    try {
      Future<?> mutation = executor.submit(() -> {
        authenticate(fixture.user());
        try {
          return draftMutations.updateRequirement(fixture.organizationId(), fixture.planId(),
              requirementId, StaffingPlanMutationCoordinator.etag(fixture.planId(), expected),
              new RequirementUpdateInput(java.time.LocalTime.of(10, 0),
                  java.time.LocalTime.of(18, 0), 2, java.math.BigDecimal.valueOf(2),
                  "manager edit"));
        } finally {
          SecurityContextHolder.clearContext();
        }
      });
      assertThat(mutationFaultProbe.awaitPause()).isTrue();
      Future<Object> publish = executor.submit(() -> {
        authenticate(fixture.user());
        try {
          return publication.publishPlan(command(fixture, expected,
              Set.of("UNDERCOVERAGE:" + requirementId), null, "mutation-wins"));
        } catch (RuntimeException exception) {
          return exception;
        } finally {
          SecurityContextHolder.clearContext();
        }
      });
      mutationFaultProbe.release();
      mutation.get(20, TimeUnit.SECONDS);
      assertThat(publish.get(20, TimeUnit.SECONDS)).isInstanceOf(PreconditionFailedException.class);
    } finally {
      mutationFaultProbe.release();
      executor.shutdownNow();
    }
    assertThat(jdbc.queryForObject("select draft_revision from staffing_plans where id=?",
        Long.class, fixture.planId())).isEqualTo(expected + 1);
    assertThat(jdbc.queryForObject("select count(*) from staffing_plan_versions where plan_id=?",
        Integer.class, fixture.planId())).isZero();
  }

  @Test void publishBeforeMutationKeepsSnapshotCoherentAndLeavesUnpublishedChanges()
      throws Exception {
    Fixture fixture = fixture("publish-wins");
    UUID requirementId = requirement(fixture);
    long expected = fixture.planRevision();
    faultProbe.pauseAt(StaffingPlanPublicationFaultProbe.Stage.AFTER_HEADER);
    ExecutorService executor = Executors.newFixedThreadPool(2);
    try {
      Future<StaffingPlanPublicationService.PublicationResult> publish = executor.submit(() -> {
        authenticate(fixture.user());
        try {
          return publication.publishPlan(command(fixture, expected,
              Set.of("UNDERCOVERAGE:" + requirementId), null, "publish-wins"));
        } finally {
          SecurityContextHolder.clearContext();
        }
      });
      assertThat(faultProbe.awaitPause()).isTrue();
      Future<?> mutation = executor.submit(() -> {
        authenticate(fixture.user());
        try {
          return draftMutations.updateRequirement(fixture.organizationId(), fixture.planId(),
              requirementId, StaffingPlanMutationCoordinator.etag(fixture.planId(), expected),
              new RequirementUpdateInput(java.time.LocalTime.of(10, 0),
                  java.time.LocalTime.of(18, 0), 2, java.math.BigDecimal.valueOf(2),
                  "post-publish edit"));
        } finally {
          SecurityContextHolder.clearContext();
        }
      });
      faultProbe.release();
      var published = publish.get(20, TimeUnit.SECONDS);
      mutation.get(20, TimeUnit.SECONDS);
      assertThat(published.publishedRevision()).isEqualTo(expected);
    } finally {
      faultProbe.release();
      executor.shutdownNow();
    }
    assertThat(jdbc.queryForObject("select draft_revision from staffing_plans where id=?",
        Long.class, fixture.planId())).isEqualTo(expected + 1);
    assertThat(jdbc.queryForObject(
        "select draft_revision > published_revision from staffing_plans where id=?",
        Boolean.class, fixture.planId())).isTrue();
    assertThat(jdbc.queryForObject(
        "select count(*) from staffing_plan_version_requirements where version_id=(select latest_published_version_id from staffing_plans where id=?)",
        Integer.class, fixture.planId())).isEqualTo(1);
  }

  @Test void multiPlanLocksUseOneOrderAndRollbackRestoresChildrenAndRevisions() throws Exception {
    Fixture fixture = fixture("lock-order");
    UUID requirementId = requirement(fixture);
    var secondPlan = foundation.getOrCreate(fixture.organizationId(), fixture.unitId(),
        WEEK.plusWeeks(1), fixture.owner().getId());
    foundation.createDay(fixture.organizationId(), fixture.unitId(), secondPlan.getId(),
        WEEK.plusWeeks(1), 20, null, StaffingPlanDaySource.MANUAL, fixture.owner().getId());
    List<StaffingPlanMutationCoordinator.Scope> forward = List.of(
        new StaffingPlanMutationCoordinator.Scope(fixture.planId(), fixture.unitId()),
        new StaffingPlanMutationCoordinator.Scope(secondPlan.getId(), fixture.unitId()));
    List<StaffingPlanMutationCoordinator.Scope> reverse = List.of(forward.get(1), forward.get(0));
    Map<UUID, Long> before = Map.of(
        fixture.planId(), revision(fixture.planId()),
        secondPlan.getId(), revision(secondPlan.getId()));
    ExecutorService executor = Executors.newFixedThreadPool(2);
    CountDownLatch start = new CountDownLatch(1);
    try {
      var results = List.of(forward, reverse).stream().map(scopes -> executor.submit(() -> {
        var actor = memberships.findByIdAndOrganizationId(
            fixture.owner().getId(), fixture.organizationId()).orElseThrow();
        await(start);
        return mutations.mutateScopes(fixture.organizationId(), scopes, actor, null,
            () -> StaffingPlanMutationCoordinator.Change.changed("two-plan edit"));
      })).toList();
      start.countDown();
      for (Future<?> result : results) result.get(20, TimeUnit.SECONDS);
    } finally {
      start.countDown();
      executor.shutdownNow();
    }
    assertThat(revision(fixture.planId())).isEqualTo(before.get(fixture.planId()) + 2);
    assertThat(revision(secondPlan.getId())).isEqualTo(before.get(secondPlan.getId()) + 2);

    long beforeRollback = revision(fixture.planId());
    assertThatThrownBy(() -> mutations.mutateScopes(fixture.organizationId(),
        List.of(forward.getFirst()), fixture.owner(), null, () -> {
          jdbc.update("update staffing_requirements set notes='must rollback' where id=?", requirementId);
          throw new InjectedPublicationFailure();
        })).isInstanceOf(InjectedPublicationFailure.class);
    assertThat(jdbc.queryForObject("select notes from staffing_requirements where id=?",
        String.class, requirementId)).isNull();
    assertThat(revision(fixture.planId())).isEqualTo(beforeRollback);
  }

  @Test void sourceFingerprintTracksPlanningDataAndExcludesOperationalActuals() {
    Fixture fixture = fixture("source-guard");
    UUID requirementId = requirement(fixture);
    OrganizationMembership employee = activeEmployee(fixture, "source-employee");
    UUID assignmentId = assignment(fixture, requirementId, employee);
    String original = sourceFingerprint(fixture);

    UUID resultId = UUID.randomUUID();
    jdbc.update("""
        insert into staffing_assignment_results(id,assignment_id,actual_start_time,actual_end_time,
          break_minutes,completed_quantity,notes,approval_status,checked_in_at,checked_out_at,
          time_capture_source,created_at,updated_at)
        values(?,?,'09:05','16:35',30,12,'operational actual','APPROVED',current_timestamp,
          current_timestamp,'CHECK_IN',current_timestamp,current_timestamp)
        """, resultId, assignmentId);
    assertThat(sourceFingerprint(fixture)).isEqualTo(original);

    long revisionBeforeDay = revision(fixture.planId());
    foundation.createDay(fixture.organizationId(), fixture.unitId(), fixture.planId(),
        WEEK.plusDays(1), 24, "late hotel context", StaffingPlanDaySource.MANUAL,
        fixture.owner().getId());
    String withPlanDay = sourceFingerprint(fixture);
    assertThat(withPlanDay).isNotEqualTo(original);
    assertThat(revision(fixture.planId())).isEqualTo(revisionBeforeDay + 1);

    jdbc.update("update staffing_requirements set notes='planning source changed' where id=?",
        requirementId);
    assertThat(sourceFingerprint(fixture)).isNotEqualTo(withPlanDay);
  }

  @Test void sourceSnapshotLabelsHaveNoUncoordinatedDomainRenamePath() {
    assertThat(Arrays.stream(OrganizationUnit.class.getDeclaredMethods())
        .filter(method -> java.lang.reflect.Modifier.isPublic(method.getModifiers()))
        .map(java.lang.reflect.Method::getName))
        .doesNotContain("rename", "updateName", "update");
    assertThat(Arrays.stream(OrganizationMembership.class.getDeclaredMethods())
        .filter(method -> java.lang.reflect.Modifier.isPublic(method.getModifiers()))
        .map(java.lang.reflect.Method::getName))
        .doesNotContain("rename", "updateName", "updateProfile", "update");
    assertThat(Arrays.stream(com.alveryn.api.staffing.entity.StaffingPlanDay.class
        .getDeclaredMethods())
        .filter(method -> java.lang.reflect.Modifier.isPublic(method.getModifiers()))
        .map(java.lang.reflect.Method::getName))
        .doesNotContain("updateContext", "changeDate", "reparent");
  }

  private Fixture fixture(String label) {
    var user = new UserAccount(label + "-" + UUID.randomUUID() + "@example.com", "hash");
    user.verifyEmail(); users.saveAndFlush(user);
    var organization = organizations.saveAndFlush(new Organization("Business " + label, "Europe/Berlin"));
    var owner = memberships.saveAndFlush(new OrganizationMembership(organization, user, MembershipRole.OWNER));
    var unit = units.saveAndFlush(new OrganizationUnit(organization, null, "Hotel " + label,
        OrganizationUnitType.LOCATION, CheckInMode.OPTIONAL, 0));
    authenticate(user);
    var plan = foundation.getOrCreate(organization.getId(), unit.getId(), WEEK, owner.getId());
    var day = foundation.createDay(organization.getId(), unit.getId(), plan.getId(), WEEK, 50, null,
        StaffingPlanDaySource.MANUAL, owner.getId());
    long revision = jdbc.queryForObject("select draft_revision from staffing_plans where id=?",
        Long.class, plan.getId());
    return new Fixture(organization, owner, user, unit.getId(), plan.getId(), day.getId(), revision);
  }

  private UUID requirement(Fixture fixture) {
    UUID workType = UUID.randomUUID();
    jdbc.update("insert into organization_work_types(id,organization_id,unit_id,code,name,color,default_start_time,default_end_time,default_break_minutes,active,calculation_method,compensation_method,teamwork_enabled,extra_pay_enabled,composite_enabled,display_order,created_at,updated_at) values(?,?,?,'ROOM','Room cleaning','#10B981','09:00','16:30',30,true,'TIME_BASED','HOURLY',false,false,false,0,current_timestamp,current_timestamp)",
        workType, fixture.organizationId(), fixture.unitId());
    UUID id = UUID.randomUUID();
    jdbc.update("insert into staffing_requirements(id,organization_id,unit_id,work_type_id,work_date,start_time,end_time,required_workers,publication_status,created_by_membership_id,plan_day_id,created_at,updated_at) values(?,?,?,?,?,'09:00','16:30',1,'DRAFT',?,?,current_timestamp,current_timestamp)",
        id, fixture.organizationId(), fixture.unitId(), workType, WEEK, fixture.owner().getId(),
        fixture.planDayId());
    return id;
  }

  private UUID additionalRequirement(Fixture fixture, UUID existingRequirement, UUID planDayId,
      LocalDate workDate) {
    UUID workType = jdbc.queryForObject(
        "select work_type_id from staffing_requirements where id=?", UUID.class, existingRequirement);
    UUID id = UUID.randomUUID();
    jdbc.update("""
        insert into staffing_requirements(id,organization_id,unit_id,work_type_id,work_date,
          start_time,end_time,required_workers,publication_status,created_by_membership_id,
          plan_day_id,created_at,updated_at)
        values(?,?,?,?,?,'09:00','16:30',1,'DRAFT',?,?,current_timestamp,current_timestamp)
        """, id, fixture.organizationId(), fixture.unitId(), workType, workDate,
        fixture.owner().getId(), planDayId);
    return id;
  }

  private OrganizationMembership activeEmployee(Fixture fixture, String label) {
    var user = new UserAccount(label + "-" + UUID.randomUUID() + "@example.com", "hash");
    user.verifyEmail();
    users.saveAndFlush(user);
    return memberships.saveAndFlush(new OrganizationMembership(
        fixture.organization(), user, MembershipRole.EMPLOYEE));
  }

  private UUID assignment(Fixture fixture, UUID requirementId, OrganizationMembership member) {
    UUID id = UUID.randomUUID();
    jdbc.update("""
        insert into staffing_assignments(id,requirement_id,membership_id,assignment_status,
          assigned_by_membership_id,created_at,updated_at)
        values(?,?,?,'ASSIGNED',?,current_timestamp,current_timestamp)
        """, id, requirementId, member.getId(), fixture.owner().getId());
    return id;
  }

  private PublishCommand command(Fixture f, long revision, Set<String> acks, String note, String key) {
    return new PublishCommand(f.organizationId(), f.unitId(), f.planId(), revision, f.owner().getId(), acks,
        note, key);
  }

  private long revision(UUID planId) {
    return jdbc.queryForObject("select draft_revision from staffing_plans where id=?",
        Long.class, planId);
  }

  private void assertNoPartialPublication(Fixture fixture) {
    assertThat(jdbc.queryForObject(
        "select count(*) from staffing_plan_versions where plan_id=?", Integer.class,
        fixture.planId())).isZero();
    assertThat(jdbc.queryForObject(
        "select count(*) from staffing_plan_publication_operations where plan_id=?", Integer.class,
        fixture.planId())).isZero();
    assertThat(jdbc.queryForObject(
        "select latest_published_version_id is null from staffing_plans where id=?", Boolean.class,
        fixture.planId())).isTrue();
  }

  private static StaffingPlanCoverageService.CoverageResult withRequirementCoverage(
      StaffingPlanCoverageService.CoverageResult source,
      List<StaffingPlanCoverageService.RequirementCoverage> requirements) {
    return new StaffingPlanCoverageService.CoverageResult(source.planId(), source.organizationId(),
        source.unitId(), source.weekStart(), source.draftRevision(), source.required(),
        source.assigned(), source.effectiveAssigned(), source.covered(), source.missing(),
        source.overstaffed(), source.percentage(), source.openPositions(), requirements,
        source.dayCoverage(), source.issues(), source.blockingIssueCount(), source.warningCount(),
        source.informationCount(), source.publishable());
  }

  private static StaffingPlanCoverageService.RequirementCoverage withRequirementId(
      StaffingPlanCoverageService.RequirementCoverage source, UUID requirementId) {
    return new StaffingPlanCoverageService.RequirementCoverage(requirementId, source.planDayId(),
        source.date(), source.unitId(), source.unitName(), source.workTypeId(),
        source.workTypeCode(), source.workTypeName(), source.startTime(), source.endTime(),
        source.required(), source.assigned(), source.effectiveAssigned(), source.covered(),
        source.missing(), source.overstaffed(), source.percentage(), source.assignmentIds(),
        source.effectiveAssignmentIds(), source.issueKeys());
  }

  private String sourceFingerprint(Fixture fixture) {
    try {
      Object writer = applicationContext.getBean("staffingPlanPublicationWriter");
      var method = writer.getClass().getDeclaredMethod("sourceFingerprint",
          UUID.class, UUID.class, UUID.class);
      method.setAccessible(true);
      return (String) method.invoke(writer, fixture.organizationId(), fixture.unitId(),
          fixture.planId());
    } catch (ReflectiveOperationException exception) {
      throw new IllegalStateException("cannot inspect publication source fingerprint", exception);
    }
  }

  private String checksumInDatabaseTimezone(UUID versionId, String timezone) {
    return new TransactionTemplate(transactionManager).execute(status -> {
      jdbc.execute("set local time zone '" + timezone.replace("'", "''") + "'");
      try {
        Object writer = applicationContext.getBean("staffingPlanPublicationWriter");
        var method = writer.getClass().getDeclaredMethod("calculateAndStoreChecksum", UUID.class);
        method.setAccessible(true);
        return (String) method.invoke(writer, versionId);
      } catch (ReflectiveOperationException exception) {
        throw new IllegalStateException("cannot recalculate publication checksum", exception);
      }
    });
  }

  private static void await(CountDownLatch latch) {
    try {
      if (!latch.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("latch timed out");
    } catch (InterruptedException exception) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException("interrupted while awaiting test latch", exception);
    }
  }

  private void authenticate(UserAccount user) {
    var principal = new AuthenticatedUser(user.getId(), user.getEmail(), true, UserStatus.ACTIVE, UserRole.USER);
    SecurityContextHolder.getContext().setAuthentication(
        UsernamePasswordAuthenticationToken.authenticated(principal, "", principal.getAuthorities()));
  }

  private List<Object> concurrent(UserAccount user, PublishCommand first, PublishCommand second)
      throws Exception {
    return concurrent(user, first, user, second);
  }

  private List<Object> concurrent(UserAccount firstUser, PublishCommand first,
      UserAccount secondUser, PublishCommand second) throws Exception {
    ExecutorService executor = Executors.newFixedThreadPool(2);
    CountDownLatch ready = new CountDownLatch(2);
    CountDownLatch start = new CountDownLatch(1);
    try {
      List<ConcurrentCall> calls = List.of(new ConcurrentCall(firstUser, first),
          new ConcurrentCall(secondUser, second));
      List<Future<Object>> futures = calls.stream().map(call -> executor.submit(() -> {
        authenticate(call.user()); ready.countDown(); start.await(10, TimeUnit.SECONDS);
        try { return publication.publishPlan(call.command()); }
        catch (RuntimeException exception) { return exception; }
        finally { SecurityContextHolder.clearContext(); }
      })).toList();
      assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue(); start.countDown();
      return List.of(futures.get(0).get(20, TimeUnit.SECONDS), futures.get(1).get(20, TimeUnit.SECONDS));
    } finally { executor.shutdownNow(); }
  }

  private record Fixture(Organization organization, OrganizationMembership owner, UserAccount user, UUID unitId,
      UUID planId, UUID planDayId, long planRevision) {
    UUID organizationId() { return organization.getId(); }
  }

  private record ConcurrentCall(UserAccount user, PublishCommand command) {}

  @TestConfiguration
  static class FaultConfiguration {
    @Bean @Primary TestFaultProbe testFaultProbe() { return new TestFaultProbe(); }
    @Bean @Primary TestMutationFaultProbe testMutationFaultProbe() {
      return new TestMutationFaultProbe();
    }
  }

  static class TestFaultProbe implements StaffingPlanPublicationFaultProbe {
    volatile Stage failAt;
    volatile Stage pauseAt;
    volatile CountDownLatch paused = new CountDownLatch(1);
    volatile CountDownLatch resume = new CountDownLatch(1);
    @Override public void check(Stage stage) {
      if (stage == failAt) throw new InjectedPublicationFailure();
      if (stage == pauseAt) {
        paused.countDown();
        await(resume);
      }
    }
    void pauseAt(Stage stage) {
      pauseAt = stage;
      paused = new CountDownLatch(1);
      resume = new CountDownLatch(1);
    }
    boolean awaitPause() throws InterruptedException {
      return paused.await(10, TimeUnit.SECONDS);
    }
    void release() { resume.countDown(); }
    void reset() {
      release();
      failAt = null;
      pauseAt = null;
    }
  }

  static class InjectedPublicationFailure extends RuntimeException {}

  static class TestMutationFaultProbe implements StaffingPlanMutationFaultProbe {
    volatile boolean pause;
    volatile CountDownLatch paused = new CountDownLatch(1);
    volatile CountDownLatch resume = new CountDownLatch(1);

    @Override public void afterChildMutation() {
      if (pause) {
        paused.countDown();
        await(resume);
      }
    }

    void pause() {
      pause = true;
      paused = new CountDownLatch(1);
      resume = new CountDownLatch(1);
    }

    boolean awaitPause() throws InterruptedException {
      return paused.await(10, TimeUnit.SECONDS);
    }

    void release() { resume.countDown(); }

    void reset() {
      release();
      pause = false;
    }
  }
}
