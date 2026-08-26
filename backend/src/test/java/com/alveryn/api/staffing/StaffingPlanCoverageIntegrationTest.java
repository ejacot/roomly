package com.alveryn.api.staffing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.mockingDetails;

import com.alveryn.api.common.exception.NotFoundException;
import com.alveryn.api.organization.entity.CheckInMode;
import com.alveryn.api.organization.entity.MembershipRole;
import com.alveryn.api.organization.entity.Organization;
import com.alveryn.api.organization.entity.OrganizationMembership;
import com.alveryn.api.organization.entity.OrganizationUnit;
import com.alveryn.api.organization.entity.OrganizationUnitType;
import com.alveryn.api.organization.repository.OrganizationMembershipRepository;
import com.alveryn.api.organization.repository.OrganizationRepository;
import com.alveryn.api.organization.repository.OrganizationUnitRepository;
import com.alveryn.api.staffing.entity.StaffingPlanDaySource;
import com.alveryn.api.staffing.service.StaffingPlanCoverageService;
import com.alveryn.api.staffing.service.StaffingPlanCoverageService.IssueCode;
import com.alveryn.api.staffing.service.StaffingPlanCoverageService.IssueSeverity;
import com.alveryn.api.staffing.service.StaffingPlanFoundationService;
import com.alveryn.api.user.entity.UserAccount;
import com.alveryn.api.user.repository.UserAccountRepository;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Transactional
class StaffingPlanCoverageIntegrationTest {
  private static final LocalDate WEEK = LocalDate.of(2026, 8, 10);

  @Autowired StaffingPlanCoverageService coverage;
  @Autowired StaffingPlanFoundationService foundation;
  @Autowired OrganizationRepository organizations;
  @Autowired OrganizationUnitRepository units;
  @Autowired OrganizationMembershipRepository memberships;
  @Autowired UserAccountRepository users;
  @Autowired JdbcTemplate jdbc;
  @MockitoSpyBean NamedParameterJdbcTemplate observedCoverageJdbc;

  @Test
  void canonicalFormulaDoesNotLetOverstaffingHideAnotherOpenPosition() {
    Fixture fixture = fixture("formula");
    UUID first = requirement(fixture, fixture.dayId(), WEEK, "PF", 2, "05:00", "13:30");
    UUID second = requirement(fixture, fixture.dayId(), WEEK, "SPA", 2, "12:00", "20:30");
    assignment(fixture, first, activeEmployee(fixture, "one"), "ASSIGNED", null, null);
    assignment(fixture, first, activeEmployee(fixture, "two"), "ASSIGNED", null, null);
    assignment(fixture, first, activeEmployee(fixture, "three"), "ASSIGNED", null, null);
    assignment(fixture, second, activeEmployee(fixture, "four"), "ASSIGNED", null, null);

    var result = calculate(fixture);

    assertThat(result.required()).isEqualTo(4);
    assertThat(result.assigned()).isEqualTo(4);
    assertThat(result.effectiveAssigned()).isEqualTo(4);
    assertThat(result.covered()).isEqualTo(3);
    assertThat(result.missing()).isEqualTo(1);
    assertThat(result.overstaffed()).isEqualTo(1);
    assertThat(result.openPositions()).isEqualTo(1);
    assertThat(result.percentage()).isEqualByComparingTo("75.00");
    assertThat(result.requirement(first).covered()).isEqualTo(2);
    assertThat(result.requirement(first).overstaffed()).isEqualTo(1);
    assertThat(result.requirement(second).missing()).isEqualTo(1);
    assertThat(result.dayCoverage()).hasSize(7).first().satisfies(day -> {
      assertThat(day.required()).isEqualTo(4);
      assertThat(day.covered()).isEqualTo(3);
      assertThat(day.openPositions()).isEqualTo(1);
    });
  }

  @Test
  void emptyPlanUsesZeroPercentAndIsNotPublishable() {
    Fixture fixture = fixture("empty");

    var result = calculate(fixture);

    assertThat(result.required()).isZero();
    assertThat(result.covered()).isZero();
    assertThat(result.percentage()).isEqualByComparingTo("0.00");
    assertThat(result.publishable()).isFalse();
    assertThat(result.issues()).extracting(StaffingPlanCoverageService.PlanningIssue::code)
        .containsExactly(IssueCode.EMPTY_PLAN);
  }

  @Test
  void openEndedRequirementCountsAssignedPeopleWithoutInventingAnEndTime() {
    Fixture fixture = fixture("open-ended-coverage");
    UUID requirement = requirement(fixture, fixture.dayId(), WEEK, "CH", 2, "08:00", null);
    assignment(fixture, requirement, activeEmployee(fixture, "first"), "ASSIGNED", null, null);
    assignment(fixture, requirement, activeEmployee(fixture, "second"), "ASSIGNED", null, null);

    var result = calculate(fixture);
    var requirementCoverage = result.requirement(requirement);

    assertThat(requirementCoverage.startTime()).isEqualTo(LocalTime.of(8, 0));
    assertThat(requirementCoverage.endTime()).isNull();
    assertThat(requirementCoverage.assigned()).isEqualTo(2);
    assertThat(requirementCoverage.effectiveAssigned()).isEqualTo(2);
    assertThat(requirementCoverage.covered()).isEqualTo(2);
    assertThat(requirementCoverage.missing()).isZero();
    assertThat(result.issues()).extracting(StaffingPlanCoverageService.PlanningIssue::code)
        .doesNotContain(IssueCode.INVALID_INTERVAL, IssueCode.UNDERCOVERAGE);
  }

  @Test
  void operationallyActiveAssignmentsAreEffectiveEvenBeforeAccountClaim() {
    Fixture fixture = fixture("membership-state");
    UUID requirement = requirement(fixture, fixture.dayId(), WEEK, "ROOM", 3, "09:00", "16:30");
    assignment(fixture, requirement, activeEmployee(fixture, "active"), "ASSIGNED", null, null);
    UUID invitedAssignment = assignment(fixture, requirement, invitedEmployee(fixture, "invited"),
        "ASSIGNED", null, null);
    UUID suspendedAssignment = assignment(fixture, requirement,
        suspendedEmployee(fixture, "suspended"), "ASSIGNED", null, null);
    assignment(fixture, requirement, activeEmployee(fixture, "cancelled"), "CANCELLED", null, null);

    var result = calculate(fixture);
    var requirementCoverage = result.requirement(requirement);

    assertThat(requirementCoverage.assigned()).isEqualTo(3);
    assertThat(requirementCoverage.effectiveAssigned()).isEqualTo(2);
    assertThat(requirementCoverage.missing()).isEqualTo(1);
    assertThat(requirementCoverage.assignmentIds()).contains(invitedAssignment, suspendedAssignment);
    assertThat(requirementCoverage.effectiveAssignmentIds()).hasSize(2);
    assertThat(result.issues()).extracting(StaffingPlanCoverageService.PlanningIssue::code)
        .contains(IssueCode.SUSPENDED_MEMBER, IssueCode.UNDERCOVERAGE)
        .doesNotContain(IssueCode.INVITATION_PENDING);
    assertThat(result.issues().stream().filter(issue -> issue.code() == IssueCode.SUSPENDED_MEMBER)
        .findFirst().orElseThrow().publishBlocking()).isFalse();
    assertThat(result.publishable()).isTrue();
  }

  @Test
  void approvedAbsenceBlocksWhilePendingRequestOnlyNeedsAttention() {
    Fixture fixture = fixture("absence");
    UUID requirement = requirement(fixture, fixture.dayId(), WEEK, "HD", 1, "09:00", "17:30");
    OrganizationMembership employee = activeEmployee(fixture, "worker");
    UUID assignment = assignment(fixture, requirement, employee, "ASSIGNED", null, null);
    UUID dayEntry = UUID.randomUUID();
    jdbc.update("""
        insert into staffing_member_day_entries(id,organization_id,membership_id,work_date,
          entry_type,notes,created_by_membership_id,created_at,updated_at)
        values(?,?,?,?,'VACATION','Approved',?,current_timestamp,current_timestamp)
        """, dayEntry, fixture.organizationId(), employee.getId(), WEEK, fixture.owner().getId());
    jdbc.update("""
        insert into staffing_absence_requests(id,organization_id,membership_id,absence_type,
          start_date,end_date,notes,request_status,created_at,updated_at)
        values(?,?,?,'REST_DAY',?,?,'WhatsApp','PENDING',current_timestamp,current_timestamp)
        """, UUID.randomUUID(), fixture.organizationId(), employee.getId(), WEEK, WEEK);

    var blocked = calculate(fixture);
    assertThat(blocked.effectiveAssigned()).isZero();
    assertThat(blocked.issues()).extracting(StaffingPlanCoverageService.PlanningIssue::code)
        .contains(IssueCode.APPROVED_VACATION_CONFLICT, IssueCode.PENDING_REQUEST);
    assertThat(blocked.publishable()).isFalse();

    jdbc.update("delete from staffing_member_day_entries where id=?", dayEntry);
    var pendingOnly = calculate(fixture);
    assertThat(pendingOnly.effectiveAssigned()).isEqualTo(1);
    assertThat(pendingOnly.covered()).isEqualTo(1);
    assertThat(pendingOnly.publishable()).isTrue();
    assertThat(pendingOnly.issues()).singleElement().satisfies(issue -> {
      assertThat(issue.code()).isEqualTo(IssueCode.PENDING_REQUEST);
      assertThat(issue.severity()).isEqualTo(IssueSeverity.PENDING_REQUEST);
      assertThat(issue.assignmentId()).isEqualTo(assignment);
      assertThat(issue.acknowledgementRequired()).isTrue();
    });
  }

  @Test
  void sickAndRestDayBlockAssignmentsAndRejectedRequestAddsNoIssue() {
    Fixture fixture = fixture("absence-matrix");
    UUID sickRequirement = requirement(fixture, fixture.dayId(), WEEK, "PF", 1, "05:00", "13:30");
    UUID restRequirement = requirement(fixture, fixture.dayId(), WEEK, "PS", 1, "13:30", "22:00");
    OrganizationMembership sickMember = activeEmployee(fixture, "sick-worker");
    OrganizationMembership restMember = activeEmployee(fixture, "rest-worker");
    assignment(fixture, sickRequirement, sickMember, "ASSIGNED", null, null);
    assignment(fixture, restRequirement, restMember, "ASSIGNED", null, null);
    dayEntry(fixture, sickMember, "SICK");
    dayEntry(fixture, restMember, "REST_DAY");
    jdbc.update("""
        insert into staffing_absence_requests(id,organization_id,membership_id,absence_type,
          start_date,end_date,request_status,created_at,updated_at)
        values(?,?,?,'VACATION',?,?,'REJECTED',current_timestamp,current_timestamp)
        """, UUID.randomUUID(), fixture.organizationId(), restMember.getId(), WEEK, WEEK);

    var result = calculate(fixture);

    assertThat(result.requirement(sickRequirement).effectiveAssigned()).isZero();
    assertThat(result.requirement(restRequirement).effectiveAssigned()).isZero();
    assertThat(result.issues()).extracting(StaffingPlanCoverageService.PlanningIssue::code)
        .contains(IssueCode.APPROVED_SICK_CONFLICT, IssueCode.APPROVED_REST_DAY_CONFLICT,
            IssueCode.UNDERCOVERAGE)
        .doesNotContain(IssueCode.PENDING_REQUEST);
  }

  @Test
  void touchingAssignmentsDoNotOverlapButRealIntersectionAcrossUnitsDoes() {
    Fixture fixture = fixture("overlap");
    OrganizationMembership employee = activeEmployee(fixture, "worker");
    UUID morning = requirement(fixture, fixture.dayId(), WEEK, "PF", 1, "05:00", "12:00");
    UUID afternoon = requirement(fixture, fixture.dayId(), WEEK, "PS", 1, "12:00", "20:30");
    assignment(fixture, morning, employee, "ASSIGNED", null, null);
    assignment(fixture, afternoon, employee, "ASSIGNED", null, null);

    assertThat(calculate(fixture).issues()).noneMatch(
        issue -> issue.code() == IssueCode.INCOMPATIBLE_OVERLAP);

    OrganizationUnit otherUnit = units.saveAndFlush(new OrganizationUnit(fixture.organization(),
        null, "Other location", OrganizationUnitType.LOCATION, CheckInMode.OPTIONAL, 0));
    var otherPlan = foundation.getOrCreate(fixture.organizationId(), otherUnit.getId(), WEEK,
        fixture.owner().getId());
    var otherDay = foundation.createDay(fixture.organizationId(), otherUnit.getId(),
        otherPlan.getId(), WEEK, null, null, StaffingPlanDaySource.MANUAL, fixture.owner().getId());
    Fixture other = new Fixture(fixture.organization(), fixture.owner(), otherUnit,
        otherPlan.getId(), otherDay.getId());
    UUID crossing = requirement(other, other.dayId(), WEEK, "SPA", 1, "11:30", "13:00");
    UUID externalAssignment = assignment(other, crossing, employee, "ASSIGNED", null, null);

    var result = calculate(fixture);
    assertThat(result.issues()).anySatisfy(issue -> {
      assertThat(issue.code()).isEqualTo(IssueCode.INCOMPATIBLE_OVERLAP);
      assertThat(issue.publishBlocking()).isFalse();
      assertThat(issue.acknowledgementRequired()).isTrue();
      assertThat(issue.parameters()).containsEntry("externalConflict", "true")
          .doesNotContainKeys("assignmentPair", "unitId", "requirementId");
      assertThat(issue.issueKey()).doesNotContain(externalAssignment.toString());
    });
    assertThat(result.covered()).isZero();
  }

  @Test
  void everyAssignmentInAnOverlapSetIsExcludedAndIssueKeysIgnoreInsertionOrder() {
    Fixture fixture = fixture("overlap-set");
    OrganizationMembership employee = activeEmployee(fixture, "overlap-worker");
    UUID firstRequirement = requirement(fixture, fixture.dayId(), WEEK, "A", 1,
        "09:00", "13:00");
    UUID secondRequirement = requirement(fixture, fixture.dayId(), WEEK, "B", 1,
        "10:00", "14:00");
    UUID thirdRequirement = requirement(fixture, fixture.dayId(), WEEK, "C", 1,
        "11:00", "15:00");
    UUID first = assignment(fixture, firstRequirement, employee, "ASSIGNED", null, null);
    UUID second = assignment(fixture, secondRequirement, employee, "ASSIGNED", null, null);
    UUID third = assignment(fixture, thirdRequirement, employee, "ASSIGNED", null, null);

    var before = calculate(fixture);
    var beforeKeys = before.issues().stream()
        .filter(issue -> issue.code() == IssueCode.INCOMPATIBLE_OVERLAP)
        .map(StaffingPlanCoverageService.PlanningIssue::issueKey).toList();
    assertThat(beforeKeys).hasSize(3);
    assertThat(before.effectiveAssigned()).isZero();
    assertThat(before.requirement(firstRequirement).effectiveAssignmentIds()).isEmpty();
    assertThat(before.requirement(secondRequirement).effectiveAssignmentIds()).isEmpty();
    assertThat(before.requirement(thirdRequirement).effectiveAssignmentIds()).isEmpty();

    jdbc.update("update staffing_assignments set created_at=current_timestamp + interval '3 seconds' where id=?",
        first);
    jdbc.update("update staffing_assignments set created_at=current_timestamp + interval '2 seconds' where id=?",
        second);
    jdbc.update("update staffing_assignments set created_at=current_timestamp + interval '1 second' where id=?",
        third);
    var after = calculate(fixture);
    assertThat(after.issues().stream()
        .filter(issue -> issue.code() == IssueCode.INCOMPATIBLE_OVERLAP)
        .map(StaffingPlanCoverageService.PlanningIssue::issueKey).toList())
        .containsExactlyElementsOf(beforeKeys);
    assertThat(after.effectiveAssigned()).isZero();
  }

  @Test
  void issueKeysAreStableAndResourceSpecific() {
    Fixture fixture = fixture("stable-keys");
    UUID first = requirement(fixture, fixture.dayId(), WEEK, "PF", 1, "05:00", "13:30");
    UUID second = requirement(fixture, fixture.dayId(), WEEK, "PS", 1, "13:30", "22:00");

    var firstResult = calculate(fixture);
    var secondResult = calculate(fixture);

    var expectedKeys = java.util.stream.Stream.of(
        "UNDERCOVERAGE:" + first, "UNDERCOVERAGE:" + second).sorted().toList();
    assertThat(firstResult.issues()).extracting(StaffingPlanCoverageService.PlanningIssue::issueKey)
        .containsExactlyElementsOf(expectedKeys);
    assertThat(secondResult.issues()).extracting(StaffingPlanCoverageService.PlanningIssue::issueKey)
        .containsExactlyElementsOf(firstResult.issues().stream()
            .map(StaffingPlanCoverageService.PlanningIssue::issueKey).toList());
    assertThat(firstResult.issues()).allSatisfy(issue -> {
      assertThat(issue.messageKey()).startsWith("staffing.issue.");
      assertThat(issue.parameters()).doesNotContainKeys("email", "personalData");
    });
  }

  @Test
  void invalidSourceAndInactiveWorkTypeBlockWhileDuplicateAssignmentsRequireAcknowledgement() {
    Fixture fixture = fixture("source-blockers");
    OrganizationMembership employee = activeEmployee(fixture, "duplicate-worker");
    UUID invalid = requirement(fixture, fixture.dayId(), WEEK, "HD", 1, "09:00", "17:30");
    jdbc.update("update staffing_requirements set end_time=start_time where id=?", invalid);
    UUID inactive = requirement(fixture, fixture.dayId(), WEEK, "SPA", 1, "12:00", "20:30");
    jdbc.update("update organization_work_types set active=false where id=(select work_type_id "
        + "from staffing_requirements where id=?)", inactive);
    UUID duplicate = requirement(fixture, fixture.dayId(), WEEK, "PF", 1, "05:00", "13:30");
    UUID duplicateOther = requirement(fixture, fixture.dayId(), WEEK, "CH", 1, "05:00", "13:30");
    assignment(fixture, duplicate, employee, "ASSIGNED", null, null);
    assignment(fixture, duplicateOther, employee, "ASSIGNED", null, null);

    var result = calculate(fixture);

    assertThat(result.issues()).extracting(StaffingPlanCoverageService.PlanningIssue::code)
        .contains(IssueCode.INVALID_INTERVAL, IssueCode.INACTIVE_WORK_TYPE,
            IssueCode.DUPLICATE_ASSIGNMENT);
    assertThat(result.issues().stream().filter(
        issue -> issue.code() == IssueCode.DUPLICATE_ASSIGNMENT).findFirst().orElseThrow()
        .parameters().get("assignmentPair")).contains(":");
    assertThat(result.issues().stream().filter(
        issue -> issue.code() == IssueCode.DUPLICATE_ASSIGNMENT).findFirst().orElseThrow()
        .publishBlocking()).isFalse();
    assertThat(result.publishable()).isFalse();
  }

  @Test
  void intervalOverrideIsEffectiveButRequiresAcknowledgementAndScopeIsHidden() {
    Fixture fixture = fixture("override-and-scope");
    UUID requirement = requirement(fixture, fixture.dayId(), WEEK, "ROOM", 1, "09:00", "16:30");
    assignment(fixture, requirement, activeEmployee(fixture, "override-worker"), "ASSIGNED",
        LocalTime.of(10, 0), LocalTime.of(17, 0));

    var result = calculate(fixture);

    assertThat(result.covered()).isEqualTo(1);
    assertThat(result.publishable()).isTrue();
    assertThat(result.issues()).singleElement().satisfies(issue -> {
      assertThat(issue.code()).isEqualTo(IssueCode.INTERVAL_OVERRIDE);
      assertThat(issue.acknowledgementRequired()).isTrue();
      assertThat(issue.publishBlocking()).isFalse();
    });
    assertThatThrownBy(() -> coverage.calculate(UUID.randomUUID(), fixture.unit().getId(),
        fixture.planId())).isInstanceOf(NotFoundException.class);
    assertThatThrownBy(() -> coverage.calculate(fixture.organizationId(), UUID.randomUUID(),
        fixture.planId())).isInstanceOf(NotFoundException.class);
  }

  @Test
  void severityPolicyIsExplicitForEveryReviewSeverity() {
    assertThat(StaffingPlanCoverageService.policyFor(IssueSeverity.BLOCKING_CONFLICT))
        .isEqualTo(new StaffingPlanCoverageService.IssuePolicy(false, true, false));
    assertThat(StaffingPlanCoverageService.policyFor(IssueSeverity.WARNING))
        .isEqualTo(new StaffingPlanCoverageService.IssuePolicy(true, false, true));
    assertThat(StaffingPlanCoverageService.policyFor(IssueSeverity.INFORMATION))
        .isEqualTo(new StaffingPlanCoverageService.IssuePolicy(false, false, false));
    assertThat(StaffingPlanCoverageService.policyFor(IssueSeverity.PENDING_REQUEST))
        .isEqualTo(new StaffingPlanCoverageService.IssuePolicy(true, false, true));
    assertThat(StaffingPlanCoverageService.policyFor(IssueSeverity.UNCONFIRMED_CHANGE))
        .isEqualTo(new StaffingPlanCoverageService.IssuePolicy(true, false, true));
  }

  @Test
  void coverageQueryCountIsConstantAsRequirementsAndAssignmentsGrow() {
    Fixture small = fixture("query-small");
    UUID smallRequirement = requirement(small, small.dayId(), WEEK, "SMALL", 1,
        "09:00", "17:00");
    assignment(small, smallRequirement, activeEmployee(small, "small-worker"), "ASSIGNED",
        null, null);
    clearInvocations(observedCoverageJdbc);
    calculate(small);
    long smallQueries = observedCoverageQueryCount();

    Fixture large = fixture("query-large");
    for (int requirementIndex = 0; requirementIndex < 12; requirementIndex++) {
      UUID requirement = requirement(large, large.dayId(), WEEK,
          "Q" + requirementIndex, 4, "09:00", "17:00");
      for (int assignmentIndex = 0; assignmentIndex < 4; assignmentIndex++) {
        assignment(large, requirement,
            activeEmployee(large, "q-" + requirementIndex + "-" + assignmentIndex),
            "ASSIGNED", null, null);
      }
    }
    clearInvocations(observedCoverageJdbc);
    calculate(large);
    long largeQueries = observedCoverageQueryCount();

    assertThat(smallQueries).isEqualTo(5);
    assertThat(largeQueries).isEqualTo(smallQueries);
  }

  @Test
  void finalSpaAssignmentUpdatesEveryAggregateFromFifteenOfSixteenToOneHundredPercent() {
    Fixture fixture = fixture("complete-day");
    UUID room = requirement(fixture, fixture.dayId(), WEEK, "ROOM", 14, "09:00", "16:30");
    for (int index = 0; index < 14; index++) {
      assignment(fixture, room, activeEmployee(fixture, "room-" + index), "ASSIGNED", null, null);
    }
    UUID spa = requirement(fixture, fixture.dayId(), WEEK, "SPA-S", 2, "12:00", "20:30");
    assignment(fixture, spa, activeEmployee(fixture, "spa-one"), "ASSIGNED", null, null);

    var before = calculate(fixture);
    assertThat(before.covered()).isEqualTo(15);
    assertThat(before.required()).isEqualTo(16);
    assertThat(before.openPositions()).isEqualTo(1);
    assertThat(before.requirement(spa).effectiveAssigned()).isEqualTo(1);

    assignment(fixture, spa, activeEmployee(fixture, "ana-dumitru"), "ASSIGNED", null, null);
    var after = calculate(fixture);
    assertThat(after.required()).isEqualTo(16);
    assertThat(after.assigned()).isEqualTo(16);
    assertThat(after.effectiveAssigned()).isEqualTo(16);
    assertThat(after.covered()).isEqualTo(16);
    assertThat(after.missing()).isZero();
    assertThat(after.openPositions()).isZero();
    assertThat(after.percentage()).isEqualByComparingTo("100.00");
    assertThat(after.requirement(spa).effectiveAssigned()).isEqualTo(2);
    assertThat(after.requirement(spa).covered()).isEqualTo(2);
    assertThat(after.dayCoverage()).hasSize(7).first().satisfies(day -> {
      assertThat(day.required()).isEqualTo(16);
      assertThat(day.covered()).isEqualTo(16);
      assertThat(day.openPositions()).isZero();
      assertThat(day.percentage()).isEqualByComparingTo("100.00");
    });
  }

  private StaffingPlanCoverageService.CoverageResult calculate(Fixture fixture) {
    return coverage.calculate(fixture.organizationId(), fixture.unit().getId(), fixture.planId());
  }

  private long observedCoverageQueryCount() {
    Set<String> readMethods = Set.of("query", "queryForObject");
    return mockingDetails(observedCoverageJdbc).getInvocations().stream()
        .filter(invocation -> readMethods.contains(invocation.getMethod().getName()))
        .count();
  }

  private Fixture fixture(String label) {
    UserAccount user = new UserAccount(label + "-" + UUID.randomUUID() + "@example.com", "hash");
    user.verifyEmail();
    users.saveAndFlush(user);
    Organization organization = organizations.saveAndFlush(
        new Organization("Business " + label, "Europe/Berlin"));
    OrganizationMembership owner = memberships.saveAndFlush(
        new OrganizationMembership(organization, user, MembershipRole.OWNER));
    OrganizationUnit unit = units.saveAndFlush(new OrganizationUnit(organization, null,
        "Hotel " + label, OrganizationUnitType.LOCATION, CheckInMode.OPTIONAL, 0));
    var plan = foundation.getOrCreate(organization.getId(), unit.getId(), WEEK, owner.getId());
    var day = foundation.createDay(organization.getId(), unit.getId(), plan.getId(), WEEK, 50,
        null, StaffingPlanDaySource.MANUAL, owner.getId());
    return new Fixture(organization, owner, unit, plan.getId(), day.getId());
  }

  private OrganizationMembership activeEmployee(Fixture fixture, String label) {
    UserAccount user = new UserAccount(label + "-" + UUID.randomUUID() + "@example.com", "hash");
    user.verifyEmail();
    users.saveAndFlush(user);
    return memberships.saveAndFlush(new OrganizationMembership(
        fixture.organization(), user, MembershipRole.EMPLOYEE));
  }

  private OrganizationMembership invitedEmployee(Fixture fixture, String label) {
    return memberships.saveAndFlush(new OrganizationMembership(fixture.organization(), label,
        "Worker", label + "-" + UUID.randomUUID() + "@example.com"));
  }

  private OrganizationMembership suspendedEmployee(Fixture fixture, String label) {
    OrganizationMembership employee = activeEmployee(fixture, label);
    jdbc.update("update organization_memberships set membership_status='SUSPENDED' where id=?",
        employee.getId());
    return employee;
  }

  private UUID requirement(Fixture fixture, UUID dayId, LocalDate date, String code,
      int required, String start, String end) {
    UUID workType = UUID.randomUUID();
    jdbc.update("""
        insert into organization_work_types(id,organization_id,unit_id,code,name,color,
          default_start_time,default_end_time,default_break_minutes,active,calculation_method,
          compensation_method,teamwork_enabled,extra_pay_enabled,composite_enabled,display_order,
          created_at,updated_at)
        values(?,?,?,?,?,'#10B981',?::time,?::time,30,true,'TIME_BASED','HOURLY',false,false,
          false,0,current_timestamp,current_timestamp)
        """, workType, fixture.organizationId(), fixture.unit().getId(), code, code, start, end);
    UUID requirement = UUID.randomUUID();
    jdbc.update("""
        insert into staffing_requirements(id,organization_id,unit_id,work_type_id,work_date,
          start_time,end_time,required_workers,publication_status,created_by_membership_id,
          plan_day_id,created_at,updated_at)
        values(?,?,?,?,?,?::time,?::time,?,'DRAFT',?,?,current_timestamp,current_timestamp)
        """, requirement, fixture.organizationId(), fixture.unit().getId(), workType, date,
        start, end, required, fixture.owner().getId(), dayId);
    return requirement;
  }

  private UUID assignment(Fixture fixture, UUID requirement, OrganizationMembership employee,
      String status, LocalTime start, LocalTime end) {
    UUID assignment = UUID.randomUUID();
    jdbc.update("""
        insert into staffing_assignments(id,requirement_id,membership_id,start_time,end_time,
          assignment_status,assigned_by_membership_id,created_at,updated_at)
        values(?,?,?,?,?,?,?,current_timestamp,current_timestamp)
        """, assignment, requirement, employee.getId(), start, end, status,
        fixture.owner().getId());
    return assignment;
  }

  private void dayEntry(Fixture fixture, OrganizationMembership employee, String type) {
    jdbc.update("""
        insert into staffing_member_day_entries(id,organization_id,membership_id,work_date,
          entry_type,created_by_membership_id,created_at,updated_at)
        values(?,?,?,?,?,?,current_timestamp,current_timestamp)
        """, UUID.randomUUID(), fixture.organizationId(), employee.getId(), WEEK, type,
        fixture.owner().getId());
  }

  private record Fixture(Organization organization, OrganizationMembership owner,
      OrganizationUnit unit, UUID planId, UUID dayId) {
    UUID organizationId() {
      return organization.getId();
    }
  }
}
