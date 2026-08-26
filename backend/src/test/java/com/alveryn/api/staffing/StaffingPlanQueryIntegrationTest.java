package com.alveryn.api.staffing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.mockingDetails;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.alveryn.api.auth.security.JwtService;
import com.alveryn.api.organization.repository.OrganizationRepository;
import com.alveryn.api.testsupport.IntegrationTestDatabaseCleaner;
import com.alveryn.api.user.entity.UserAccount;
import com.alveryn.api.user.repository.UserAccountRepository;
import jakarta.persistence.EntityManagerFactory;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.hibernate.SessionFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

@SpringBootTest
class StaffingPlanQueryIntegrationTest {
  @Autowired WebApplicationContext context;
  @Autowired JwtService jwt;
  @Autowired UserAccountRepository users;
  @Autowired OrganizationRepository organizations;
  @Autowired JdbcTemplate jdbc;
  @Autowired EntityManagerFactory entityManagerFactory;
  @MockitoSpyBean NamedParameterJdbcTemplate observedQueryJdbc;

  MockMvc mvc;
  UserAccount owner;

  @BeforeEach
  void setup() {
    mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    jdbc.update("delete from staffing_plan_publication_operations");
    IntegrationTestDatabaseCleaner.cleanWorkspaceData(jdbc);
    entityManagerFactory.unwrap(SessionFactory.class).getStatistics().setStatisticsEnabled(true);
    owner = verified("query-owner-" + UUID.randomUUID() + "@example.com");
  }

  @Test
  void exposesOneStableDraftContractWithoutWritingSyntheticDays() throws Exception {
    Fixture fixture = fixture(2, true);
    String unassignedMember = create("/api/organizations/" + fixture.organizationId + "/members",
        "{\"firstName\":\"Bianca\",\"lastName\":\"Unassigned\"}");
    jdbc.update("""
        insert into staffing_member_day_entries(id,organization_id,membership_id,work_date,
          entry_type,notes,created_at,updated_at)
        values(?,?,?,'2026-08-11','REST_DAY','PRIVATE REQUEST NOTE',current_timestamp,
          current_timestamp)
        """, UUID.randomUUID(), UUID.fromString(fixture.organizationId),
        UUID.fromString(fixture.membershipId));
    int persistedBefore = jdbc.queryForObject(
        "select count(*) from staffing_plan_days where plan_id=?::uuid", Integer.class,
        fixture.planId);

    var lookup = mvc.perform(get("/api/organizations/{org}/staffing/plans", fixture.organizationId)
            .param("unitId", fixture.unitId).param("weekStart", "2026-08-10")
            .header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.found").value(true))
        .andExpect(jsonPath("$.data.plan.planId").value(fixture.planId))
        .andExpect(jsonPath("$.data.plan.capabilities.view").value(true))
        .andReturn();
    String etag = lookup.getResponse().getHeader(HttpHeaders.ETAG);
    assertThat(etag).isEqualTo("\"plan-" + fixture.planId + "-r2\"");

    mvc.perform(get("/api/organizations/{org}/staffing/plans/{plan}", fixture.organizationId,
            fixture.planId).header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_NONE_MATCH, etag))
        .andExpect(status().isNotModified())
        .andExpect(header().string(HttpHeaders.ETAG, etag))
        .andExpect(jsonPath("$").doesNotExist());

    mvc.perform(get("/api/organizations/{org}/staffing/plans/{plan}/demand",
            fixture.organizationId, fixture.planId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isOk())
        .andExpect(header().string(HttpHeaders.ETAG, etag))
        .andExpect(header().string(HttpHeaders.CACHE_CONTROL,
            org.hamcrest.Matchers.containsString("no-store")))
        .andExpect(jsonPath("$.data.days.length()").value(7))
        .andExpect(jsonPath("$.data.days[0].persisted").value(true))
        .andExpect(jsonPath("$.data.days[1].persisted").value(false))
        .andExpect(jsonPath("$.data.days[0].requirements[0].coverage.required").value(2))
        .andExpect(jsonPath("$.data.coverage.missing").value(1));

    String schedule = mvc.perform(get(
            "/api/organizations/{org}/staffing/plans/{plan}/schedule",
            fixture.organizationId, fixture.planId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.days.length()").value(7))
        .andExpect(jsonPath("$.data.members[*].displayName",
            org.hamcrest.Matchers.hasItems("Ana Query", "Bianca Unassigned")))
        .andExpect(jsonPath("$.data.members[?(@.membershipId == '" + unassignedMember
            + "')].assignmentIds.length()").value(0))
        .andExpect(jsonPath("$.data.coverage.rawAssigned").value(1))
        .andExpect(jsonPath("$.data.coverage.effectiveAssigned").value(1))
        .andReturn().getResponse().getContentAsString();
    assertThat(schedule).doesNotContainIgnoringCase("email")
        .doesNotContain("query-worker@example.com")
        .doesNotContain("PRIVATE REQUEST NOTE");
    assertPrivateManagerFieldsAbsent(schedule);

    mvc.perform(get("/api/organizations/{org}/staffing/plans/{plan}/coverage",
            fixture.organizationId, fixture.planId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.totals.required").value(2))
        .andExpect(jsonPath("$.data.totals.covered").value(1))
        .andExpect(jsonPath("$.data.totals.openPositions").value(1));

    String review = mvc.perform(get("/api/organizations/{org}/staffing/plans/{plan}/review",
            fixture.organizationId, fixture.planId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.publishable").value(true))
        .andExpect(jsonPath("$.data.requiredAcknowledgementKeys.length()").value(1))
        .andExpect(jsonPath("$.data.groups[0].issues[0].messageKey")
            .value("staffing.issue.undercoverage"))
        .andReturn().getResponse().getContentAsString();
    assertPrivateManagerFieldsAbsent(review);

    mvc.perform(put("/api/organizations/{org}/staffing/requirements/{requirement}",
            fixture.organizationId, fixture.requirementId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"startTime\":\"12:00\",\"endTime\":\"20:30\",\"requiredWorkers\":3}"))
        .andExpect(status().isOk());
    mvc.perform(get("/api/organizations/{org}/staffing/plans/{plan}", fixture.organizationId,
            fixture.planId).header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_NONE_MATCH, etag))
        .andExpect(status().isOk())
        .andExpect(header().string(HttpHeaders.ETAG,
            "\"plan-" + fixture.planId + "-r3\""));

    assertThat(jdbc.queryForObject("select count(*) from staffing_plan_days where plan_id=?::uuid",
        Integer.class, fixture.planId)).isEqualTo(persistedBefore);
  }

  @Test
  void conditionalGetSupportsHttpValidatorsAndSkipsHeavyDraftMapping() throws Exception {
    Fixture fixture = fixture(2, true);
    String etag = mvc.perform(get("/api/organizations/{org}/staffing/plans/{plan}",
            fixture.organizationId, fixture.planId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isOk()).andReturn().getResponse().getHeader(HttpHeaders.ETAG);

    List<String> matchingHeaders = List.of(etag, "W/" + etag,
        "\"unrelated\", W/" + etag, "*");
    for (String ifNoneMatch : matchingHeaders) {
      clearAllQueries();
      var response = mvc.perform(get(
              "/api/organizations/{org}/staffing/plans/{plan}/demand",
              fixture.organizationId, fixture.planId)
              .header(HttpHeaders.AUTHORIZATION, token(owner))
              .header(HttpHeaders.IF_NONE_MATCH, ifNoneMatch))
          .andExpect(status().isNotModified())
          .andExpect(header().string(HttpHeaders.ETAG, etag))
          .andExpect(header().string(HttpHeaders.CACHE_CONTROL,
              org.hamcrest.Matchers.allOf(org.hamcrest.Matchers.containsString("private"),
                  org.hamcrest.Matchers.containsString("no-store"))))
          .andReturn().getResponse();
      assertThat(response.getContentAsByteArray()).isEmpty();
      assertThat(observedQueries()).isEqualTo(1);
    }

    for (String ifNoneMatch : List.of("\"different\"", "W/not-quoted", "\"unterminated")) {
      mvc.perform(get("/api/organizations/{org}/staffing/plans/{plan}/demand",
              fixture.organizationId, fixture.planId)
              .header(HttpHeaders.AUTHORIZATION, token(owner))
              .header(HttpHeaders.IF_NONE_MATCH, ifNoneMatch))
          .andExpect(status().isOk())
          .andExpect(header().string(HttpHeaders.ETAG, etag));
    }
  }

  @Test
  void noPlanIsExplicitAndNonMondayIsRejectedWithoutCreatingAnything() throws Exception {
    String organizationId = create("/api/organizations",
        "{\"name\":\"No plan\",\"timezone\":\"Europe/Berlin\"}");
    String unitId = create("/api/organizations/" + organizationId + "/units",
        "{\"name\":\"Hotel\",\"type\":\"LOCATION\",\"checkInMode\":\"OPTIONAL\"}");
    String timezoneBefore = jdbc.queryForObject(
        "select timezone from organizations where id=?::uuid", String.class, organizationId);

    mvc.perform(get("/api/organizations/{org}/staffing/plans", organizationId)
            .param("unitId", unitId).param("weekStart", "2026-08-10")
            .header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.found").value(false))
        .andExpect(jsonPath("$.data.plan").doesNotExist());
    mvc.perform(get("/api/organizations/{org}/staffing/plans", organizationId)
            .param("unitId", unitId).param("weekStart", "2026-08-11")
            .header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isBadRequest());
    assertThat(jdbc.queryForObject("select count(*) from staffing_plans where organization_id=?::uuid",
        Integer.class, organizationId)).isZero();
    assertThat(jdbc.queryForObject("select count(*) from staffing_plan_days where organization_id=?::uuid",
        Integer.class, organizationId)).isZero();
    assertThat(jdbc.queryForObject("select timezone from organizations where id=?::uuid",
        String.class, organizationId)).isEqualTo(timezoneBefore);
  }

  @Test
  void planLookupIsIsolatedByUnitWithinTheSameOrganizationAndWeek() throws Exception {
    Fixture fixture = fixture(1, true);
    String otherUnitId = create("/api/organizations/" + fixture.organizationId + "/units",
        "{\"name\":\"Other location\",\"type\":\"LOCATION\",\"checkInMode\":\"OPTIONAL\"}");

    mvc.perform(get("/api/organizations/{org}/staffing/plans", fixture.organizationId)
            .param("unitId", fixture.unitId).param("weekStart", "2026-08-10")
            .header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.found").value(true))
        .andExpect(jsonPath("$.data.plan.planId").value(fixture.planId));

    mvc.perform(get("/api/organizations/{org}/staffing/plans", fixture.organizationId)
            .param("unitId", otherUnitId).param("weekStart", "2026-08-10")
            .header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.found").value(false))
        .andExpect(jsonPath("$.data.plan").doesNotExist());
  }

  @Test
  void atomicVersionDetailExposesOnlyImmutableGranularCoverage() throws Exception {
    Fixture fixture = fixture(1, true);
    publishAtomic(fixture.organizationId, fixture.unitId, fixture.planId, "2026-08-10",
        "granular-version-detail");

    var result = mvc.perform(get(
            "/api/organizations/{org}/staffing/plans/{plan}/versions/1",
            fixture.organizationId, fixture.planId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.checksumFormatVersion").value(2))
        .andExpect(jsonPath("$.data.granularCoverageAvailable").value(true))
        .andExpect(jsonPath("$.data.publicationKind").value("ATOMIC_WEEKLY"))
        .andExpect(jsonPath("$.data.coverageBasis").value("CANONICAL_REQUIREMENT_V1"))
        .andExpect(jsonPath("$.data.requirementCoverage.length()").value(1))
        .andExpect(jsonPath("$.data.requirementCoverage[0].sourceRequirementId")
            .value(fixture.requirementId))
        .andExpect(jsonPath("$.data.requirementCoverage[0].required").value(1))
        .andExpect(jsonPath("$.data.requirementCoverage[0].rawAssigned").value(1))
        .andExpect(jsonPath("$.data.requirementCoverage[0].effectiveAssigned").value(1))
        .andExpect(jsonPath("$.data.requirementCoverage[0].covered").value(1))
        .andExpect(jsonPath("$.data.requirementCoverage[0].missing").value(0))
        .andExpect(jsonPath("$.data.dayCoverage.length()").value(7))
        .andExpect(jsonPath("$.data.dayCoverage[0].date").value("2026-08-10"))
        .andExpect(jsonPath("$.data.dayCoverage[6].date").value("2026-08-16"))
        .andReturn();
    String etag = result.getResponse().getHeader(HttpHeaders.ETAG);
    String immutableBody = result.getResponse().getContentAsString();

    jdbc.update("update staffing_requirements set required_workers=9 where id=?::uuid",
        fixture.requirementId);
    jdbc.update("update staffing_assignments set assignment_status='CANCELLED' where id=?::uuid",
        fixture.assignmentId);
    mvc.perform(get("/api/organizations/{org}/staffing/plans/{plan}/versions/1",
            fixture.organizationId, fixture.planId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isOk())
        .andExpect(resultAfter -> assertThat(resultAfter.getResponse().getContentAsString())
            .isEqualTo(immutableBody));
    mvc.perform(get("/api/organizations/{org}/staffing/plans/{plan}/versions/1",
            fixture.organizationId, fixture.planId)
            .header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_NONE_MATCH, "W/" + etag))
        .andExpect(status().isNotModified())
        .andExpect(resultAfter -> assertThat(resultAfter.getResponse().getContentAsByteArray())
            .isEmpty());
  }

  @Test
  void atomicVersionDetailAddsExactlyTwoConstantBatchQueriesAtLargeScale() throws Exception {
    Fixture small = fixture(1, true);
    publishAtomic(small.organizationId, small.unitId, small.planId, "2026-08-10",
        "small-version-query-bound");
    clearAllQueries();
    mvc.perform(get("/api/organizations/{org}/staffing/plans/{plan}/versions/1",
            small.organizationId, small.planId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.requirementCoverage.length()").value(1));
    QueryCounts smallQueries = queryCounts();
    assertThat(granularCoverageQueries()).isEqualTo(2);

    Fixture large = fixture(1, true);
    UUID organizationId = UUID.fromString(large.organizationId);
    UUID unitId = UUID.fromString(large.unitId);
    UUID planId = UUID.fromString(large.planId);
    UUID workTypeId = UUID.fromString(large.workTypeId);
    UUID planDayId = jdbc.queryForObject(
        "select id from staffing_plan_days where plan_id=?", UUID.class, planId);
    UUID ownerMembership = jdbc.queryForObject("""
        select id from organization_memberships
        where organization_id=? and membership_role='OWNER'
        """, UUID.class, organizationId);
    for (int index = 1; index < 72; index++) {
      UUID requirementId = UUID.randomUUID();
      UUID membershipId = UUID.randomUUID();
      jdbc.update("""
          insert into organization_memberships(id,organization_id,first_name,last_name,
            membership_role,membership_status,joined_at,created_at,updated_at)
          values(?,?,?,?,'EMPLOYEE','ACTIVE',current_timestamp,current_timestamp,current_timestamp)
          """, membershipId, organizationId, "Version worker", Integer.toString(index));
      jdbc.update("""
          insert into staffing_requirements(id,plan_day_id,organization_id,unit_id,work_type_id,
            work_date,start_time,end_time,required_workers,publication_status,
            created_by_membership_id,created_at,updated_at)
          values(?,?,?,?,?,'2026-08-10','12:00','20:30',1,'DRAFT',?,
            current_timestamp,current_timestamp)
          """, requirementId, planDayId, organizationId, unitId, workTypeId, ownerMembership);
      jdbc.update("""
          insert into staffing_assignments(id,requirement_id,membership_id,assignment_status,
            assigned_by_membership_id,created_at,updated_at)
          values(?,?,?,'ASSIGNED',?,current_timestamp,current_timestamp)
          """, UUID.randomUUID(), requirementId, membershipId, ownerMembership);
    }
    publishAtomic(large.organizationId, large.unitId, large.planId, "2026-08-10",
        "large-version-query-bound");
    clearAllQueries();
    mvc.perform(get("/api/organizations/{org}/staffing/plans/{plan}/versions/1",
            large.organizationId, large.planId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.requirementCoverage.length()").value(72))
        .andExpect(jsonPath("$.data.assignments.length()").value(72));
    QueryCounts largeQueries = queryCounts();

    assertThat(granularCoverageQueries()).isEqualTo(2);
    assertThat(largeQueries.named()).isEqualTo(smallQueries.named());
    assertThat(largeQueries.hibernate()).isEqualTo(smallQueries.hibernate());
    assertThat(largeQueries.total()).isEqualTo(smallQueries.total());
    assertThat(largeQueries.named()).isLessThanOrEqualTo(9);
    assertThat(largeQueries.total()).isLessThanOrEqualTo(15);
  }

  @Test
  void versionsAreImmutableSnapshotReadsWithStableConditionalEtag() throws Exception {
    Fixture fixture = fixture(1, true);
    UUID versionId = UUID.randomUUID();
    UUID secondVersionId = UUID.randomUUID();
    UUID versionDayId = UUID.randomUUID();
    UUID versionRequirementId = UUID.randomUUID();
    UUID sourcePlanDayId = jdbc.queryForObject(
        "select id from staffing_plan_days where plan_id=?::uuid", UUID.class, fixture.planId);
    String checksum = "a".repeat(64);
    jdbc.update("""
        insert into staffing_plan_versions(id,organization_id,unit_id,plan_id,version_number,
          source_draft_revision,published_at,timezone,week_start,coverage_required,
          coverage_assigned,coverage_raw_assigned,coverage_effective_assigned,coverage_covered,
          coverage_missing,coverage_overstaffed,coverage_percentage,coverage_basis,warning_count,
          checksum,publication_kind,source_draft_complete,publication_note,
          published_by_display_name,created_at)
        values(?,?,?,?,1,1,current_timestamp,'Europe/Berlin','2026-08-10',1,1,1,1,1,0,0,
          100,'LEGACY_V90',0,?,'LEGACY_PARTIAL',true,'PRIVATE PUBLICATION NOTE',
          'Publisher Query',current_timestamp)
        """, versionId, UUID.fromString(fixture.organizationId), UUID.fromString(fixture.unitId),
        UUID.fromString(fixture.planId), checksum);
    jdbc.update("""
        insert into staffing_plan_versions(id,organization_id,unit_id,plan_id,version_number,
          source_draft_revision,previous_version_id,published_at,timezone,week_start,
          coverage_required,coverage_assigned,coverage_raw_assigned,
          coverage_effective_assigned,coverage_covered,coverage_missing,coverage_overstaffed,
          coverage_percentage,coverage_basis,warning_count,checksum,publication_kind,
          source_draft_complete,published_by_membership_id,published_by_display_name,created_at)
        values(?,?,?,?,2,2,?,current_timestamp,'Europe/Berlin','2026-08-10',1,1,1,1,1,0,0,
          100,'LEGACY_V90',0,?,'ATOMIC_WEEKLY',true,?,'Publisher Query',current_timestamp)
        """, secondVersionId, UUID.fromString(fixture.organizationId),
        UUID.fromString(fixture.unitId), UUID.fromString(fixture.planId), versionId,
        "b".repeat(64), UUID.fromString(fixture.membershipId));
    jdbc.update("""
        insert into staffing_plan_version_days(id,version_id,source_plan_day_id,work_date,notes,
          source,created_at)
        values(?,?,?,'2026-08-10','PRIVATE DAY NOTE','MANUAL',current_timestamp)
        """, versionDayId, versionId, sourcePlanDayId);
    jdbc.update("""
        insert into staffing_plan_version_requirements(id,version_id,version_day_id,
          source_requirement_id,source_plan_day_id,work_date,unit_id,unit_name,work_type_id,
          work_type_code,work_type_name,start_time,end_time,break_minutes,required_workers,
          legacy_publication_status,notes,created_at)
        values(?,?,?,?,?,'2026-08-10',?,'Hotel',?,'PF','Public early','05:00','13:30',30,1,
          'DRAFT','PRIVATE REQUIREMENT NOTE',current_timestamp)
        """, versionRequirementId, versionId, versionDayId,
        UUID.fromString(fixture.requirementId), sourcePlanDayId,
        UUID.fromString(fixture.unitId), UUID.fromString(fixture.workTypeId));
    jdbc.update("""
        insert into staffing_plan_version_assignments(id,version_id,version_requirement_id,
          source_assignment_id,source_requirement_id,organization_membership_id,
          member_display_name,membership_status_snapshot,work_date,unit_id,unit_name,
          work_type_id,work_type_code,work_type_name,start_time,end_time,assignment_status,
          check_in_mode,created_at)
        values(?,?,?,?,?,?,'Ana Query','ACTIVE','2026-08-10',?,'Hotel',?,'PF','Public early',
          '05:00','13:30','ASSIGNED','OPTIONAL',current_timestamp)
        """, UUID.randomUUID(), versionId, versionRequirementId,
        UUID.fromString(fixture.assignmentId), UUID.fromString(fixture.requirementId),
        UUID.fromString(fixture.membershipId), UUID.fromString(fixture.unitId),
        UUID.fromString(fixture.workTypeId));
    jdbc.update("""
        insert into staffing_plan_version_member_days(id,version_id,source_day_entry_id,
          organization_membership_id,member_display_name,work_date,status,notes,source,created_at)
        values(?,?,?,?,'Ana Query','2026-08-11','VACATION','PRIVATE ABSENCE NOTE','MANUAL',
          current_timestamp)
        """, UUID.randomUUID(), versionId, UUID.randomUUID(),
        UUID.fromString(fixture.membershipId));
    jdbc.update("""
        insert into staffing_plan_version_acknowledgements(id,version_id,issue_key,severity,
          acknowledged_by_membership_id,acknowledged_by_display_name,acknowledged_at,note,created_at)
        values(?,?,'UNDERCOVERAGE:test','WARNING',?,'PRIVATE REVIEWER',current_timestamp,
          'PRIVATE ACK NOTE',current_timestamp)
        """, UUID.randomUUID(), versionId, UUID.fromString(fixture.membershipId));
    jdbc.update("""
        update staffing_plans set latest_published_version_id=?,published_revision=2,
          published_at=current_timestamp where id=?::uuid
        """, secondVersionId, fixture.planId);

    clearAllQueries();
    var versionsResult = mvc.perform(get("/api/organizations/{org}/staffing/plans/{plan}/versions",
            fixture.organizationId, fixture.planId)
            .param("limit", "1")
            .header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.versions[0].latest").value(true))
        .andExpect(jsonPath("$.data.versions[0].covered").value(1))
        .andExpect(jsonPath("$.data.versions.length()").value(1))
        .andExpect(jsonPath("$.data.limit").value(1))
        .andExpect(jsonPath("$.data.hasMore").value(true))
        .andExpect(jsonPath("$.data.nextBeforeVersion").value(2))
        .andReturn();
    QueryCounts versionListQueries = queryCounts();
    assertThat(versionListQueries.named()).isLessThanOrEqualTo(2);
    assertThat(versionListQueries.hibernate()).isLessThanOrEqualTo(6);
    assertThat(versionListQueries.total()).isLessThanOrEqualTo(8);
    String versionsEtag = versionsResult.getResponse().getHeader(HttpHeaders.ETAG);
    mvc.perform(get("/api/organizations/{org}/staffing/plans/{plan}/versions",
            fixture.organizationId, fixture.planId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.limit").value(20))
        .andExpect(jsonPath("$.data.versions[0].versionNumber").value(2))
        .andExpect(jsonPath("$.data.versions[1].versionNumber").value(1))
        .andExpect(jsonPath("$.data.hasMore").value(false));
    mvc.perform(get("/api/organizations/{org}/staffing/plans/{plan}/versions",
            fixture.organizationId, fixture.planId).param("limit", "100")
            .header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.limit").value(100));
    clearAllQueries();
    mvc.perform(get("/api/organizations/{org}/staffing/plans/{plan}/versions",
            fixture.organizationId, fixture.planId)
            .param("limit", "1")
            .header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_NONE_MATCH, versionsEtag))
        .andExpect(status().isNotModified())
        .andExpect(header().string(HttpHeaders.ETAG, versionsEtag))
        .andExpect(header().string(HttpHeaders.CACHE_CONTROL,
            org.hamcrest.Matchers.containsString("private")))
        .andExpect(result -> assertThat(result.getResponse().getContentAsByteArray()).isEmpty());
    assertThat(observedQueries()).isEqualTo(2);
    mvc.perform(get("/api/organizations/{org}/staffing/plans/{plan}/versions",
            fixture.organizationId, fixture.planId)
            .param("limit", "1").param("beforeVersion", "2")
            .header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.versions[0].versionNumber").value(1))
        .andExpect(jsonPath("$.data.hasMore").value(false))
        .andExpect(result -> assertThat(result.getResponse().getHeader(HttpHeaders.ETAG))
            .isNotEqualTo(versionsEtag));
    mvc.perform(get("/api/organizations/{org}/staffing/plans/{plan}/versions",
            fixture.organizationId, fixture.planId)
            .param("limit", "101").header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isBadRequest());

    clearAllQueries();
    var result = mvc.perform(get(
            "/api/organizations/{org}/staffing/plans/{plan}/versions/1",
            fixture.organizationId, fixture.planId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.requirements[0].workTypeCode").value("PF"))
        .andExpect(jsonPath("$.data.assignments[0].memberDisplayName").value("Ana Query"))
        .andExpect(jsonPath("$.data.checksumFormatVersion").value(1))
        .andExpect(jsonPath("$.data.granularCoverageAvailable").value(false))
        .andExpect(jsonPath("$.data.requirementCoverage").isEmpty())
        .andExpect(jsonPath("$.data.dayCoverage").isEmpty())
        .andReturn();
    QueryCounts versionDetailQueries = queryCounts();
    assertThat(versionDetailQueries.named()).isLessThanOrEqualTo(9);
    assertThat(versionDetailQueries.hibernate()).isLessThanOrEqualTo(6);
    assertThat(versionDetailQueries.total()).isLessThanOrEqualTo(15);
    String etag = result.getResponse().getHeader(HttpHeaders.ETAG);
    assertThat(etag).isEqualTo("\"plan-version-" + versionId + "-" + checksum + "\"");
    String originalSnapshot = result.getResponse().getContentAsString();
    assertPrivateVersionFieldsAbsent(originalSnapshot);
    jdbc.update("update organization_work_types set name='Renamed mutable source' where id=?::uuid",
        fixture.workTypeId);
    jdbc.update("update organization_units set name='Renamed mutable unit' where id=?::uuid",
        fixture.unitId);
    jdbc.update("update organization_memberships set first_name='Renamed',last_name='Member' "
        + "where id=?::uuid", fixture.membershipId);
    jdbc.update("update staffing_assignments set assignment_status='CANCELLED' where id=?::uuid",
        fixture.assignmentId);
    jdbc.update("update staffing_requirements set required_workers=9 where id=?::uuid",
        fixture.requirementId);
    String afterRename = mvc.perform(get(
            "/api/organizations/{org}/staffing/plans/{plan}/versions/1",
            fixture.organizationId, fixture.planId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.requirements[0].workTypeName").value("Public early"))
        .andReturn().getResponse().getContentAsString();
    assertThat(afterRename).isEqualTo(originalSnapshot)
        .doesNotContain("Renamed mutable source")
        .doesNotContain("Renamed mutable unit")
        .doesNotContain("Renamed Member");
    for (String validator : List.of(etag, "W/" + etag,
        "\"other\", W/" + etag, "*")) {
      clearAllQueries();
      mvc.perform(get("/api/organizations/{org}/staffing/plans/{plan}/versions/1",
              fixture.organizationId, fixture.planId)
              .header(HttpHeaders.AUTHORIZATION, token(owner))
              .header(HttpHeaders.IF_NONE_MATCH, validator))
          .andExpect(status().isNotModified())
          .andExpect(header().string(HttpHeaders.ETAG, etag))
          .andExpect(header().string(HttpHeaders.CACHE_CONTROL,
              org.hamcrest.Matchers.allOf(org.hamcrest.Matchers.containsString("private"),
                  org.hamcrest.Matchers.containsString("no-cache"))))
          .andExpect(value -> assertThat(value.getResponse().getContentAsByteArray()).isEmpty());
      assertThat(observedQueries()).isEqualTo(2);
    }
    for (String validator : List.of("\"different\"", "W/not-quoted", "\"unterminated")) {
      mvc.perform(get("/api/organizations/{org}/staffing/plans/{plan}/versions/1",
              fixture.organizationId, fixture.planId)
              .header(HttpHeaders.AUTHORIZATION, token(owner))
              .header(HttpHeaders.IF_NONE_MATCH, validator))
          .andExpect(status().isOk());
    }
  }

  @Test
  void authorizationRunsBeforeConditionalEtagAndManagerContractDoesNotChangeSelfApi()
      throws Exception {
    Fixture fixture = fixture(1, false);
    UserAccount outsider = verified("outsider-" + UUID.randomUUID() + "@example.com");
    String guessed = "\"plan-" + fixture.planId + "-r1\"";
    mvc.perform(get("/api/organizations/{org}/staffing/plans/{plan}", fixture.organizationId,
            fixture.planId).header(HttpHeaders.AUTHORIZATION, token(outsider))
            .header(HttpHeaders.IF_NONE_MATCH, guessed))
        .andExpect(status().isNotFound());

    UserAccount employee = verified("employee-" + UUID.randomUUID() + "@example.com");
    jdbc.update("""
        insert into organization_memberships(id,organization_id,user_id,membership_role,
          membership_status,joined_at,created_at,updated_at)
        values(?,?,?,'EMPLOYEE','ACTIVE',current_timestamp,current_timestamp,current_timestamp)
        """, UUID.randomUUID(), UUID.fromString(fixture.organizationId), employee.getId());
    mvc.perform(get("/api/organizations/{org}/staffing/plans/{plan}", fixture.organizationId,
            fixture.planId).header(HttpHeaders.AUTHORIZATION, token(employee))
            .header(HttpHeaders.IF_NONE_MATCH, guessed))
        .andExpect(status().isForbidden());
    mvc.perform(get("/api/my/business-schedule").param("from", "2026-08-10")
            .param("to", "2026-08-16").header(HttpHeaders.AUTHORIZATION, token(employee)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data[0].requirements").doesNotExist())
        .andExpect(jsonPath("$.data[0].coverage").doesNotExist());
  }

  @Test
  void scheduleQueryCountIsBoundedForSmallAndLargerPlans() throws Exception {
    Fixture small = fixture(4, false);
    clearAllQueries();
    mvc.perform(get("/api/organizations/{org}/staffing/plans/{plan}/schedule",
            small.organizationId, small.planId).header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isOk());
    QueryCounts smallQueries = queryCounts();

    Fixture large = fixture(4, false);
    UUID organizationId = UUID.fromString(large.organizationId);
    UUID planId = UUID.fromString(large.planId);
    UUID unitId = UUID.fromString(large.unitId);
    UUID workTypeId = UUID.fromString(large.workTypeId);
    UUID planDayId = jdbc.queryForObject(
        "select id from staffing_plan_days where plan_id=?", UUID.class, planId);
    UUID ownerMembership = jdbc.queryForObject("""
        select id from organization_memberships
        where organization_id=? and membership_role='OWNER'
        """, UUID.class, organizationId);
    List<UUID> requirements = new java.util.ArrayList<>();
    requirements.add(jdbc.queryForObject("""
        select id from staffing_requirements where plan_day_id=? order by created_at limit 1
        """, UUID.class, planDayId));
    for (int index = 1; index < 12; index++) {
      UUID requirement = UUID.randomUUID();
      jdbc.update("""
          insert into staffing_requirements(id,plan_day_id,organization_id,unit_id,work_type_id,
            work_date,start_time,end_time,required_workers,publication_status,
            created_by_membership_id,created_at,updated_at)
          values(?,?,?,?,?,'2026-08-10','12:00','20:30',4,'DRAFT',?,current_timestamp,current_timestamp)
          """, requirement, planDayId, organizationId, unitId, workTypeId, ownerMembership);
      requirements.add(requirement);
    }
    for (int index = 0; index < 48; index++) {
      UUID member = UUID.randomUUID();
      jdbc.update("""
          insert into organization_memberships(id,organization_id,first_name,last_name,
            membership_role,membership_status,joined_at,created_at,updated_at)
          values(?,?,?,?,'EMPLOYEE','ACTIVE',current_timestamp,current_timestamp,current_timestamp)
          """, member, organizationId, "Worker", Integer.toString(index + 1));
      jdbc.update("""
          insert into staffing_assignments(id,requirement_id,membership_id,assignment_status,
            assigned_by_membership_id,created_at,updated_at)
          values(?,?,?,'ASSIGNED',?,current_timestamp,current_timestamp)
          """, UUID.randomUUID(), requirements.get(index / 4), member, ownerMembership);
    }
    clearAllQueries();
    mvc.perform(get("/api/organizations/{org}/staffing/plans/{plan}/schedule",
            large.organizationId, large.planId).header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.days[0].requirements.length()").value(12))
        .andExpect(jsonPath("$.data.members.length()").value(50));
    QueryCounts largeQueries = queryCounts();

    assertThat(smallQueries.named()).isLessThanOrEqualTo(8);
    assertThat(largeQueries.named()).isLessThanOrEqualTo(13);
    assertThat(largeQueries.named() - smallQueries.named()).isLessThanOrEqualTo(5);
    assertThat(largeQueries.hibernate()).isEqualTo(smallQueries.hibernate());
    assertThat(largeQueries.total() - smallQueries.total()).isLessThanOrEqualTo(5);
  }

  @Test
  void publishedSelfScheduleQueryCountIsBoundedAcrossUnitsWeeksColleaguesAndActuals()
      throws Exception {
    UserAccount employee = verified("self-query-worker-" + UUID.randomUUID() + "@example.com");
    String organization = create("/api/organizations",
        "{\"name\":\"Self Query Hotel\",\"timezone\":\"Europe/Berlin\"}");
    String firstUnit = create("/api/organizations/" + organization + "/units",
        "{\"name\":\"North\",\"type\":\"LOCATION\",\"checkInMode\":\"OPTIONAL\"}");
    String secondUnit = create("/api/organizations/" + organization + "/units",
        "{\"name\":\"South\",\"type\":\"LOCATION\",\"checkInMode\":\"OPTIONAL\"}");
    String employeeMembership = create("/api/organizations/" + organization + "/members",
        "{\"firstName\":\"Self\",\"lastName\":\"Worker\",\"email\":\""
            + employee.getEmail() + "\"}");
    List<String> colleagues = new java.util.ArrayList<>();
    for (int index = 0; index < 4; index++) {
      colleagues.add(create("/api/organizations/" + organization + "/members",
          "{\"firstName\":\"Colleague\",\"lastName\":\"" + (index + 1) + "\"}"));
    }
    jdbc.update("""
        update organization_memberships set membership_status='ACTIVE'
        where id in (?::uuid,?::uuid,?::uuid,?::uuid,?::uuid)
        """, employeeMembership, colleagues.get(0), colleagues.get(1), colleagues.get(2),
        colleagues.get(3));
    String firstType = create("/api/organizations/" + organization + "/staffing/work-types",
        "{\"unitId\":\"" + firstUnit + "\",\"code\":\"ROOM\","
            + "\"name\":\"Room cleaning\",\"defaultStartTime\":\"09:00\","
            + "\"defaultEndTime\":\"16:30\"}");
    String secondType = create("/api/organizations/" + organization + "/staffing/work-types",
        "{\"unitId\":\"" + secondUnit + "\",\"code\":\"SPA\","
            + "\"name\":\"Spa late\",\"defaultStartTime\":\"12:00\","
            + "\"defaultEndTime\":\"20:30\"}");

    String firstRequirement = create("/api/organizations/" + organization
        + "/staffing/requirements", "{\"unitId\":\"" + firstUnit
            + "\",\"workTypeId\":\"" + firstType
            + "\",\"date\":\"2026-08-10\",\"requiredWorkers\":1}");
    create("/api/organizations/" + organization + "/staffing/requirements/"
        + firstRequirement + "/assignments", "{\"membershipId\":\""
            + employeeMembership + "\"}");
    String firstPlan = planId(organization, firstUnit, "2026-08-10");
    publishAtomic(organization, firstUnit, firstPlan, "2026-08-10", "self-small-v1");
    String firstOwnAssignment = jdbc.queryForObject("""
        select id::text from staffing_assignments
        where requirement_id=?::uuid and membership_id=?::uuid
        """, String.class, firstRequirement, employeeMembership);
    mvc.perform(put("/api/my/business-schedule/assignments/{assignment}/result",
            firstOwnAssignment).header(HttpHeaders.AUTHORIZATION, token(employee))
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"actualStartTime\":\"09:00\",\"actualEndTime\":\"16:30\","
                + "\"breakMinutes\":30,\"completedQuantity\":8,\"submit\":true}"))
        .andExpect(status().isOk());

    clearAllQueries();
    mvc.perform(get("/api/my/business-schedule").param("from", "2026-08-10")
            .param("to", "2026-08-16").header(HttpHeaders.AUTHORIZATION, token(employee)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data[0].assignments.length()").value(1))
        .andExpect(jsonPath("$.data[0].assignments[0].result.completedQuantity").value(8));
    QueryCounts smallQueries = queryCounts();

    mvc.perform(put("/api/organizations/{org}/staffing/requirements/{requirement}",
            organization, firstRequirement).header(HttpHeaders.AUTHORIZATION, token(owner))
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"startTime\":\"09:00\",\"endTime\":\"16:30\","
                + "\"requiredWorkers\":5}"))
        .andExpect(status().isOk());
    for (String colleague : colleagues) {
      create("/api/organizations/" + organization + "/staffing/requirements/"
          + firstRequirement + "/assignments", "{\"membershipId\":\"" + colleague + "\"}");
    }
    publishAtomic(organization, firstUnit, firstPlan, "2026-08-10", "self-large-first-v2");

    List<String> weeks = List.of("2026-08-10", "2026-08-17", "2026-08-24", "2026-08-31");
    List<String> ownAssignments = new java.util.ArrayList<>();
    ownAssignments.add(firstOwnAssignment);
    for (String unit : List.of(firstUnit, secondUnit)) {
      String type = unit.equals(firstUnit) ? firstType : secondType;
      for (String week : weeks) {
        if (unit.equals(firstUnit) && week.equals("2026-08-10")) continue;
        String workDate = unit.equals(firstUnit) ? week
            : java.time.LocalDate.parse(week).plusDays(1).toString();
        String requirement = create("/api/organizations/" + organization
            + "/staffing/requirements", "{\"unitId\":\"" + unit
                + "\",\"workTypeId\":\"" + type + "\",\"date\":\"" + workDate
                + "\",\"requiredWorkers\":5}");
        create("/api/organizations/" + organization + "/staffing/requirements/"
            + requirement + "/assignments", "{\"membershipId\":\""
                + employeeMembership + "\"}");
        for (String colleague : colleagues) {
          create("/api/organizations/" + organization + "/staffing/requirements/"
              + requirement + "/assignments", "{\"membershipId\":\"" + colleague + "\"}");
        }
        ownAssignments.add(jdbc.queryForObject("""
            select id::text from staffing_assignments
            where requirement_id=?::uuid and membership_id=?::uuid
            """, String.class, requirement, employeeMembership));
        String plan = planId(organization, unit, week);
        publishAtomic(organization, unit, plan, week,
            "self-large-" + unit.substring(0, 8) + "-" + week);
      }
    }
    String legacyRequirement = create("/api/organizations/" + organization
        + "/staffing/requirements", "{\"unitId\":\"" + firstUnit
            + "\",\"workTypeId\":\"" + firstType
            + "\",\"date\":\"2026-09-07\",\"requiredWorkers\":1}");
    create("/api/organizations/" + organization + "/staffing/requirements/"
        + legacyRequirement + "/assignments", "{\"membershipId\":\""
            + employeeMembership + "\"}");
    ownAssignments.add(jdbc.queryForObject("""
        select id::text from staffing_assignments
        where requirement_id=?::uuid and membership_id=?::uuid
        """, String.class, legacyRequirement, employeeMembership));
    mvc.perform(post("/api/organizations/{org}/staffing/publish", organization)
            .header(HttpHeaders.AUTHORIZATION, token(owner)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"from\":\"2026-09-07\",\"to\":\"2026-09-07\","
                + "\"requirementIds\":[\"" + legacyRequirement + "\"]}"))
        .andExpect(status().isOk());
    for (int index : List.of(2, 4, 6, 8)) {
      mvc.perform(put("/api/my/business-schedule/assignments/{assignment}/result",
              ownAssignments.get(index)).header(HttpHeaders.AUTHORIZATION, token(employee))
              .contentType(MediaType.APPLICATION_JSON)
              .content("{\"actualStartTime\":\"09:00\",\"actualEndTime\":\"16:30\","
                  + "\"breakMinutes\":30,\"completedQuantity\":" + (index + 1)
                  + ",\"submit\":true}"))
          .andExpect(status().isOk());
    }
    assertThat(jdbc.queryForObject("""
        select count(*) from staffing_plan_version_assignments va
        join staffing_plan_versions v on v.id=va.version_id
        where v.organization_id=?::uuid and v.id in (
          select latest_published_version_id from staffing_plans
          where organization_id=?::uuid)
        """, Integer.class, organization, organization)).isGreaterThanOrEqualTo(40);

    clearAllQueries();
    mvc.perform(get("/api/my/business-schedule").param("from", "2026-08-10")
            .param("to", "2026-09-10").header(HttpHeaders.AUTHORIZATION, token(employee)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data[0].assignments.length()").value(9));
    QueryCounts largeQueries = queryCounts();

    assertThat(smallQueries.named()).as("direct JDBC queries, small").isLessThanOrEqualTo(5);
    assertThat(largeQueries.named()).as("direct JDBC queries, large")
        .isEqualTo(smallQueries.named());
    assertThat(largeQueries.hibernate()).as("JPA/Hibernate queries, large")
        .isEqualTo(smallQueries.hibernate());
    assertThat(largeQueries.total()).as("all observed database statements, large")
        .isEqualTo(smallQueries.total());
  }

  @Test
  void unitScopedViewerGetsTargetPlanAndOpaque404ForSiblingUnit() throws Exception {
    Fixture target = fixture(1, false);
    UserAccount planner = verified("scoped-query-" + UUID.randomUUID() + "@example.com");
    String membershipId = create("/api/organizations/" + target.organizationId + "/members",
        "{\"firstName\":\"Scoped\",\"lastName\":\"Viewer\",\"email\":\""
            + planner.getEmail() + "\"}");
    String roleId = create("/api/organizations/" + target.organizationId + "/roles",
        "{\"name\":\"Plan viewer\",\"permissions\":[\"VIEW_SCHEDULE\"]}");
    create("/api/organizations/" + target.organizationId + "/role-assignments",
        "{\"membershipId\":\"" + membershipId + "\",\"roleId\":\"" + roleId
            + "\",\"unitId\":\"" + target.unitId + "\",\"includeDescendants\":true}");
    String siblingUnit = create("/api/organizations/" + target.organizationId + "/units",
        "{\"name\":\"Sibling hotel\",\"type\":\"LOCATION\",\"checkInMode\":\"OPTIONAL\"}");
    String siblingType = create("/api/organizations/" + target.organizationId
        + "/staffing/work-types", "{\"unitId\":\"" + siblingUnit
            + "\",\"code\":\"HD\",\"name\":\"Handyman\",\"defaultStartTime\":\"09:00\","
            + "\"defaultEndTime\":\"17:30\"}");
    create("/api/organizations/" + target.organizationId + "/staffing/requirements",
        "{\"unitId\":\"" + siblingUnit + "\",\"workTypeId\":\"" + siblingType
            + "\",\"date\":\"2026-08-10\",\"requiredWorkers\":1}");
    String siblingPlan = jdbc.queryForObject("""
        select id from staffing_plans where organization_id=?::uuid and unit_id=?::uuid
        """, String.class, target.organizationId, siblingUnit);
    String nextWeekRequirement = create("/api/organizations/" + target.organizationId
        + "/staffing/requirements", "{\"unitId\":\"" + target.unitId
            + "\",\"workTypeId\":\"" + target.workTypeId
            + "\",\"date\":\"2026-08-17\",\"requiredWorkers\":1}");
    assertThat(nextWeekRequirement).isNotBlank();
    String otherPlan = jdbc.queryForObject("""
        select id from staffing_plans where organization_id=?::uuid and unit_id=?::uuid
          and week_start='2026-08-17'
        """, String.class, target.organizationId, target.unitId);
    insertLegacyVersion(target.organizationId, target.unitId, otherPlan, 7);
    Fixture otherBusiness = fixture(1, false);
    String guessed = "\"plan-" + target.planId + "-r1\"";

    mvc.perform(get("/api/organizations/{org}/staffing/plans/{plan}", target.organizationId,
            target.planId).header(HttpHeaders.AUTHORIZATION, token(planner)))
        .andExpect(status().isOk());
    mvc.perform(get("/api/organizations/{org}/staffing/plans/{plan}", target.organizationId,
            siblingPlan).header(HttpHeaders.AUTHORIZATION, token(planner)))
        .andExpect(status().isNotFound());
    mvc.perform(get("/api/organizations/{org}/staffing/plans/{plan}",
            otherBusiness.organizationId, otherBusiness.planId)
            .header(HttpHeaders.AUTHORIZATION, token(planner))
            .header(HttpHeaders.IF_NONE_MATCH, "*"))
        .andExpect(status().isNotFound());
    mvc.perform(get("/api/organizations/{org}/staffing/plans/{plan}", target.organizationId,
            UUID.randomUUID()).header(HttpHeaders.AUTHORIZATION, token(planner))
            .header(HttpHeaders.IF_NONE_MATCH, guessed))
        .andExpect(status().isNotFound());
    mvc.perform(get("/api/organizations/{org}/staffing/plans/{plan}/versions/{version}",
            target.organizationId, target.planId, 7)
            .header(HttpHeaders.AUTHORIZATION, token(planner))
            .header(HttpHeaders.IF_NONE_MATCH, "*"))
        .andExpect(status().isNotFound());
    mvc.perform(get("/api/organizations/{org}/staffing/plans/{plan}/versions/{version}",
            target.organizationId, target.planId, 99)
            .header(HttpHeaders.AUTHORIZATION, token(planner))
            .header(HttpHeaders.IF_NONE_MATCH, guessed))
        .andExpect(status().isNotFound());

    jdbc.update("update organization_memberships set membership_status='SUSPENDED' where id=?::uuid",
        membershipId);
    mvc.perform(get("/api/organizations/{org}/staffing/plans/{plan}", target.organizationId,
            target.planId).header(HttpHeaders.AUTHORIZATION, token(planner))
            .header(HttpHeaders.IF_NONE_MATCH, "*"))
        .andExpect(status().isNotFound());
    jdbc.update("update organization_memberships set membership_status='INVITED' where id=?::uuid",
        membershipId);
    mvc.perform(get("/api/organizations/{org}/staffing/plans/{plan}", target.organizationId,
            target.planId).header(HttpHeaders.AUTHORIZATION, token(planner))
            .header(HttpHeaders.IF_NONE_MATCH, "*"))
        .andExpect(status().isNotFound());
  }

  private UUID insertLegacyVersion(String organizationId, String unitId, String planId,
      int versionNumber) {
    UUID versionId = UUID.randomUUID();
    jdbc.update("""
        insert into staffing_plan_versions(id,organization_id,unit_id,plan_id,version_number,
          source_draft_revision,published_at,timezone,week_start,coverage_required,
          coverage_assigned,coverage_raw_assigned,coverage_effective_assigned,coverage_covered,
          coverage_missing,coverage_overstaffed,coverage_percentage,coverage_basis,warning_count,
          checksum,publication_kind,source_draft_complete,created_at)
        select ?,organization_id,unit_id,id,?,draft_revision,current_timestamp,timezone,week_start,
          0,0,0,0,0,0,0,0,'LEGACY_V90',0,?,'LEGACY_PARTIAL',false,current_timestamp
        from staffing_plans where id=?::uuid and organization_id=?::uuid and unit_id=?::uuid
        """, versionId, versionNumber, "c".repeat(64), planId, organizationId, unitId);
    return versionId;
  }

  private Fixture fixture(int requiredWorkers, boolean assign) throws Exception {
    String organizationId = create("/api/organizations",
        "{\"name\":\"Query Hotel\",\"timezone\":\"Europe/Berlin\"}");
    String unitId = create("/api/organizations/" + organizationId + "/units",
        "{\"name\":\"Hotel München\",\"type\":\"LOCATION\",\"checkInMode\":\"OPTIONAL\"}");
    String membershipId = create("/api/organizations/" + organizationId + "/members",
        "{\"firstName\":\"Ana\",\"lastName\":\"Query\"}");
    jdbc.update("update organization_memberships set membership_status='ACTIVE' where id=?::uuid",
        membershipId);
    String workTypeId = create("/api/organizations/" + organizationId + "/staffing/work-types",
        "{\"unitId\":\"" + unitId + "\",\"code\":\"SPA\",\"name\":\"Spa late\","
            + "\"defaultStartTime\":\"12:00\",\"defaultEndTime\":\"20:30\","
            + "\"defaultBreakMinutes\":30}");
    String requirementId = create("/api/organizations/" + organizationId
        + "/staffing/requirements", "{\"unitId\":\"" + unitId + "\",\"workTypeId\":\""
            + workTypeId + "\",\"date\":\"2026-08-10\",\"requiredWorkers\":"
            + requiredWorkers + "}");
    String assignmentId = null;
    if (assign) {
      assignmentId = create("/api/organizations/" + organizationId + "/staffing/requirements/" + requirementId
          + "/assignments", "{\"membershipId\":\"" + membershipId + "\"}");
    }
    String planId = jdbc.queryForObject("""
        select id from staffing_plans where organization_id=?::uuid and unit_id=?::uuid
          and week_start='2026-08-10'
        """, String.class, organizationId, unitId);
    return new Fixture(organizationId, unitId, planId, workTypeId, requirementId,
        membershipId, assignmentId);
  }

  private String create(String path, String body) throws Exception {
    String response = mvc.perform(post(path).header(HttpHeaders.AUTHORIZATION, token(owner))
            .contentType(MediaType.APPLICATION_JSON).content(body))
        .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
    int start = response.indexOf("\"id\":\"") + 6;
    return response.substring(start, response.indexOf('"', start));
  }

  private String planId(String organizationId, String unitId, String weekStart) {
    return jdbc.queryForObject("""
        select id::text from staffing_plans
        where organization_id=?::uuid and unit_id=?::uuid and week_start=?::date
        """, String.class, organizationId, unitId, weekStart);
  }

  private long planRevision(String planId) {
    return jdbc.queryForObject("select draft_revision from staffing_plans where id=?::uuid",
        Long.class, planId);
  }

  private void publishAtomic(String organizationId, String unitId, String planId,
      String weekStart, String idempotencyKey) throws Exception {
    assertThat(planId(organizationId, unitId, weekStart)).isEqualTo(planId);
    var response = mvc.perform(post("/api/organizations/{org}/staffing/plans/{plan}/publish",
            organizationId, planId).header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH,
                "\"plan-" + planId + "-r" + planRevision(planId) + "\"")
            .header("Idempotency-Key", idempotencyKey).contentType(MediaType.APPLICATION_JSON)
            .content("{}"))
        .andReturn().getResponse();
    assertThat(response.getStatus()).withFailMessage(response.getContentAsString())
        .isEqualTo(201);
  }

  private UserAccount verified(String email) {
    UserAccount value = new UserAccount(email, "hash");
    value.verifyEmail();
    return users.saveAndFlush(value);
  }

  private String token(UserAccount user) {
    return "Bearer " + jwt.generateAccessToken(user);
  }

  private long observedQueries() {
    return mockingDetails(observedQueryJdbc).getInvocations().stream()
        .filter(value -> value.getMethod().getName().equals("query")).count();
  }

  private long granularCoverageQueries() {
    return mockingDetails(observedQueryJdbc).getInvocations().stream()
        .filter(value -> value.getMethod().getName().equals("query"))
        .map(value -> value.getArgument(0, String.class))
        .filter(sql -> sql.contains("staffing_plan_version_requirement_coverage")
            || sql.contains("staffing_plan_version_day_coverage"))
        .count();
  }

  private void clearAllQueries() {
    clearInvocations(observedQueryJdbc);
    entityManagerFactory.unwrap(SessionFactory.class).getStatistics().clear();
  }

  private QueryCounts queryCounts() {
    long named = observedQueries();
    long hibernate = entityManagerFactory.unwrap(SessionFactory.class)
        .getStatistics().getPrepareStatementCount();
    return new QueryCounts(named, hibernate, named + hibernate);
  }

  private void assertPrivateManagerFieldsAbsent(String json) {
    assertThat(json).doesNotContainIgnoringCase("email")
        .doesNotContain("PRIVATE REQUEST NOTE")
        .doesNotContain("absenceNote")
        .doesNotContain("requestNote")
        .doesNotContain("reviewer")
        .doesNotContain("entityManager")
        .doesNotContain("hibernateLazyInitializer")
        .doesNotContain("workRecord");
  }

  private void assertPrivateVersionFieldsAbsent(String json) {
    assertPrivateManagerFieldsAbsent(json);
    assertThat(json)
        .doesNotContain("PRIVATE PUBLICATION NOTE")
        .doesNotContain("PRIVATE DAY NOTE")
        .doesNotContain("PRIVATE REQUIREMENT NOTE")
        .doesNotContain("PRIVATE ABSENCE NOTE")
        .doesNotContain("PRIVATE REVIEWER")
        .doesNotContain("PRIVATE ACK NOTE")
        .doesNotContain("publicationNote")
        .doesNotContain("acknowledgedBy")
        .doesNotContain("sourceRequestId")
        .doesNotContain("notes");
  }

  private record Fixture(String organizationId, String unitId, String planId,
      String workTypeId, String requirementId, String membershipId, String assignmentId) {}

  private record QueryCounts(long named, long hibernate, long total) {}
}
