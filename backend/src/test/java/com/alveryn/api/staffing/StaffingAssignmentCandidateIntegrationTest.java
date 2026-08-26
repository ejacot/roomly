package com.alveryn.api.staffing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.mockingDetails;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.alveryn.api.auth.security.JwtService;
import com.alveryn.api.organization.repository.OrganizationRepository;
import com.alveryn.api.testsupport.IntegrationTestDatabaseCleaner;
import com.alveryn.api.user.entity.UserAccount;
import com.alveryn.api.user.repository.UserAccountRepository;
import jakarta.persistence.EntityManagerFactory;
import java.util.UUID;
import org.hibernate.SessionFactory;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

@SpringBootTest
class StaffingAssignmentCandidateIntegrationTest {
  @Autowired WebApplicationContext context;
  @Autowired JwtService jwt;
  @Autowired UserAccountRepository users;
  @Autowired OrganizationRepository organizations;
  @Autowired JdbcTemplate jdbc;
  @Autowired EntityManagerFactory entityManagerFactory;
  @MockitoSpyBean NamedParameterJdbcTemplate observedJdbc;

  MockMvc mvc;
  UserAccount owner;

  @BeforeEach
  void setup() {
    mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    jdbc.update("delete from staffing_plan_publication_operations");
    IntegrationTestDatabaseCleaner.cleanWorkspaceData(jdbc);
    entityManagerFactory.unwrap(SessionFactory.class).getStatistics().setStatisticsEnabled(true);
    owner = verified("candidate-owner-" + UUID.randomUUID() + "@example.com");
  }

  @Test
  void returnsDeterministicRecommendationAndCanonicalCoverageWithoutWriting() throws Exception {
    Fixture fixture = fixture(1);
    UUID ana = member(fixture.organizationId, "Ana", "Dumitru", "ACTIVE");
    UUID bob = member(fixture.organizationId, "Bob", "Marin", "ACTIVE");
    UUID historicRequirement = requirement(fixture, "2026-08-03", "12:00", "20:30", 1,
        fixture.unitId);
    assignment(historicRequirement, ana, fixture.ownerMembershipId, null, null);
    long revision = revision(fixture.planId);
    int assignmentsBefore = count("select count(*) from staffing_assignments");

    var result = mvc.perform(get(candidatePath(fixture))
            .param("requirementId", fixture.requirementId.toString())
            .header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isOk())
        .andExpect(header().string(HttpHeaders.ETAG,
            "\"plan-" + fixture.planId + "-r" + revision + "\""))
        .andExpect(header().string(HttpHeaders.CACHE_CONTROL,
            org.hamcrest.Matchers.allOf(org.hamcrest.Matchers.containsString("private"),
                org.hamcrest.Matchers.containsString("no-store"))))
        .andExpect(jsonPath("$.data.planId").value(fixture.planId.toString()))
        .andExpect(jsonPath("$.data.requirementId").value(fixture.requirementId.toString()))
        .andExpect(jsonPath("$.data.requirement.workTypeCode").value("SPA"))
        .andExpect(jsonPath("$.data.requirement.coverage.missing").value(1))
        .andExpect(jsonPath("$.data.projection.membershipId").value(ana.toString()))
        .andExpect(jsonPath("$.data.projection.before.covered").value(0))
        .andExpect(jsonPath("$.data.projection.after.covered").value(1))
        .andExpect(jsonPath("$.data.projection.after.missing").value(0))
        .andExpect(jsonPath("$.data.projection.resolvesOpenPosition").value(true))
        .andExpect(jsonPath("$.data.candidates[0].membershipId").value(ana.toString()))
        .andExpect(jsonPath("$.data.candidates[0].recommended").value(true))
        .andExpect(jsonPath("$.data.candidates[0].rank").value(1))
        .andExpect(jsonPath("$.data.candidates[0].eligibility").value("ELIGIBLE"))
        .andExpect(jsonPath("$.data.candidates[0].matchingWorkTypeAssignments").value(1))
        .andReturn();
    String json = result.getResponse().getContentAsString();
    assertThat(json).contains("USUAL_WORK_TYPE", "AVAILABLE_FOR_INTERVAL")
        .doesNotContainIgnoringCase("email")
        .doesNotContain("candidate-owner-")
        .doesNotContain("workRecord")
        .doesNotContain("salary")
        .doesNotContain("rate")
        .doesNotContain("PRIVATE");
    assertThat(revision(fixture.planId)).isEqualTo(revision);
    assertThat(count("select count(*) from staffing_assignments")).isEqualTo(assignmentsBefore);

    mvc.perform(get(candidatePath(fixture))
            .param("requirementId", fixture.requirementId.toString())
            .header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_NONE_MATCH,
                "\"plan-" + fixture.planId + "-r" + revision + "\""))
        .andExpect(status().isNotModified())
        .andExpect(header().string(HttpHeaders.CACHE_CONTROL,
            org.hamcrest.Matchers.containsString("no-store")))
        .andExpect(jsonPath("$").doesNotExist());

    // The stable tie breaker is display name and UUID, never insertion order.
    assertThat(ana).isNotEqualTo(bob);
  }

  @Test
  void treatsAnOpenEndedRequirementAsAssignableFromItsKnownStart() throws Exception {
    Fixture fixture = fixture(1);
    UUID member = member(fixture.organizationId, "Day", "Worker", "ACTIVE");
    jdbc.update("update staffing_requirements set start_time='08:00',end_time=null where id=?",
        fixture.requirementId);

    mvc.perform(get(candidatePath(fixture))
            .param("requirementId", fixture.requirementId.toString())
            .header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.requirement.startTime").value("08:00:00"))
        .andExpect(jsonPath("$.data.requirement.endTime").doesNotExist())
        .andExpect(jsonPath("$.data.candidates[?(@.membershipId=='" + member
            + "')].eligibility").value("ELIGIBLE"))
        .andExpect(jsonPath("$.data.candidates[?(@.membershipId=='" + member
            + "')].reasons[?(@.code=='AVAILABLE_FOR_INTERVAL')]").exists());
  }

  @Test
  void explainsTimeAwayRequestsOverlapTouchingIntervalsAndMembershipStatusWithoutLeaks()
      throws Exception {
    Fixture fixture = fixture(1);
    UUID vacation = member(fixture.organizationId, "Vacation", "Worker", "ACTIVE");
    UUID sick = member(fixture.organizationId, "Sick", "Worker", "ACTIVE");
    UUID dayOff = member(fixture.organizationId, "Day off", "Worker", "ACTIVE");
    UUID pending = member(fixture.organizationId, "Pending", "Worker", "ACTIVE");
    UUID overlap = member(fixture.organizationId, "Overlap", "Worker", "ACTIVE");
    UUID touching = member(fixture.organizationId, "Touching", "Worker", "ACTIVE");
    UUID duplicate = member(fixture.organizationId, "Duplicate", "Worker", "ACTIVE");
    UUID invited = member(fixture.organizationId, "Invited", "Worker", "INVITED");
    UUID suspended = member(fixture.organizationId, "Suspended", "Worker", "SUSPENDED");
    dayEntry(fixture, vacation, "VACATION", "PRIVATE VACATION NOTE");
    dayEntry(fixture, sick, "SICK", "PRIVATE SICK NOTE");
    dayEntry(fixture, dayOff, "REST_DAY", "PRIVATE DAY OFF NOTE");
    jdbc.update("""
        insert into staffing_absence_requests(id,organization_id,membership_id,absence_type,
          start_date,end_date,notes,request_status,created_at,updated_at)
        values(?,?,?,'REST_DAY','2026-08-10','2026-08-10','PRIVATE WHATSAPP NOTE','PENDING',
          current_timestamp,current_timestamp)
        """, UUID.randomUUID(), fixture.organizationId, pending);
    UUID sibling = unit(fixture.organizationId, "Sibling Hotel");
    UUID overlappingRequirement = requirement(fixture, "2026-08-10", "13:00", "18:00", 1,
        sibling);
    UUID touchingRequirement = requirement(fixture, "2026-08-10", "08:00", "12:00", 1,
        sibling);
    assignment(overlappingRequirement, overlap, fixture.ownerMembershipId, null, null);
    assignment(touchingRequirement, touching, fixture.ownerMembershipId, null, null);
    assignment(fixture.requirementId, duplicate, fixture.ownerMembershipId, null, null);
    Fixture foreign = fixture(1);
    UUID foreignMember = member(foreign.organizationId, "Foreign", "Secret", "ACTIVE");

    String json = mvc.perform(get(candidatePath(fixture))
            .param("requirementId", fixture.requirementId.toString())
            .header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.candidates[?(@.membershipId=='" + vacation
            + "')].eligibility").value("INELIGIBLE"))
        .andExpect(jsonPath("$.data.candidates[?(@.membershipId=='" + sick
            + "')].eligibility").value("INELIGIBLE"))
        .andExpect(jsonPath("$.data.candidates[?(@.membershipId=='" + dayOff
            + "')].eligibility").value("INELIGIBLE"))
        .andExpect(jsonPath("$.data.candidates[?(@.membershipId=='" + pending
            + "')].eligibility").value("ELIGIBLE_WITH_WARNING"))
        .andExpect(jsonPath("$.data.candidates[?(@.membershipId=='" + overlap
            + "')].availability").value("OVERLAP_CONFLICT"))
        .andExpect(jsonPath("$.data.candidates[?(@.membershipId=='" + touching
            + "')].eligibility").value("ELIGIBLE_WITH_WARNING"))
        .andExpect(jsonPath("$.data.candidates[?(@.membershipId=='" + duplicate
            + "')].availability").value("DUPLICATE_ASSIGNMENT"))
        .andExpect(jsonPath("$.data.candidates[?(@.membershipId=='" + invited
            + "')].eligibility").value("INELIGIBLE"))
        .andExpect(jsonPath("$.data.candidates[?(@.membershipId=='" + suspended
            + "')].eligibility").value("INELIGIBLE"))
        .andReturn().getResponse().getContentAsString();
    assertThat(json).contains("APPROVED_TIME_AWAY", "PENDING_REQUEST", "OVERLAP_CONFLICT",
            "DUPLICATE_ASSIGNMENT", "OTHER_UNIT_ASSIGNMENT")
        .doesNotContain("PRIVATE VACATION NOTE")
        .doesNotContain("PRIVATE SICK NOTE")
        .doesNotContain("PRIVATE DAY OFF NOTE")
        .doesNotContain("PRIVATE WHATSAPP NOTE")
        .doesNotContain(sibling.toString())
        .doesNotContain(foreignMember.toString())
        .doesNotContain("Foreign Secret")
        .doesNotContainIgnoringCase("email");
  }

  @Test
  void authorizationIsOpaqueOutsideTenantOrUnitAndForbiddenWithoutViewPermission()
      throws Exception {
    Fixture fixture = fixture(1);
    UserAccount employee = verified("candidate-no-view-" + UUID.randomUUID() + "@example.com");
    UUID employeeMembership = activeUserMembership(fixture.organizationId, employee);

    mvc.perform(get(candidatePath(fixture)).param("requirementId", fixture.requirementId.toString())
            .header(HttpHeaders.AUTHORIZATION, token(employee)))
        .andExpect(status().isForbidden());

    UUID viewRole = UUID.randomUUID();
    jdbc.update("""
        insert into organization_roles(id,organization_id,name,permissions,system_role,
          created_at,updated_at)
        values(?,?,?,array['VIEW_SCHEDULE']::text[],false,current_timestamp,current_timestamp)
        """, viewRole, fixture.organizationId, "Scoped viewer " + viewRole);
    jdbc.update("""
        insert into organization_role_assignments(id,membership_id,role_id,unit_id,
          include_descendants,created_at,updated_at)
        values(?,?,?,?,false,current_timestamp,current_timestamp)
        """, UUID.randomUUID(), employeeMembership, viewRole, fixture.unitId);
    mvc.perform(get(candidatePath(fixture)).param("requirementId", fixture.requirementId.toString())
            .header(HttpHeaders.AUTHORIZATION, token(employee)))
        .andExpect(status().isOk());

    UUID siblingUnit = unit(fixture.organizationId, "Restricted sibling");
    UUID siblingRequirement = requirement(fixture, "2026-08-10", "12:00", "20:30", 1,
        siblingUnit);
    UUID siblingPlan = jdbc.queryForObject("""
        select id from staffing_plans where organization_id=? and unit_id=?
          and week_start='2026-08-10'
        """, UUID.class, fixture.organizationId, siblingUnit);
    mvc.perform(get("/api/organizations/" + fixture.organizationId + "/staffing/plans/"
            + siblingPlan + "/assignment-candidates")
            .param("requirementId", siblingRequirement.toString())
            .header(HttpHeaders.AUTHORIZATION, token(employee))
            .header(HttpHeaders.IF_NONE_MATCH, "*"))
        .andExpect(status().isNotFound());

    Fixture foreign = fixture(1);
    mvc.perform(get(candidatePath(foreign)).param("requirementId", foreign.requirementId.toString())
            .header(HttpHeaders.AUTHORIZATION, token(employee)).header(HttpHeaders.IF_NONE_MATCH, "*"))
        .andExpect(status().isNotFound());

    jdbc.update("update organization_memberships set membership_status='SUSPENDED' where id=?",
        employeeMembership);
    mvc.perform(get(candidatePath(fixture)).param("requirementId", fixture.requirementId.toString())
            .header(HttpHeaders.AUTHORIZATION, token(employee)).header(HttpHeaders.IF_NONE_MATCH, "*"))
        .andExpect(status().isNotFound());
    jdbc.update("update organization_memberships set membership_status='INVITED' where id=?",
        employeeMembership);
    mvc.perform(get(candidatePath(fixture)).param("requirementId", fixture.requirementId.toString())
            .header(HttpHeaders.AUTHORIZATION, token(employee)).header(HttpHeaders.IF_NONE_MATCH, "*"))
        .andExpect(status().isNotFound());
  }

  @Test
  void ranksObservedBusinessHistoryAndWeeklyLoadDeterministicallyWithoutInventedScores()
      throws Exception {
    Fixture fixture = fixture(1);
    UUID alpha = member(fixture.organizationId, "Alpha", "Usual", "ACTIVE");
    UUID beta = member(fixture.organizationId, "Beta", "Unusual", "ACTIVE");
    UUID gamma = member(fixture.organizationId, "Gamma", "Busy", "ACTIVE");
    UUID otherWorkType = UUID.randomUUID();
    jdbc.update("""
        insert into organization_work_types(id,organization_id,unit_id,code,name,color,
          default_start_time,default_end_time,default_break_minutes,active,created_at,updated_at)
        values(?,?,?,'HD','Handyman','#10B981','08:00','10:00',0,true,
          current_timestamp,current_timestamp)
        """, otherWorkType, fixture.organizationId, fixture.unitId);
    UUID usualHistory = requirement(fixture, "2026-08-03", "12:00", "20:30", 1,
        fixture.unitId);
    assignment(usualHistory, alpha, fixture.ownerMembershipId, null, null);
    UUID unusualHistory = requirement(fixture, "2026-08-04", "08:00", "10:00", 1,
        fixture.unitId);
    jdbc.update("update staffing_requirements set work_type_id=? where id=?", otherWorkType,
        unusualHistory);
    assignment(unusualHistory, beta, fixture.ownerMembershipId, null, null);
    UUID busyAssignment = requirement(fixture, "2026-08-11", "08:00", "10:00", 1,
        fixture.unitId);
    jdbc.update("update staffing_requirements set work_type_id=? where id=?", otherWorkType,
        busyAssignment);
    assignment(busyAssignment, gamma, fixture.ownerMembershipId, null, null);

    String first = mvc.perform(get(candidatePath(fixture))
            .param("requirementId", fixture.requirementId.toString())
            .header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.candidates[0].membershipId").value(alpha.toString()))
        .andExpect(jsonPath("$.data.candidates[0].rank").value(1))
        .andExpect(jsonPath("$.data.candidates[?(@.membershipId=='" + beta
            + "')].eligibility").value("ELIGIBLE_WITH_WARNING"))
        .andExpect(jsonPath("$.data.candidates[?(@.membershipId=='" + gamma
            + "')].weeklyScheduledMinutes").value(120))
        .andReturn().getResponse().getContentAsString();
    String second = mvc.perform(get(candidatePath(fixture))
            .param("requirementId", fixture.requirementId.toString())
            .header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
    assertThat(second).isEqualTo(first);
    assertThat(first).contains("USUAL_WORK_TYPE", "UNUSUAL_WORK_TYPE", "LOWER_WEEKLY_LOAD")
        .doesNotContain("score").doesNotContain("confidence");
  }

  @Test
  void queryCountDoesNotGrowWithCandidateCount() throws Exception {
    Fixture small = fixture(1);
    for (int index = 0; index < 5; index++) {
      member(small.organizationId, "Small", Integer.toString(index), "ACTIVE");
    }
    clearQueries();
    mvc.perform(get(candidatePath(small)).param("requirementId", small.requirementId.toString())
            .header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isOk());
    QueryCounts smallQueries = queryCounts();

    Fixture large = fixture(1);
    for (int index = 0; index < 100; index++) {
      member(large.organizationId, "Large", String.format("%03d", index), "ACTIVE");
    }
    clearQueries();
    mvc.perform(get(candidatePath(large)).param("requirementId", large.requirementId.toString())
            .header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.candidates.length()")
            .value(org.hamcrest.Matchers.greaterThanOrEqualTo(100)));
    QueryCounts largeQueries = queryCounts();

    assertThat(largeQueries.named()).isEqualTo(smallQueries.named());
    assertThat(largeQueries.hibernate()).isEqualTo(smallQueries.hibernate());
    assertThat(largeQueries.total()).isEqualTo(smallQueries.total());
  }

  private Fixture fixture(int requiredWorkers) throws Exception {
    String organization = create("/api/organizations",
        "{\"name\":\"Candidate Hotel\",\"timezone\":\"Europe/Berlin\"}");
    UUID organizationId = UUID.fromString(organization);
    UUID unitId = UUID.fromString(create("/api/organizations/" + organization + "/units",
        "{\"name\":\"Hotel München\",\"type\":\"LOCATION\",\"checkInMode\":\"OPTIONAL\"}"));
    UUID workTypeId = UUID.fromString(create("/api/organizations/" + organization
        + "/staffing/work-types", "{\"unitId\":\"" + unitId
            + "\",\"code\":\"SPA\",\"name\":\"Spa late\","
            + "\"defaultStartTime\":\"12:00\",\"defaultEndTime\":\"20:30\","
            + "\"defaultBreakMinutes\":30}"));
    UUID requirementId = UUID.fromString(create("/api/organizations/" + organization
        + "/staffing/requirements", "{\"unitId\":\"" + unitId
            + "\",\"workTypeId\":\"" + workTypeId
            + "\",\"date\":\"2026-08-10\",\"requiredWorkers\":" + requiredWorkers + "}"));
    UUID planId = jdbc.queryForObject("""
        select id from staffing_plans where organization_id=? and unit_id=?
          and week_start='2026-08-10'
        """, UUID.class, organizationId, unitId);
    UUID ownerMembership = jdbc.queryForObject("""
        select id from organization_memberships
        where organization_id=? and membership_role='OWNER'
        """, UUID.class, organizationId);
    return new Fixture(organizationId, unitId, planId, workTypeId, requirementId,
        ownerMembership);
  }

  private UUID requirement(Fixture source, String date, String start, String end,
      int workers, UUID unitId) {
    UUID plan = jdbc.query("""
        select id from staffing_plans where organization_id=? and unit_id=?
          and week_start=date_trunc('week',?::date)::date
        """, (rs, row) -> rs.getObject("id", UUID.class), source.organizationId, unitId, date)
        .stream().findFirst().orElse(null);
    if (plan == null) {
      plan = UUID.randomUUID();
      jdbc.update("""
          insert into staffing_plans(id,organization_id,unit_id,week_start,timezone,plan_status,
            draft_revision,lock_version,created_by_membership_id,updated_by_membership_id,
            created_at,updated_at)
          values(?,?,?,date_trunc('week',?::date)::date,'Europe/Berlin','ACTIVE',0,0,?,?,
            current_timestamp,current_timestamp)
          """, plan, source.organizationId, unitId, date, source.ownerMembershipId,
          source.ownerMembershipId);
    }
    UUID finalPlan = plan;
    UUID day = jdbc.query("select id from staffing_plan_days where plan_id=? and work_date=?::date",
        (rs, row) -> rs.getObject("id", UUID.class), plan, date).stream().findFirst().orElse(null);
    if (day == null) {
      day = UUID.randomUUID();
      jdbc.update("""
          insert into staffing_plan_days(id,plan_id,organization_id,work_date,source,
            created_at,updated_at)
          values(?,?,?,?::date,'MANUAL',current_timestamp,current_timestamp)
          """, day, finalPlan, source.organizationId, date);
    }
    UUID requirement = UUID.randomUUID();
    jdbc.update("""
        insert into staffing_requirements(id,plan_day_id,organization_id,unit_id,work_type_id,
          work_date,start_time,end_time,required_workers,publication_status,
          created_by_membership_id,created_at,updated_at)
        values(?,?,?,?,?,?::date,?::time,?::time,?,'DRAFT',?,current_timestamp,current_timestamp)
        """, requirement, day, source.organizationId, unitId, source.workTypeId, date, start,
        end, workers, source.ownerMembershipId);
    return requirement;
  }

  private UUID unit(UUID organizationId, String name) {
    UUID id = UUID.randomUUID();
    jdbc.update("""
        insert into organization_units(id,organization_id,name,unit_type,check_in_mode,active,
          display_order,created_at,updated_at)
        values(?,? ,?,'LOCATION','OPTIONAL',true,0,current_timestamp,current_timestamp)
        """, id, organizationId, name);
    return id;
  }

  private UUID member(UUID organizationId, String first, String last, String status) {
    UUID id = UUID.randomUUID();
    jdbc.update("""
        insert into organization_memberships(id,organization_id,first_name,last_name,
          membership_role,membership_status,joined_at,created_at,updated_at)
        values(?,?,?,?,'EMPLOYEE',?,current_timestamp,current_timestamp,current_timestamp)
        """, id, organizationId, first, last, status);
    return id;
  }

  private UUID activeUserMembership(UUID organizationId, UserAccount user) {
    UUID id = UUID.randomUUID();
    jdbc.update("""
        insert into organization_memberships(id,organization_id,user_id,membership_role,
          membership_status,joined_at,created_at,updated_at)
        values(?,?,?,'EMPLOYEE','ACTIVE',current_timestamp,current_timestamp,current_timestamp)
        """, id, organizationId, user.getId());
    return id;
  }

  private void dayEntry(Fixture fixture, UUID member, String type, String note) {
    jdbc.update("""
        insert into staffing_member_day_entries(id,organization_id,membership_id,work_date,
          entry_type,notes,created_by_membership_id,created_at,updated_at)
        values(?,?,?,'2026-08-10',?,?,?,current_timestamp,current_timestamp)
        """, UUID.randomUUID(), fixture.organizationId, member, type, note,
        fixture.ownerMembershipId);
  }

  private void assignment(UUID requirement, UUID membership, UUID actor, String start,
      String end) {
    jdbc.update("""
        insert into staffing_assignments(id,requirement_id,membership_id,start_time,end_time,
          assignment_status,assigned_by_membership_id,created_at,updated_at)
        values(?,?,?,?::time,?::time,'ASSIGNED',?,current_timestamp,current_timestamp)
        """, UUID.randomUUID(), requirement, membership, start, end, actor);
  }

  private String create(String path, String body) throws Exception {
    String response = mvc.perform(post(path).header(HttpHeaders.AUTHORIZATION, token(owner))
            .contentType(MediaType.APPLICATION_JSON).content(body))
        .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
    int start = response.indexOf("\"id\":\"") + 6;
    return response.substring(start, response.indexOf('"', start));
  }

  private String candidatePath(Fixture fixture) {
    return "/api/organizations/" + fixture.organizationId + "/staffing/plans/"
        + fixture.planId + "/assignment-candidates";
  }

  private long revision(UUID planId) {
    return jdbc.queryForObject("select draft_revision from staffing_plans where id=?",
        Long.class, planId);
  }

  private int count(String sql) { return jdbc.queryForObject(sql, Integer.class); }

  private UserAccount verified(String email) {
    UserAccount value = new UserAccount(email, "hash");
    value.verifyEmail();
    return users.saveAndFlush(value);
  }

  private String token(UserAccount user) { return "Bearer " + jwt.generateAccessToken(user); }

  private void clearQueries() {
    clearInvocations(observedJdbc);
    entityManagerFactory.unwrap(SessionFactory.class).getStatistics().clear();
  }

  private QueryCounts queryCounts() {
    long named = mockingDetails(observedJdbc).getInvocations().stream()
        .filter(value -> value.getMethod().getName().equals("query")).count();
    long hibernate = entityManagerFactory.unwrap(SessionFactory.class).getStatistics()
        .getPrepareStatementCount();
    return new QueryCounts(named, hibernate, named + hibernate);
  }

  private record Fixture(UUID organizationId, UUID unitId, UUID planId, UUID workTypeId,
      UUID requirementId, UUID ownerMembershipId) {}

  private record QueryCounts(long named, long hibernate, long total) {}
}
