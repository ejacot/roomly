package com.alveryn.api.staffing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
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
import java.util.List;
import java.time.LocalDate;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

@SpringBootTest
class StaffingPlanDraftMutationIntegrationTest {
  @Autowired WebApplicationContext context;
  @Autowired JwtService jwt;
  @Autowired UserAccountRepository users;
  @Autowired OrganizationRepository organizations;
  @Autowired JdbcTemplate jdbc;

  MockMvc mvc;
  UserAccount owner;

  @BeforeEach
  void setup() {
    mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    jdbc.update("delete from staffing_plan_draft_mutation_operations");
    jdbc.update("delete from staffing_plan_publication_operations");
    IntegrationTestDatabaseCleaner.cleanWorkspaceData(jdbc);
    owner = verified("mutation-owner-" + UUID.randomUUID() + "@example.com");
  }

  @Test
  void strongEtagAndIdempotencyProtectCreateAndC5aImmediatelySeesIt() throws Exception {
    Fixture fixture = fixture();
    String initial = etag(fixture.planId(), 1);
    String path = "/api/organizations/" + fixture.organizationId()
        + "/staffing/plans/" + fixture.planId() + "/demand/requirements";
    String body = "{\"date\":\"2026-08-11\",\"workTypeId\":\"" + fixture.workTypeId()
        + "\",\"requiredWorkers\":2,\"requiredQuantity\":2}";

    mvc.perform(post(path).header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, initial).header("Idempotency-Key", "create-tuesday")
            .contentType(MediaType.APPLICATION_JSON).content(body))
        .andExpect(status().isCreated())
        .andExpect(header().string(HttpHeaders.ETAG, etag(fixture.planId(), 2)))
        .andExpect(jsonPath("$.data.previousDraftRevision").value(1))
        .andExpect(jsonPath("$.data.currentDraftRevision").value(2))
        .andExpect(jsonPath("$.data.changed").value(true));

    String replay = mvc.perform(post(path).header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, initial).header("Idempotency-Key", "create-tuesday")
            .contentType(MediaType.APPLICATION_JSON).content(body))
        .andExpect(status().isCreated())
        .andExpect(header().string(HttpHeaders.ETAG, etag(fixture.planId(), 2)))
        .andReturn().getResponse().getContentAsString();
    assertThat(replay).doesNotContainIgnoringCase("email")
        .doesNotContain("organizationUnit").doesNotContain("hibernateLazyInitializer");
    assertThat(jdbc.queryForObject("""
        select count(*) from staffing_requirements where plan_day_id in
          (select id from staffing_plan_days where plan_id=?::uuid)
        """, Integer.class, fixture.planId())).isEqualTo(2);

    mvc.perform(post(path).header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, initial).header("Idempotency-Key", "create-tuesday")
            .contentType(MediaType.APPLICATION_JSON)
            .content(body.replace("\"requiredWorkers\":2", "\"requiredWorkers\":3")))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("IDEMPOTENCY_CONFLICT"));

    mvc.perform(get("/api/organizations/{org}/staffing/plans/{plan}/demand",
            fixture.organizationId(), fixture.planId())
            .header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isOk())
        .andExpect(header().string(HttpHeaders.ETAG, etag(fixture.planId(), 2)))
        .andExpect(jsonPath("$.data.days[1].requirements[0].requiredWorkers").value(2));
  }

  @Test
  void preconditionsAreStrictAndNoopDoesNotAdvanceRevision() throws Exception {
    Fixture fixture = fixture();
    String createPath = "/api/organizations/" + fixture.organizationId()
        + "/staffing/plans/" + fixture.planId() + "/demand/requirements";
    String updatePath = "/api/organizations/" + fixture.organizationId() + "/staffing/plans/"
        + fixture.planId() + "/demand/requirements/" + fixture.requirementId();
    String unchanged = "{\"startTime\":\"12:00\",\"endTime\":\"20:30\","
        + "\"requiredWorkers\":1,\"requiredQuantity\":1}";

    mvc.perform(post(createPath).header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 1))
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"date\":\"2026-08-11\",\"workTypeId\":\""
                + fixture.workTypeId() + "\",\"requiredWorkers\":1}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));

    mvc.perform(put(updatePath).header(HttpHeaders.AUTHORIZATION, token(owner))
            .contentType(MediaType.APPLICATION_JSON).content(unchanged))
        .andExpect(status().isPreconditionRequired())
        .andExpect(jsonPath("$.code").value("PRECONDITION_REQUIRED"));
    mvc.perform(put(updatePath).header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, "W/" + etag(fixture.planId(), 1))
            .contentType(MediaType.APPLICATION_JSON).content(unchanged))
        .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_IF_MATCH"));
    mvc.perform(put(updatePath).header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, "*")
            .contentType(MediaType.APPLICATION_JSON).content(unchanged))
        .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_IF_MATCH"));
    mvc.perform(put(updatePath).header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, etag(UUID.randomUUID().toString(), 1))
            .contentType(MediaType.APPLICATION_JSON).content(unchanged))
        .andExpect(status().isPreconditionFailed())
        .andExpect(jsonPath("$.code").value("STALE_PLAN_REVISION"));

    mvc.perform(put(updatePath).header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, "\"different\", " + etag(fixture.planId(), 1))
            .contentType(MediaType.APPLICATION_JSON).content(unchanged))
        .andExpect(status().isBadRequest());
    mvc.perform(put(updatePath).header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, etag(UUID.randomUUID().toString(), 9) + ", "
                + etag(fixture.planId(), 1))
            .contentType(MediaType.APPLICATION_JSON).content(unchanged))
        .andExpect(status().isOk())
        .andExpect(header().string(HttpHeaders.ETAG, etag(fixture.planId(), 1)))
        .andExpect(jsonPath("$.data.changed").value(false));

    assertThat(revision(fixture.planId())).isEqualTo(1);
  }

  @Test
  void batchPreconditionsUseTheSameStrongPlanEtagContract() throws Exception {
    Fixture fixture = fixture();
    String demandPath = "/api/organizations/" + fixture.organizationId()
        + "/staffing/plans/" + fixture.planId() + "/demand/batch";
    String demand = """
        {"actions":[{"operation":"CREATE","create":{"date":"2026-08-11",
          "workTypeId":"%s","requiredWorkers":1,"requiredQuantity":1}}]}
        """.formatted(fixture.workTypeId());

    mvc.perform(post(demandPath).header(HttpHeaders.AUTHORIZATION, token(owner))
            .header("Idempotency-Key", "batch-missing-if-match")
            .contentType(MediaType.APPLICATION_JSON).content(demand))
        .andExpect(status().isPreconditionRequired())
        .andExpect(jsonPath("$.code").value("PRECONDITION_REQUIRED"));
    mvc.perform(post(demandPath).header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, "W/" + etag(fixture.planId(), 1))
            .header("Idempotency-Key", "batch-weak")
            .contentType(MediaType.APPLICATION_JSON).content(demand))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("INVALID_IF_MATCH"));
    mvc.perform(post(demandPath).header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, etag(UUID.randomUUID().toString(), 8) + ", "
                + etag(fixture.planId(), 1))
            .header("Idempotency-Key", "batch-list-current")
            .contentType(MediaType.APPLICATION_JSON).content(demand))
        .andExpect(status().isOk())
        .andExpect(header().string(HttpHeaders.ETAG, etag(fixture.planId(), 2)));
    mvc.perform(post(demandPath).header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 1))
            .header("Idempotency-Key", "batch-stale")
            .contentType(MediaType.APPLICATION_JSON).content(demand))
        .andExpect(status().isPreconditionFailed())
        .andExpect(header().string(HttpHeaders.ETAG, etag(fixture.planId(), 2)))
        .andExpect(jsonPath("$.code").value("STALE_PLAN_REVISION"));

    String assignmentPath = "/api/organizations/" + fixture.organizationId()
        + "/staffing/plans/" + fixture.planId() + "/schedule/assignments/batch";
    String assignment = """
        {"actions":[{"operation":"CREATE","create":{"requirementId":"%s",
          "membershipId":"%s"}}]}
        """.formatted(fixture.requirementId(), fixture.memberId());
    mvc.perform(post(assignmentPath).header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, "*").header("Idempotency-Key", "assignment-star")
            .contentType(MediaType.APPLICATION_JSON).content(assignment))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("INVALID_IF_MATCH"));
    mvc.perform(post(assignmentPath).header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 2) + ", "
                + etag(UUID.randomUUID().toString(), 1))
            .header("Idempotency-Key", "assignment-list-current")
            .contentType(MediaType.APPLICATION_JSON).content(assignment))
        .andExpect(status().isOk())
        .andExpect(header().string(HttpHeaders.ETAG, etag(fixture.planId(), 3)));
  }

  @Test
  void batchPreflightRejectsContradictionsDuplicatesAndOversizeBeforeAnyWrite()
      throws Exception {
    Fixture fixture = fixture();
    long requirementsBefore = jdbc.queryForObject(
        "select count(*) from staffing_requirements where organization_id=?::uuid",
        Long.class, fixture.organizationId());
    long auditBefore = jdbc.queryForObject(
        "select count(*) from staffing_change_events where organization_id=?::uuid",
        Long.class, fixture.organizationId());
    String duplicateDemand = """
        {"actions":[
          {"operation":"UPDATE","requirementId":"%s","update":{"requiredWorkers":2}},
          {"operation":"DELETE","requirementId":"%s"}
        ]}
        """.formatted(fixture.requirementId(), fixture.requirementId());
    mvc.perform(post("/api/organizations/{org}/staffing/plans/{plan}/demand/batch",
            fixture.organizationId(), fixture.planId())
            .header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 1))
            .header("Idempotency-Key", "duplicate-demand-resource")
            .contentType(MediaType.APPLICATION_JSON).content(duplicateDemand))
        .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("BATCH_CONFLICT"));

    String duplicateAssignments = """
        {"actions":[
          {"operation":"CREATE","create":{"requirementId":"%s","membershipId":"%s"}},
          {"operation":"CREATE","create":{"requirementId":"%s","membershipId":"%s"}}
        ]}
        """.formatted(fixture.requirementId(), fixture.memberId(),
            fixture.requirementId(), fixture.memberId());
    mvc.perform(post("/api/organizations/{org}/staffing/plans/{plan}/schedule/assignments/batch",
            fixture.organizationId(), fixture.planId())
            .header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 1))
            .header("Idempotency-Key", "duplicate-assignment-create")
            .contentType(MediaType.APPLICATION_JSON).content(duplicateAssignments))
        .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("BATCH_CONFLICT"));

    String action = "{\"operation\":\"CREATE\",\"create\":{\"date\":\"2026-08-11\","
        + "\"workTypeId\":\"" + fixture.workTypeId()
        + "\",\"requiredWorkers\":1,\"requiredQuantity\":1}}";
    String oversized = "{\"actions\":[" + String.join(",", java.util.Collections.nCopies(101,
        action)) + "]}";
    mvc.perform(post("/api/organizations/{org}/staffing/plans/{plan}/demand/batch",
            fixture.organizationId(), fixture.planId())
            .header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 1))
            .header("Idempotency-Key", "oversized-demand-batch")
            .contentType(MediaType.APPLICATION_JSON).content(oversized))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));

    assertThat(revision(fixture.planId())).isEqualTo(1);
    assertThat(jdbc.queryForObject(
        "select count(*) from staffing_requirements where organization_id=?::uuid",
        Long.class, fixture.organizationId())).isEqualTo(requirementsBefore);
    assertThat(jdbc.queryForObject(
        "select count(*) from staffing_assignments where requirement_id=?::uuid",
        Long.class, fixture.requirementId())).isZero();
    assertThat(jdbc.queryForObject(
        "select count(*) from staffing_change_events where organization_id=?::uuid",
        Long.class, fixture.organizationId())).isEqualTo(auditBefore);
    assertThat(jdbc.queryForObject(
        "select count(*) from staffing_plan_draft_mutation_operations where plan_id=?::uuid",
        Long.class, fixture.planId())).isZero();
  }

  @Test
  void batchChangesOnceAndAssignmentCancelIsIdempotentAsANoop() throws Exception {
    Fixture fixture = fixture();
    String demandBatch = """
        {"actions":[
          {"operation":"CREATE","create":{"date":"2026-08-11","workTypeId":"%s",
            "requiredWorkers":1,"requiredQuantity":1}},
          {"operation":"CREATE","create":{"date":"2026-08-12","workTypeId":"%s",
            "requiredWorkers":1,"requiredQuantity":1}}
        ]}
        """.formatted(fixture.workTypeId(), fixture.workTypeId());
    mvc.perform(post("/api/organizations/{org}/staffing/plans/{plan}/demand/batch",
            fixture.organizationId(), fixture.planId())
            .header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 1))
            .header("Idempotency-Key", "demand-batch")
            .contentType(MediaType.APPLICATION_JSON).content(demandBatch))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.previousDraftRevision").value(1))
        .andExpect(jsonPath("$.data.currentDraftRevision").value(2))
        .andExpect(jsonPath("$.data.affectedResourceIds.length()").value(2));

    String assignmentBody = "{\"requirementId\":\"" + fixture.requirementId()
        + "\",\"membershipId\":\"" + fixture.memberId() + "\"}";
    String assignmentJson = mvc.perform(post(
            "/api/organizations/{org}/staffing/plans/{plan}/schedule/assignments",
            fixture.organizationId(), fixture.planId())
            .header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 2))
            .header("Idempotency-Key", "assign-ana")
            .contentType(MediaType.APPLICATION_JSON).content(assignmentBody))
        .andExpect(status().isCreated())
        .andExpect(header().string(HttpHeaders.ETAG, etag(fixture.planId(), 3)))
        .andReturn().getResponse().getContentAsString();
    String assignmentId = firstAffectedId(assignmentJson);

    mvc.perform(get("/api/organizations/{org}/staffing/plans/{plan}/schedule",
            fixture.organizationId(), fixture.planId())
            .header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isOk())
        .andExpect(header().string(HttpHeaders.ETAG, etag(fixture.planId(), 3)))
        .andExpect(jsonPath("$.data.coverage.required").value(3))
        .andExpect(jsonPath("$.data.coverage.effectiveAssigned").value(1));
    mvc.perform(get("/api/organizations/{org}/staffing/plans/{plan}/coverage",
            fixture.organizationId(), fixture.planId())
            .header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isOk())
        .andExpect(header().string(HttpHeaders.ETAG, etag(fixture.planId(), 3)))
        .andExpect(jsonPath("$.data.totals.required").value(3))
        .andExpect(jsonPath("$.data.totals.covered").value(1))
        .andExpect(jsonPath("$.data.totals.openPositions").value(2));
    mvc.perform(get("/api/organizations/{org}/staffing/plans/{plan}/review",
            fixture.organizationId(), fixture.planId())
            .header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isOk())
        .andExpect(header().string(HttpHeaders.ETAG, etag(fixture.planId(), 3)))
        .andExpect(jsonPath("$.data.publishable").value(true));

    mvc.perform(delete(
            "/api/organizations/{org}/staffing/plans/{plan}/demand/requirements/{requirement}",
            fixture.organizationId(), fixture.planId(), fixture.requirementId())
            .header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 3)))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("REQUIREMENT_HAS_ASSIGNMENTS"));
    assertThat(revision(fixture.planId())).isEqualTo(3);

    String cancelPath = "/api/organizations/" + fixture.organizationId() + "/staffing/plans/"
        + fixture.planId() + "/schedule/assignments/" + assignmentId;
    mvc.perform(delete(cancelPath).header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 3)))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.currentDraftRevision").value(4));
    mvc.perform(delete(cancelPath).header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 4)))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.changed").value(false))
        .andExpect(header().string(HttpHeaders.ETAG, etag(fixture.planId(), 4)));

    String second = create("/api/organizations/" + fixture.organizationId() + "/members",
        "{\"firstName\":\"Mara\",\"lastName\":\"Batch\"}");
    String third = create("/api/organizations/" + fixture.organizationId() + "/members",
        "{\"firstName\":\"Sofia\",\"lastName\":\"Batch\"}");
    jdbc.update("update organization_memberships set membership_status='ACTIVE' where id in "
        + "(?::uuid,?::uuid)", second, third);
    String assignmentBatch = """
        {"actions":[
          {"operation":"CREATE","create":{"requirementId":"%s","membershipId":"%s"}},
          {"operation":"CREATE","create":{"requirementId":"%s","membershipId":"%s"}}
        ]}
        """.formatted(fixture.requirementId(), second, fixture.requirementId(), third);
    mvc.perform(post("/api/organizations/{org}/staffing/plans/{plan}/schedule/assignments/batch",
            fixture.organizationId(), fixture.planId())
            .header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 4))
            .header("Idempotency-Key", "assignment-batch")
            .contentType(MediaType.APPLICATION_JSON).content(assignmentBatch))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.currentDraftRevision").value(5))
        .andExpect(jsonPath("$.data.affectedResourceIds.length()").value(2));
  }

  @Test
  void demandRouteMatrixCoversRealNoopDeleteMixedBatchAndRollback() throws Exception {
    Fixture fixture = fixture();
    String requirementPath = "/api/organizations/" + fixture.organizationId()
        + "/staffing/plans/" + fixture.planId() + "/demand/requirements/";
    String changed = "{\"startTime\":\"11:30\",\"endTime\":\"20:00\","
        + "\"requiredWorkers\":2,\"requiredQuantity\":3,\"notes\":\"changed\"}";

    mvc.perform(put(requirementPath + fixture.requirementId())
            .header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 1))
            .contentType(MediaType.APPLICATION_JSON).content(changed))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.changed").value(true))
        .andExpect(header().string(HttpHeaders.ETAG, etag(fixture.planId(), 2)));
    mvc.perform(put(requirementPath + fixture.requirementId())
            .header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 2))
            .contentType(MediaType.APPLICATION_JSON).content(changed))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.changed").value(false))
        .andExpect(header().string(HttpHeaders.ETAG, etag(fixture.planId(), 2)));
    mvc.perform(delete(requirementPath + fixture.requirementId())
            .header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 2)))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.changed").value(true))
        .andExpect(header().string(HttpHeaders.ETAG, etag(fixture.planId(), 3)));

    String tuesday = createRequirement(fixture, "2026-08-11", "route-tuesday", 3);
    String wednesday = createRequirement(fixture, "2026-08-12", "route-wednesday", 4);
    String mixed = """
        {"actions":[
          {"operation":"CREATE","create":{"date":"2026-08-13","workTypeId":"%s",
            "requiredWorkers":1,"requiredQuantity":1,"notes":"created"}},
          {"operation":"UPDATE","requirementId":"%s","update":{"startTime":"10:00",
            "endTime":"18:30","requiredWorkers":4,"requiredQuantity":4,"notes":"updated"}},
          {"operation":"DELETE","requirementId":"%s"}
        ]}
        """.formatted(fixture.workTypeId(), tuesday, wednesday);
    mvc.perform(post("/api/organizations/{org}/staffing/plans/{plan}/demand/batch",
            fixture.organizationId(), fixture.planId())
            .header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 5))
            .header("Idempotency-Key", "demand-mixed")
            .contentType(MediaType.APPLICATION_JSON).content(mixed))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.changed").value(true))
        .andExpect(jsonPath("$.data.affectedResourceIds.length()").value(3))
        .andExpect(header().string(HttpHeaders.ETAG, etag(fixture.planId(), 6)));
    assertThat(jdbc.queryForObject("select required_workers from staffing_requirements where id=?::uuid",
        Integer.class, tuesday)).isEqualTo(4);
    assertThat(jdbc.queryForObject("select count(*) from staffing_requirements where id=?::uuid",
        Integer.class, wednesday)).isZero();

    Fixture other = fixture();
    String invalid = """
        {"actions":[
          {"operation":"CREATE","create":{"date":"2026-08-14","workTypeId":"%s",
            "requiredWorkers":1,"requiredQuantity":1,"notes":"must rollback"}},
          {"operation":"UPDATE","requirementId":"%s","update":{"startTime":"09:00",
            "endTime":"17:30","requiredWorkers":1,"requiredQuantity":1}}
        ]}
        """.formatted(fixture.workTypeId(), other.requirementId());
    mvc.perform(post("/api/organizations/{org}/staffing/plans/{plan}/demand/batch",
            fixture.organizationId(), fixture.planId())
            .header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 6))
            .header("Idempotency-Key", "demand-invalid-after-write")
            .contentType(MediaType.APPLICATION_JSON).content(invalid))
        .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("RESOURCE_NOT_FOUND"));
    assertThat(revision(fixture.planId())).isEqualTo(6);
    assertThat(jdbc.queryForObject("""
        select count(*) from staffing_requirements where organization_id=?::uuid
          and work_date='2026-08-14' and notes='must rollback'
        """, Integer.class, fixture.organizationId())).isZero();
    assertThat(jdbc.queryForObject("""
        select count(*) from staffing_plan_draft_mutation_operations
        where plan_id=?::uuid and idempotency_key='demand-invalid-after-write'
        """, Integer.class, fixture.planId())).isZero();
  }

  @Test
  void scheduleRouteMatrixCoversRealNoopCancelMixedBatchAndRollback() throws Exception {
    Fixture fixture = fixture();
    String assignmentId = createAssignment(fixture, fixture.memberId(), "schedule-primary", 1);
    String assignmentPath = "/api/organizations/" + fixture.organizationId()
        + "/staffing/plans/" + fixture.planId() + "/schedule/assignments/" + assignmentId;
    String changed = "{\"startTime\":\"12:30\",\"endTime\":\"21:00\"}";
    mvc.perform(put(assignmentPath).header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 2))
            .contentType(MediaType.APPLICATION_JSON).content(changed))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.changed").value(true))
        .andExpect(header().string(HttpHeaders.ETAG, etag(fixture.planId(), 3)));
    mvc.perform(put(assignmentPath).header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 3))
            .contentType(MediaType.APPLICATION_JSON).content(changed))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.changed").value(false));
    mvc.perform(delete(assignmentPath).header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 3)))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.changed").value(true))
        .andExpect(header().string(HttpHeaders.ETAG, etag(fixture.planId(), 4)));
    mvc.perform(delete(assignmentPath).header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 4)))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.changed").value(false));

    String memberA = createMember(fixture, "Route", "A");
    String memberB = createMember(fixture, "Route", "B");
    String memberC = createMember(fixture, "Route", "C");
    String assignmentA = createAssignment(fixture, memberA, "schedule-a", 4);
    String assignmentB = createAssignment(fixture, memberB, "schedule-b", 5);
    String mixed = """
        {"actions":[
          {"operation":"UPDATE","assignmentId":"%s","update":{"startTime":"13:00",
            "endTime":"21:30"}},
          {"operation":"CANCEL","assignmentId":"%s"},
          {"operation":"CREATE","create":{"requirementId":"%s","membershipId":"%s"}}
        ]}
        """.formatted(assignmentA, assignmentB, fixture.requirementId(), memberC);
    mvc.perform(post("/api/organizations/{org}/staffing/plans/{plan}/schedule/assignments/batch",
            fixture.organizationId(), fixture.planId())
            .header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 6))
            .header("Idempotency-Key", "schedule-mixed")
            .contentType(MediaType.APPLICATION_JSON).content(mixed))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.changed").value(true))
        .andExpect(jsonPath("$.data.affectedResourceIds.length()").value(3))
        .andExpect(header().string(HttpHeaders.ETAG, etag(fixture.planId(), 7)));
    assertThat(jdbc.queryForObject("select assignment_status from staffing_assignments where id=?::uuid",
        String.class, assignmentB)).isEqualTo("CANCELLED");

    String memberD = createMember(fixture, "Route", "D");
    Fixture other = fixture();
    String invalid = """
        {"actions":[
          {"operation":"CREATE","create":{"requirementId":"%s","membershipId":"%s"}},
          {"operation":"CREATE","create":{"requirementId":"%s","membershipId":"%s"}}
        ]}
        """.formatted(fixture.requirementId(), memberD, other.requirementId(), memberD);
    mvc.perform(post("/api/organizations/{org}/staffing/plans/{plan}/schedule/assignments/batch",
            fixture.organizationId(), fixture.planId())
            .header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 7))
            .header("Idempotency-Key", "schedule-invalid-after-write")
            .contentType(MediaType.APPLICATION_JSON).content(invalid))
        .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("RESOURCE_NOT_FOUND"));
    assertThat(revision(fixture.planId())).isEqualTo(7);
    assertThat(jdbc.queryForObject("""
        select count(*) from staffing_assignments where requirement_id=?::uuid
          and membership_id=?::uuid
        """, Integer.class, fixture.requirementId(), memberD)).isZero();
  }

  @Test
  void cancelledAssignmentCanBeAssignedAgainToTheSameMember() throws Exception {
    Fixture fixture = fixture();
    String original = createAssignment(fixture, fixture.memberId(), "reassign-original", 1);
    String path = "/api/organizations/" + fixture.organizationId()
        + "/staffing/plans/" + fixture.planId() + "/schedule/assignments/" + original;

    mvc.perform(delete(path).header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 2)))
        .andExpect(status().isOk()).andExpect(header().string(HttpHeaders.ETAG,
            etag(fixture.planId(), 3)));

    String restored = createAssignment(fixture, fixture.memberId(), "reassign-restored", 3);

    assertThat(restored).isEqualTo(original);
    assertThat(jdbc.queryForObject("""
        select count(*) from staffing_assignments
        where requirement_id=?::uuid and membership_id=?::uuid and assignment_status='ASSIGNED'
        """, Integer.class, fixture.requirementId(), fixture.memberId())).isEqualTo(1);
    assertThat(jdbc.queryForObject("""
        select count(*) from staffing_assignments
        where requirement_id=?::uuid and membership_id=?::uuid and assignment_status='CANCELLED'
        """, Integer.class, fixture.requirementId(), fixture.memberId())).isZero();
  }

  @Test
  void dayOffStatusesBlockSingleAndBatchAssignments() throws Exception {
    Fixture fixture = fixture();
    UUID ownerMembershipId = jdbc.queryForObject("""
        select id from organization_memberships
        where organization_id=?::uuid and user_id=?::uuid
        """, UUID.class, fixture.organizationId(), owner.getId());
    jdbc.update("""
        insert into staffing_member_day_entries(id,organization_id,membership_id,work_date,
          entry_type,created_by_membership_id,created_at,updated_at)
        values(?,?,?,?,?,?,current_timestamp,current_timestamp)
        """, UUID.randomUUID(), UUID.fromString(fixture.organizationId()),
        UUID.fromString(fixture.memberId()), LocalDate.parse("2026-08-10"),
        "REST_DAY", ownerMembershipId);

    String assignment = "{\"requirementId\":\"" + fixture.requirementId()
        + "\",\"membershipId\":\"" + fixture.memberId() + "\"}";
    String assignmentPath = "/api/organizations/" + fixture.organizationId()
        + "/staffing/plans/" + fixture.planId() + "/schedule/assignments";
    mvc.perform(post(assignmentPath).header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 1))
            .header("Idempotency-Key", "rest-day-single").contentType(MediaType.APPLICATION_JSON)
            .content(assignment))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("DAY_STATUS_ASSIGNMENT_CONFLICT"));

    String batch = "{\"actions\":[{\"operation\":\"CREATE\",\"create\":"
        + assignment + "}]}";
    mvc.perform(post(assignmentPath + "/batch").header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 1))
            .header("Idempotency-Key", "rest-day-batch").contentType(MediaType.APPLICATION_JSON)
            .content(batch))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("DAY_STATUS_ASSIGNMENT_CONFLICT"));
    assertThat(revision(fixture.planId())).isEqualTo(1);
  }

  @Test
  void staleRevisionAndCrossTenantResourcesAreOpaque() throws Exception {
    Fixture fixture = fixture();
    Fixture other = fixture();
    String path = "/api/organizations/" + fixture.organizationId() + "/staffing/plans/"
        + fixture.planId() + "/demand/requirements/" + fixture.requirementId();
    String body = "{\"startTime\":\"09:00\",\"endTime\":\"17:00\","
        + "\"requiredWorkers\":1,\"requiredQuantity\":1}";

    mvc.perform(put(path).header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 0))
            .contentType(MediaType.APPLICATION_JSON).content(body))
        .andExpect(status().isPreconditionFailed())
        .andExpect(header().string(HttpHeaders.ETAG, etag(fixture.planId(), 1)))
        .andExpect(jsonPath("$.code").value("STALE_PLAN_REVISION"));

    mvc.perform(put("/api/organizations/{org}/staffing/plans/{plan}/demand/requirements/{id}",
            fixture.organizationId(), fixture.planId(), other.requirementId())
            .header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 1))
            .contentType(MediaType.APPLICATION_JSON).content(body))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.code").value("RESOURCE_NOT_FOUND"));
  }

  @Test
  void concurrentSameKeyCreatesOnceAndDifferentMutationsCannotBothUseOneRevision()
      throws Exception {
    Fixture fixture = fixture();
    String path = "/api/organizations/" + fixture.organizationId() + "/staffing/plans/"
        + fixture.planId() + "/demand/requirements";
    String body = "{\"date\":\"2026-08-11\",\"workTypeId\":\"" + fixture.workTypeId()
        + "\",\"requiredWorkers\":1,\"requiredQuantity\":1}";
    ExecutorService executor = Executors.newFixedThreadPool(2);
    CountDownLatch ready = new CountDownLatch(2);
    CountDownLatch go = new CountDownLatch(1);
    try {
      Future<Integer> first = executor.submit(() -> concurrentPost(path, body, fixture, ready, go));
      Future<Integer> second = executor.submit(() -> concurrentPost(path, body, fixture, ready, go));
      assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
      go.countDown();
      assertThat(List.of(first.get(20, TimeUnit.SECONDS), second.get(20, TimeUnit.SECONDS)))
          .containsExactlyInAnyOrder(201, 201);
    } finally {
      go.countDown();
      executor.shutdownNow();
    }
    assertThat(revision(fixture.planId())).isEqualTo(2);
    assertThat(jdbc.queryForObject("""
        select count(*) from staffing_requirements where organization_id=?::uuid
          and work_date='2026-08-11'
        """, Integer.class, fixture.organizationId())).isEqualTo(1);
    assertThat(jdbc.queryForObject("""
        select count(*) from staffing_plan_draft_mutation_operations
        where plan_id=?::uuid and operation_family='DEMAND_CREATE'
        """, Integer.class, fixture.planId())).isEqualTo(1);
  }

  @Test
  void concurrentDifferentMutationsNeverLoseUpdatesAcrossCreateUpdateAndBatch()
      throws Exception {
    Fixture creates = fixture();
    String createPath = "/api/organizations/" + creates.organizationId()
        + "/staffing/plans/" + creates.planId() + "/demand/requirements";
    String createBody1 = "{\"date\":\"2026-08-11\",\"workTypeId\":\""
        + creates.workTypeId() + "\",\"requiredWorkers\":1}";
    String createBody2 = "{\"date\":\"2026-08-12\",\"workTypeId\":\""
        + creates.workTypeId() + "\",\"requiredWorkers\":1}";
    assertThat(concurrent(
        () -> mutationPost(createPath, etag(creates.planId(), 1), "different-create-1",
            createBody1),
        () -> mutationPost(createPath, etag(creates.planId(), 1), "different-create-2",
            createBody2))).containsExactlyInAnyOrder(201, 412);
    assertThat(revision(creates.planId())).isEqualTo(2);
    assertThat(jdbc.queryForObject("""
        select count(*) from staffing_requirements where plan_day_id in
          (select id from staffing_plan_days where plan_id=?::uuid)
        """, Integer.class, creates.planId())).isEqualTo(2);

    Fixture updates = fixture();
    String updatePath = "/api/organizations/" + updates.organizationId()
        + "/staffing/plans/" + updates.planId() + "/demand/requirements/"
        + updates.requirementId();
    assertThat(concurrent(
        () -> mutationPut(updatePath, etag(updates.planId(), 1),
            "{\"startTime\":\"09:00\",\"endTime\":\"17:00\",\"requiredWorkers\":2}"),
        () -> mutationPut(updatePath, etag(updates.planId(), 1),
            "{\"startTime\":\"10:00\",\"endTime\":\"18:00\",\"requiredWorkers\":3}")))
        .containsExactlyInAnyOrder(200, 412);
    assertThat(revision(updates.planId())).isEqualTo(2);
    assertThat(jdbc.queryForObject("""
        select required_workers from staffing_requirements where id=?::uuid
        """, Integer.class, updates.requirementId())).isIn(2, 3);

    Fixture batches = fixture();
    String batchPath = "/api/organizations/" + batches.organizationId()
        + "/staffing/plans/" + batches.planId() + "/demand/batch";
    String batch1 = "{\"actions\":[{\"operation\":\"CREATE\",\"create\":{"
        + "\"date\":\"2026-08-11\",\"workTypeId\":\"" + batches.workTypeId()
        + "\",\"requiredWorkers\":1,\"requiredQuantity\":1}}]}";
    String batch2 = "{\"actions\":[{\"operation\":\"CREATE\",\"create\":{"
        + "\"date\":\"2026-08-12\",\"workTypeId\":\"" + batches.workTypeId()
        + "\",\"requiredWorkers\":1,\"requiredQuantity\":1}}]}";
    assertThat(concurrent(
        () -> mutationPost(batchPath, etag(batches.planId(), 1), "different-batch-1", batch1),
        () -> mutationPost(batchPath, etag(batches.planId(), 1), "different-batch-2", batch2)))
        .containsExactlyInAnyOrder(200, 412);
    assertThat(revision(batches.planId())).isEqualTo(2);
    assertThat(jdbc.queryForObject("""
        select count(*) from staffing_requirements where plan_day_id in
          (select id from staffing_plan_days where plan_id=?::uuid)
        """, Integer.class, batches.planId())).isEqualTo(2);
  }

  @Test
  void mutationAuthorizationUsesOpaqueTenantScopeAndStableCodes() throws Exception {
    Fixture fixture = fixture();
    UserAccount employee = verified("mutation-employee-" + UUID.randomUUID() + "@example.com");
    UUID employeeMembership = UUID.randomUUID();
    jdbc.update("""
        insert into organization_memberships(id,organization_id,user_id,membership_role,
          membership_status,joined_at,created_at,updated_at)
        values(?,?,?,'EMPLOYEE','ACTIVE',current_timestamp,current_timestamp,current_timestamp)
        """, employeeMembership, UUID.fromString(fixture.organizationId()), employee.getId());
    UserAccount outsider = verified("mutation-outsider-" + UUID.randomUUID() + "@example.com");
    String path = "/api/organizations/" + fixture.organizationId() + "/staffing/plans/"
        + fixture.planId() + "/demand/requirements/" + fixture.requirementId();
    String body = "{\"startTime\":\"12:00\",\"endTime\":\"20:30\","
        + "\"requiredWorkers\":1,\"requiredQuantity\":1}";

    mvc.perform(put(path).header(HttpHeaders.AUTHORIZATION, token(employee))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 1))
            .contentType(MediaType.APPLICATION_JSON).content(body))
        .andExpect(status().isForbidden())
        .andExpect(header().doesNotExist(HttpHeaders.ETAG))
        .andExpect(jsonPath("$.code").value("FORBIDDEN"));
    mvc.perform(put(path).header(HttpHeaders.AUTHORIZATION, token(outsider))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 1))
            .contentType(MediaType.APPLICATION_JSON).content(body))
        .andExpect(status().isNotFound())
        .andExpect(header().doesNotExist(HttpHeaders.ETAG))
        .andExpect(jsonPath("$.code").value("RESOURCE_NOT_FOUND"));
    jdbc.update("update organization_memberships set membership_status='SUSPENDED' where id=?",
        employeeMembership);
    mvc.perform(put(path).header(HttpHeaders.AUTHORIZATION, token(employee))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 1))
            .contentType(MediaType.APPLICATION_JSON).content(body))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.code").value("RESOURCE_NOT_FOUND"));
  }

  @Test
  void completedReplayReauthorizesAndNeverRepeatsResourceRevisionOrAudit() throws Exception {
    Fixture fixture = fixture();
    UserAccount manager = verified("mutation-manager-" + UUID.randomUUID() + "@example.com");
    UUID managerMembership = UUID.randomUUID();
    UUID roleId = UUID.randomUUID();
    UUID roleAssignmentId = UUID.randomUUID();
    jdbc.update("""
        insert into organization_memberships(id,organization_id,user_id,membership_role,
          membership_status,joined_at,created_at,updated_at)
        values(?,?,?,'EMPLOYEE','ACTIVE',current_timestamp,current_timestamp,current_timestamp)
        """, managerMembership, UUID.fromString(fixture.organizationId()), manager.getId());
    jdbc.update("""
        insert into organization_roles(id,organization_id,name,permissions,system_role,
          created_at,updated_at)
        values(?,?,?,ARRAY['MANAGE_SCHEDULE']::text[],false,current_timestamp,current_timestamp)
        """, roleId, UUID.fromString(fixture.organizationId()), "Schedule editor");
    jdbc.update("""
        insert into organization_role_assignments(id,membership_id,role_id,unit_id,
          include_descendants,created_at,updated_at)
        values(?,?,?,?,false,current_timestamp,current_timestamp)
        """, roleAssignmentId, managerMembership, roleId, UUID.fromString(fixture.unitId()));
    String path = "/api/organizations/" + fixture.organizationId() + "/staffing/plans/"
        + fixture.planId() + "/demand/requirements";
    String body = "{\"date\":\"2026-08-11\",\"workTypeId\":\"" + fixture.workTypeId()
        + "\",\"requiredWorkers\":1,\"requiredQuantity\":1}";

    String first = mvc.perform(post(path).header(HttpHeaders.AUTHORIZATION, token(manager))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 1))
            .header("Idempotency-Key", "access-replay")
            .contentType(MediaType.APPLICATION_JSON).content(body))
        .andExpect(status().isCreated())
        .andExpect(header().string(HttpHeaders.ETAG, etag(fixture.planId(), 2)))
        .andReturn().getResponse().getContentAsString();
    long auditCount = jdbc.queryForObject("""
        select count(*) from staffing_change_events where organization_id=?::uuid
          and event_type='REQUIREMENT_CREATED'
        """, Long.class, fixture.organizationId());
    String replay = mvc.perform(post(path).header(HttpHeaders.AUTHORIZATION, token(manager))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 1))
            .header("Idempotency-Key", "access-replay")
            .contentType(MediaType.APPLICATION_JSON).content(body))
        .andExpect(status().isCreated())
        .andExpect(header().string(HttpHeaders.ETAG, etag(fixture.planId(), 2)))
        .andReturn().getResponse().getContentAsString();
    assertThat(replay).isEqualTo(first);
    assertThat(revision(fixture.planId())).isEqualTo(2);
    assertThat(jdbc.queryForObject("""
        select count(*) from staffing_change_events where organization_id=?::uuid
          and event_type='REQUIREMENT_CREATED'
        """, Long.class, fixture.organizationId())).isEqualTo(auditCount);

    jdbc.update("delete from organization_role_assignments where id=?", roleAssignmentId);
    mvc.perform(post(path).header(HttpHeaders.AUTHORIZATION, token(manager))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 1))
            .header("Idempotency-Key", "access-replay")
            .contentType(MediaType.APPLICATION_JSON).content(body))
        .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("FORBIDDEN"));

    String otherUnit = create("/api/organizations/" + fixture.organizationId() + "/units",
        "{\"name\":\"Other unit\",\"type\":\"LOCATION\",\"checkInMode\":\"OPTIONAL\"}");
    UUID otherScope = UUID.randomUUID();
    jdbc.update("""
        insert into organization_role_assignments(id,membership_id,role_id,unit_id,
          include_descendants,created_at,updated_at)
        values(?,?,?,?,false,current_timestamp,current_timestamp)
        """, otherScope, managerMembership, roleId, UUID.fromString(otherUnit));
    mvc.perform(post(path).header(HttpHeaders.AUTHORIZATION, token(manager))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 1))
            .header("Idempotency-Key", "access-replay")
            .contentType(MediaType.APPLICATION_JSON).content(body))
        .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("RESOURCE_NOT_FOUND"));

    jdbc.update("update organization_memberships set membership_status='SUSPENDED' where id=?",
        managerMembership);
    mvc.perform(post(path).header(HttpHeaders.AUTHORIZATION, token(manager))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 1))
            .header("Idempotency-Key", "access-replay")
            .contentType(MediaType.APPLICATION_JSON).content(body))
        .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("RESOURCE_NOT_FOUND"));
    jdbc.update("delete from organization_memberships where id=?", managerMembership);
    assertThat(jdbc.queryForObject("""
        select count(*) from staffing_plan_draft_mutation_operations
        where plan_id=?::uuid and idempotency_key='access-replay'
        """, Long.class, fixture.planId())).isEqualTo(1);
  }

  @Test
  void idempotencyKeysAreValidatedScopedAndFingerprintNormalizedPayloadInOrder() throws Exception {
    Fixture fixture = fixture();
    String path = "/api/organizations/" + fixture.organizationId() + "/staffing/plans/"
        + fixture.planId() + "/demand/requirements";
    String body = "{\"date\":\"2026-08-11\",\"workTypeId\":\"" + fixture.workTypeId()
        + "\",\"requiredWorkers\":1,\"requiredQuantity\":1.00,\"notes\":\"  demo  \"}";
    for (String invalid : List.of(" ", "x".repeat(201), "bad\u0001key")) {
      mvc.perform(post(path).header(HttpHeaders.AUTHORIZATION, token(owner))
              .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 1))
              .header("Idempotency-Key", invalid)
              .contentType(MediaType.APPLICATION_JSON).content(body))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    }
    String first = mvc.perform(post(path).header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 1))
            .header("Idempotency-Key", "normalized-key")
            .contentType(MediaType.APPLICATION_JSON).content(body))
        .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
    String equivalent = body.replace("1.00", "1").replace("  demo  ", "demo");
    String replay = mvc.perform(post(path).header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 1))
            .header("Idempotency-Key", "normalized-key")
            .contentType(MediaType.APPLICATION_JSON).content(equivalent))
        .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
    assertThat(replay).isEqualTo(first);
    assertThat(jdbc.queryForObject("""
        select response_payload::jsonb is not null
          and octet_length(response_payload) <= 65536
          and response_payload not ilike '%email%'
        from staffing_plan_draft_mutation_operations
        where plan_id=?::uuid and idempotency_key='normalized-key'
        """, Boolean.class, fixture.planId())).isTrue();

    String member = createMember(fixture, "Shared", "Family");
    createAssignment(fixture, member, "normalized-key", 2);
    Fixture other = fixture();
    createRequirement(other, "2026-08-11", "normalized-key", 1);

    String firstOrder = """
        {"actions":[
          {"operation":"CREATE","create":{"date":"2026-08-12","workTypeId":"%s",
            "requiredWorkers":1,"requiredQuantity":1}},
          {"operation":"CREATE","create":{"date":"2026-08-13","workTypeId":"%s",
            "requiredWorkers":1,"requiredQuantity":1}}
        ]}
        """.formatted(fixture.workTypeId(), fixture.workTypeId());
    String reverseOrder = """
        {"actions":[
          {"operation":"CREATE","create":{"date":"2026-08-13","workTypeId":"%s",
            "requiredWorkers":1,"requiredQuantity":1}},
          {"operation":"CREATE","create":{"date":"2026-08-12","workTypeId":"%s",
            "requiredWorkers":1,"requiredQuantity":1}}
        ]}
        """.formatted(fixture.workTypeId(), fixture.workTypeId());
    String batchPath = "/api/organizations/" + fixture.organizationId() + "/staffing/plans/"
        + fixture.planId() + "/demand/batch";
    mvc.perform(post(batchPath).header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 3))
            .header("Idempotency-Key", "ordered-batch")
            .contentType(MediaType.APPLICATION_JSON).content(firstOrder))
        .andExpect(status().isOk());
    mvc.perform(post(batchPath).header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 3))
            .header("Idempotency-Key", "ordered-batch")
            .contentType(MediaType.APPLICATION_JSON).content(reverseOrder))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("IDEMPOTENCY_CONFLICT"));
  }

  @Test
  void organizationWideWorkTypesAreReusableButAnotherUnitsTypeIsOpaque() throws Exception {
    Fixture fixture = fixture();
    jdbc.update("update organization_work_types set unit_id=null where id=?::uuid",
        fixture.workTypeId());
    createRequirement(fixture, "2026-08-11", "organization-wide", 1);

    String otherUnit = create("/api/organizations/" + fixture.organizationId() + "/units",
        "{\"name\":\"Other hotel\",\"type\":\"LOCATION\",\"checkInMode\":\"OPTIONAL\"}");
    String otherType = create("/api/organizations/" + fixture.organizationId()
        + "/staffing/work-types", "{\"unitId\":\"" + otherUnit
            + "\",\"code\":\"PF2\",\"name\":\"Other public area\"}");
    mvc.perform(post("/api/organizations/{org}/staffing/plans/{plan}/demand/requirements",
            fixture.organizationId(), fixture.planId())
            .header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 2))
            .header("Idempotency-Key", "wrong-unit-type")
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"date\":\"2026-08-12\",\"workTypeId\":\"" + otherType
                + "\",\"requiredWorkers\":1}"))
        .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("RESOURCE_NOT_FOUND"));
  }

  private int concurrentPost(String path, String body, Fixture fixture, CountDownLatch ready,
      CountDownLatch go) {
    try {
      ready.countDown();
      if (!go.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("start timed out");
      return mvc.perform(post(path).header(HttpHeaders.AUTHORIZATION, token(owner))
              .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), 1))
              .header("Idempotency-Key", "same-concurrent-key")
              .contentType(MediaType.APPLICATION_JSON).content(body))
          .andReturn().getResponse().getStatus();
    } catch (Exception exception) {
      throw new IllegalStateException(exception);
    }
  }

  private List<Integer> concurrent(Callable<Integer> firstCall, Callable<Integer> secondCall)
      throws Exception {
    ExecutorService executor = Executors.newFixedThreadPool(2);
    CountDownLatch ready = new CountDownLatch(2);
    CountDownLatch go = new CountDownLatch(1);
    Callable<Integer> synchronizedFirst = () -> awaitAndCall(firstCall, ready, go);
    Callable<Integer> synchronizedSecond = () -> awaitAndCall(secondCall, ready, go);
    try {
      Future<Integer> first = executor.submit(synchronizedFirst);
      Future<Integer> second = executor.submit(synchronizedSecond);
      assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
      go.countDown();
      return List.of(first.get(20, TimeUnit.SECONDS), second.get(20, TimeUnit.SECONDS));
    } finally {
      go.countDown();
      executor.shutdownNow();
    }
  }

  private int awaitAndCall(Callable<Integer> call, CountDownLatch ready, CountDownLatch go)
      throws Exception {
    ready.countDown();
    if (!go.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("start timed out");
    return call.call();
  }

  private int mutationPost(String path, String ifMatch, String key, String body) throws Exception {
    return mvc.perform(post(path).header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, ifMatch).header("Idempotency-Key", key)
            .contentType(MediaType.APPLICATION_JSON).content(body))
        .andReturn().getResponse().getStatus();
  }

  private int mutationPut(String path, String ifMatch, String body) throws Exception {
    return mvc.perform(put(path).header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, ifMatch)
            .contentType(MediaType.APPLICATION_JSON).content(body))
        .andReturn().getResponse().getStatus();
  }

  private Fixture fixture() throws Exception {
    String organizationId = create("/api/organizations",
        "{\"name\":\"Mutation Hotel\",\"timezone\":\"Europe/Berlin\"}");
    String unitId = create("/api/organizations/" + organizationId + "/units",
        "{\"name\":\"Hotel München\",\"type\":\"LOCATION\",\"checkInMode\":\"OPTIONAL\"}");
    String memberId = create("/api/organizations/" + organizationId + "/members",
        "{\"firstName\":\"Ana\",\"lastName\":\"Mutation\"}");
    jdbc.update("update organization_memberships set membership_status='ACTIVE' where id=?::uuid",
        memberId);
    String workTypeId = create("/api/organizations/" + organizationId + "/staffing/work-types",
        "{\"unitId\":\"" + unitId + "\",\"code\":\"SPA\",\"name\":\"Spa late\","
            + "\"defaultStartTime\":\"12:00\",\"defaultEndTime\":\"20:30\"}");
    String requirementId = create("/api/organizations/" + organizationId
        + "/staffing/requirements", "{\"unitId\":\"" + unitId
            + "\",\"workTypeId\":\"" + workTypeId
            + "\",\"date\":\"2026-08-10\",\"startTime\":\"12:00\","
            + "\"endTime\":\"20:30\",\"requiredWorkers\":1,\"requiredQuantity\":1}");
    String planId = jdbc.queryForObject("""
        select id from staffing_plans where organization_id=?::uuid and unit_id=?::uuid
          and week_start='2026-08-10'
        """, String.class, organizationId, unitId);
    return new Fixture(organizationId, unitId, planId, workTypeId, requirementId, memberId);
  }

  private String create(String path, String body) throws Exception {
    String response = mvc.perform(post(path).header(HttpHeaders.AUTHORIZATION, token(owner))
            .contentType(MediaType.APPLICATION_JSON).content(body))
        .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
    int start = response.indexOf("\"id\":\"") + 6;
    return response.substring(start, response.indexOf('"', start));
  }

  private String createRequirement(Fixture fixture, String date, String key, long revision)
      throws Exception {
    String response = mvc.perform(post(
            "/api/organizations/{org}/staffing/plans/{plan}/demand/requirements",
            fixture.organizationId(), fixture.planId())
            .header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), revision))
            .header("Idempotency-Key", key).contentType(MediaType.APPLICATION_JSON)
            .content("{\"date\":\"" + date + "\",\"workTypeId\":\"" + fixture.workTypeId()
                + "\",\"requiredWorkers\":1,\"requiredQuantity\":1}"))
        .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
    return firstAffectedId(response);
  }

  private String createMember(Fixture fixture, String firstName, String lastName) throws Exception {
    String id = create("/api/organizations/" + fixture.organizationId() + "/members",
        "{\"firstName\":\"" + firstName + "\",\"lastName\":\"" + lastName + "\"}");
    jdbc.update("update organization_memberships set membership_status='ACTIVE' where id=?::uuid",
        id);
    return id;
  }

  private String createAssignment(Fixture fixture, String memberId, String key, long revision)
      throws Exception {
    String response = mvc.perform(post(
            "/api/organizations/{org}/staffing/plans/{plan}/schedule/assignments",
            fixture.organizationId(), fixture.planId())
            .header(HttpHeaders.AUTHORIZATION, token(owner))
            .header(HttpHeaders.IF_MATCH, etag(fixture.planId(), revision))
            .header("Idempotency-Key", key).contentType(MediaType.APPLICATION_JSON)
            .content("{\"requirementId\":\"" + fixture.requirementId()
                + "\",\"membershipId\":\"" + memberId + "\"}"))
        .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
    return firstAffectedId(response);
  }

  private UserAccount verified(String email) {
    UserAccount value = new UserAccount(email, "hash");
    value.verifyEmail();
    return users.saveAndFlush(value);
  }

  private String token(UserAccount user) { return "Bearer " + jwt.generateAccessToken(user); }
  private long revision(String planId) {
    return jdbc.queryForObject("select draft_revision from staffing_plans where id=?::uuid",
        Long.class, planId);
  }
  private String etag(String planId, long revision) {
    return "\"plan-" + planId + "-r" + revision + "\"";
  }
  private String firstAffectedId(String json) {
    int marker = json.indexOf("\"affectedResourceIds\":[\"") + 24;
    return json.substring(marker, json.indexOf('"', marker));
  }

  private record Fixture(String organizationId, String unitId, String planId,
      String workTypeId, String requirementId, String memberId) {}
}
