package com.alveryn.api.organization;

import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.alveryn.api.auth.security.JwtService;
import com.alveryn.api.auth.service.AuthService;
import com.alveryn.api.testsupport.IntegrationTestDatabaseCleaner;
import com.alveryn.api.organization.repository.OrganizationRepository;
import com.alveryn.api.user.entity.UserAccount;
import com.alveryn.api.user.repository.UserAccountRepository;
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
class BusinessOrganizationIntegrationTest {
  @Autowired WebApplicationContext context;
  @Autowired JwtService jwt;
  @Autowired UserAccountRepository users;
  @Autowired OrganizationRepository organizations;
  @Autowired AuthService authService;
  @Autowired JdbcTemplate jdbc;
  private MockMvc mockMvc;

  @BeforeEach
  void setUp() {
    mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    IntegrationTestDatabaseCleaner.cleanWorkspaceData(jdbc);
  }

  @Test
  void ownerCreatesBusinessWorkspaceAndNestedTeams() throws Exception {
    UserAccount owner = user("business-owner@example.com");
    String organizationBody = mockMvc.perform(post("/api/organizations")
            .header(HttpHeaders.AUTHORIZATION, token(owner))
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {"name":"Hotel Berlin","timezone":"Europe/Berlin"}
                """))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.data.type").value("BUSINESS"))
        .andExpect(jsonPath("$.data.role").value("OWNER"))
        .andReturn().getResponse().getContentAsString();
    String organizationId = id(organizationBody);

    String departmentBody = mockMvc.perform(post("/api/organizations/{id}/units", organizationId)
            .header(HttpHeaders.AUTHORIZATION, token(owner))
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {"name":"Housekeeping","type":"DEPARTMENT","checkInMode":"OPTIONAL","displayOrder":1}
                """))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.data.name").value("Housekeeping"))
        .andReturn().getResponse().getContentAsString();
    String departmentId = id(departmentBody);

    mockMvc.perform(post("/api/organizations/{id}/units", organizationId)
            .header(HttpHeaders.AUTHORIZATION, token(owner))
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {"parentId":"%s","name":"Rooms","type":"TEAM","checkInMode":"DISABLED"}
                """.formatted(departmentId)))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.data.parentId").value(departmentId));

    mockMvc.perform(get("/api/organizations/{id}/units", organizationId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.length()").value(2));
  }

  @Test
  void anotherUserCannotInspectBusinessTree() throws Exception {
    UserAccount owner = user("workspace-owner@example.com");
    UserAccount stranger = user("workspace-stranger@example.com");
    String body = mockMvc.perform(post("/api/organizations")
            .header(HttpHeaders.AUTHORIZATION, token(owner))
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"name\":\"Private workspace\",\"timezone\":\"UTC\"}"))
        .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();

    mockMvc.perform(get("/api/organizations/{id}/units", id(body))
            .header(HttpHeaders.AUTHORIZATION, token(stranger)))
        .andExpect(status().isNotFound());
  }

  @Test
  void memberEmailLinksAnExistingVerifiedPersonalAccountImmediately() throws Exception {
    UserAccount owner = user("link-owner@example.com");
    UserAccount employee = user("worker@example.com");
    String organizationId = id(mockMvc.perform(post("/api/organizations")
            .header(HttpHeaders.AUTHORIZATION, token(owner)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"name\":\"Hotel\",\"timezone\":\"Europe/Berlin\"}"))
        .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString());

    mockMvc.perform(post("/api/organizations/{id}/members", organizationId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"firstName\":\"Maria\",\"lastName\":\"Test\",\"email\":\"WORKER@example.com\"}"))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.data.status").value("ACTIVE"))
        .andExpect(jsonPath("$.data.accessState").value("CLAIMED"))
        .andExpect(jsonPath("$.data.userId").value(employee.getId().toString()));
    mockMvc.perform(post("/api/organizations/{id}/members", organizationId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"firstName\":\"Duplicate\",\"lastName\":\"Worker\",\"email\":\"worker@example.com\"}"))
        .andExpect(status().isConflict());

    String membersJson = mockMvc.perform(get("/api/organizations/{id}/members", organizationId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
    java.util.List<String> matchingMembershipIds = com.jayway.jsonpath.JsonPath.read(membersJson,
        "$.data[?(@.userId == '" + employee.getId() + "')].id");
    String membershipId = matchingMembershipIds.getFirst();
    mockMvc.perform(delete("/api/organizations/{id}/members/{memberId}", organizationId, membershipId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.status").value("SUSPENDED"))
        .andExpect(jsonPath("$.data.id").value(membershipId));
    mockMvc.perform(get("/api/organizations").header(HttpHeaders.AUTHORIZATION, token(employee)))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.length()").value(0));
    mockMvc.perform(post("/api/organizations/{id}/members/{memberId}/reactivate", organizationId, membershipId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.status").value("ACTIVE"))
        .andExpect(jsonPath("$.data.id").value(membershipId));
    mockMvc.perform(get("/api/organizations").header(HttpHeaders.AUTHORIZATION, token(employee)))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data[0].id").value(organizationId));
  }

  @Test
  void managedMemberKeepsItsIdentityWhenItLaterClaimsAnInvitation() throws Exception {
    UserAccount owner = user("claim-owner@example.com");
    UserAccount employee = users.saveAndFlush(new UserAccount("later@example.com", "hash"));
    String organizationId = id(mockMvc.perform(post("/api/organizations")
            .header(HttpHeaders.AUTHORIZATION, token(owner)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"name\":\"Service\",\"timezone\":\"Europe/Berlin\"}"))
        .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString());
    String memberId = id(mockMvc.perform(post("/api/organizations/{id}/members", organizationId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"firstName\":\"Ion\",\"lastName\":\"Test\"}"))
        .andExpect(status().isCreated()).andExpect(jsonPath("$.data.status").value("ACTIVE"))
        .andExpect(jsonPath("$.data.accessState").value("MANAGED"))
        .andReturn().getResponse().getContentAsString());
    String unitId = id(mockMvc.perform(post("/api/organizations/{id}/units", organizationId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"name\":\"Housekeeping\",\"type\":\"TEAM\",\"checkInMode\":\"OPTIONAL\"}"))
        .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString());
    String workTypeId = id(mockMvc.perform(post(
            "/api/organizations/{id}/staffing/work-types", organizationId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"unitId\":\"" + unitId + "\",\"code\":\"ROOM\","
                + "\"name\":\"Room cleaning\",\"defaultStartTime\":\"09:00\"}"))
        .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString());
    String requirementId = id(mockMvc.perform(post(
            "/api/organizations/{id}/staffing/requirements", organizationId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"unitId\":\"" + unitId + "\",\"workTypeId\":\"" + workTypeId
                + "\",\"date\":\"2026-08-10\",\"requiredWorkers\":1}"))
        .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString());
    mockMvc.perform(post(
            "/api/organizations/{id}/staffing/requirements/{requirement}/assignments",
            organizationId, requirementId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"membershipId\":\"" + memberId + "\"}"))
        .andExpect(status().isCreated());
    long revisionBeforeClaim = jdbc.queryForObject(
        "select draft_revision from staffing_plans where organization_id=?::uuid and unit_id=?::uuid",
        Long.class, organizationId, unitId);

    mockMvc.perform(put("/api/organizations/{id}/members/{memberId}", organizationId, memberId)
        .header(HttpHeaders.AUTHORIZATION, token(owner)).contentType(MediaType.APPLICATION_JSON)
        .content("{\"firstName\":\"Ion\",\"lastName\":\"Test\",\"email\":\"later@example.com\"}"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.id").value(memberId))
        .andExpect(jsonPath("$.data.status").value("ACTIVE"))
        .andExpect(jsonPath("$.data.accessState").value("INVITED"));

    String secondRequirementId = id(mockMvc.perform(post(
            "/api/organizations/{id}/staffing/requirements", organizationId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"unitId\":\"" + unitId + "\",\"workTypeId\":\"" + workTypeId
                + "\",\"date\":\"2026-08-11\",\"requiredWorkers\":1}"))
        .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString());
    mockMvc.perform(post(
            "/api/organizations/{id}/staffing/requirements/{requirement}/assignments",
            organizationId, secondRequirementId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"membershipId\":\"" + memberId + "\"}"))
        .andExpect(status().isCreated());

    authService.issueVerifiedSession(employee);
    mockMvc.perform(get("/api/organizations").header(HttpHeaders.AUTHORIZATION, token(employee)))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.length()").value(0));
    String invitationToken = "explicit-secure-invitation-token";
    jdbc.update("update organization_memberships set invitation_token_hash=?, invitation_expires_at=now()+interval '7 days' where id=?::uuid",
        com.alveryn.api.organization.service.BusinessInvitationService.hash(invitationToken), memberId);
    mockMvc.perform(get("/api/business-invitations/{token}", invitationToken))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.status").value("PENDING"));
    mockMvc.perform(post("/api/business-invitations/{token}/accept", invitationToken)
            .header(HttpHeaders.AUTHORIZATION, token(employee)))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.status").value("ACTIVE"));
    org.junit.jupiter.api.Assertions.assertEquals(memberId, jdbc.queryForObject(
        "select id::text from organization_memberships where organization_id=?::uuid and user_id=?",
        String.class, organizationId, employee.getId()));

    long revisionAfterClaim = jdbc.queryForObject(
        "select draft_revision from staffing_plans where organization_id=?::uuid and unit_id=?::uuid",
        Long.class, organizationId, unitId);
    org.junit.jupiter.api.Assertions.assertEquals(revisionBeforeClaim + 1, revisionAfterClaim);

    mockMvc.perform(get("/api/organizations").header(HttpHeaders.AUTHORIZATION, token(employee)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data[?(@.id == '" + organizationId + "')].role").value("EMPLOYEE"));
    mockMvc.perform(get("/api/me").header(HttpHeaders.AUTHORIZATION, token(employee)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.hasBusinessWorkspace").value(true));
  }

  @Test
  void ownerCreatesUnclaimedMemberAndAssignsCustomTeamRole() throws Exception {
    UserAccount owner = user("permissions-owner@example.com");
    String organizationId = id(mockMvc.perform(post("/api/organizations")
            .header(HttpHeaders.AUTHORIZATION, token(owner))
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"name\":\"Flooring company\",\"timezone\":\"Europe/Berlin\"}"))
        .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString());

    String unitId = id(mockMvc.perform(post("/api/organizations/{id}/units", organizationId)
            .header(HttpHeaders.AUTHORIZATION, token(owner))
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"name\":\"Installers\",\"type\":\"TEAM\",\"checkInMode\":\"OPTIONAL\"}"))
        .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString());

    String memberId = id(mockMvc.perform(post("/api/organizations/{id}/members", organizationId)
            .header(HttpHeaders.AUTHORIZATION, token(owner))
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"firstName\":\"Test\",\"lastName\":\"Worker\",\"email\":null}"))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.data.status").value("ACTIVE"))
        .andExpect(jsonPath("$.data.accessState").value("MANAGED"))
        .andExpect(jsonPath("$.data.userId").doesNotExist())
        .andReturn().getResponse().getContentAsString());

    String roleId = id(mockMvc.perform(post("/api/organizations/{id}/roles", organizationId)
            .header(HttpHeaders.AUTHORIZATION, token(owner))
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"name\":\"Planner\",\"permissions\":[\"VIEW_SCHEDULE\",\"MANAGE_SCHEDULE\"]}"))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.data.permissions.length()").value(2))
        .andReturn().getResponse().getContentAsString());

    mockMvc.perform(post("/api/organizations/{id}/role-assignments", organizationId)
            .header(HttpHeaders.AUTHORIZATION, token(owner))
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {"membershipId":"%s","roleId":"%s","unitId":"%s","includeDescendants":true}
                """.formatted(memberId, roleId, unitId)))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.data.membershipId").value(memberId))
        .andExpect(jsonPath("$.data.unitId").value(unitId))
        .andExpect(jsonPath("$.data.includeDescendants").value(true));
  }

  @Test
  void ownerMaintainsBusinessPeopleUnitsRolesAndAssignments() throws Exception {
    UserAccount owner = user("crud-owner@example.com");
    String organizationId = id(mockMvc.perform(post("/api/organizations")
            .header(HttpHeaders.AUTHORIZATION, token(owner)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"name\":\"CRUD Hotel\",\"timezone\":\"Europe/Berlin\"}"))
        .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString());
    String unitId = id(mockMvc.perform(post("/api/organizations/{id}/units", organizationId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"name\":\"Lobby\",\"type\":\"TEAM\",\"checkInMode\":\"OPTIONAL\"}"))
        .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString());
    mockMvc.perform(put("/api/organizations/{id}/units/{unitId}", organizationId, unitId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"name\":\"Front Office\",\"type\":\"DEPARTMENT\",\"checkInMode\":\"REQUIRED\"}"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.name").value("Front Office"))
        .andExpect(jsonPath("$.data.checkInMode").value("REQUIRED"));
    mockMvc.perform(delete("/api/organizations/{id}/units/{unitId}", organizationId, unitId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.active").value(false));
    mockMvc.perform(post("/api/organizations/{id}/units/{unitId}/reactivate", organizationId, unitId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.active").value(true));

    String memberId = id(mockMvc.perform(post("/api/organizations/{id}/members", organizationId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"firstName\":\"Ana\",\"lastName\":\"Old\",\"email\":null}"))
        .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString());
    mockMvc.perform(put("/api/organizations/{id}/members/{memberId}", organizationId, memberId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"firstName\":\"Ana\",\"lastName\":\"Updated\",\"email\":\"ana@example.com\"}"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.lastName").value("Updated"))
        .andExpect(jsonPath("$.data.email").value("ana@example.com"));

    String roleId = id(mockMvc.perform(post("/api/organizations/{id}/roles", organizationId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"name\":\"Viewer\",\"permissions\":[\"VIEW_SCHEDULE\"]}"))
        .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString());
    mockMvc.perform(put("/api/organizations/{id}/roles/{roleId}", organizationId, roleId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"name\":\"Planner\",\"permissions\":[\"VIEW_SCHEDULE\",\"MANAGE_SCHEDULE\"]}"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.name").value("Planner"))
        .andExpect(jsonPath("$.data.permissions.length()").value(2));
    String assignmentId = id(mockMvc.perform(post("/api/organizations/{id}/role-assignments", organizationId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"membershipId\":\"%s\",\"roleId\":\"%s\",\"unitId\":\"%s\",\"includeDescendants\":true}"
                .formatted(memberId, roleId, unitId)))
        .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString());
    mockMvc.perform(delete("/api/organizations/{id}/role-assignments/{assignmentId}",
            organizationId, assignmentId).header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isNoContent());
    mockMvc.perform(delete("/api/organizations/{id}/roles/{roleId}", organizationId, roleId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)))
        .andExpect(status().isNoContent());
  }

  @Test
  void customPermissionsGrantOnlyTheConfiguredBusinessCapabilities() throws Exception {
    UserAccount owner = user("access-owner@example.com");
    UserAccount planner = user("access-planner@example.com");
    String organizationId = id(mockMvc.perform(post("/api/organizations")
            .header(HttpHeaders.AUTHORIZATION, token(owner)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"name\":\"Permission test\",\"timezone\":\"Europe/Berlin\"}"))
        .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString());
    String memberId = id(mockMvc.perform(post("/api/organizations/{id}/members", organizationId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"firstName\":\"Plan\",\"lastName\":\"Viewer\",\"email\":\"access-planner@example.com\"}"))
        .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString());
    String roleId = id(mockMvc.perform(post("/api/organizations/{id}/roles", organizationId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"name\":\"Schedule viewer\",\"permissions\":[\"VIEW_SCHEDULE\"]}"))
        .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString());
    mockMvc.perform(post("/api/organizations/{id}/role-assignments", organizationId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"membershipId\":\"%s\",\"roleId\":\"%s\",\"includeDescendants\":true}"
                .formatted(memberId, roleId)))
        .andExpect(status().isCreated());

    mockMvc.perform(get("/api/organizations/{id}/members", organizationId)
            .header(HttpHeaders.AUTHORIZATION, token(planner)))
        .andExpect(status().isOk());
    mockMvc.perform(get("/api/organizations/{id}/access", organizationId)
            .header(HttpHeaders.AUTHORIZATION, token(planner)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.permissions.length()").value(1))
        .andExpect(jsonPath("$.data.permissions[0]").value("VIEW_SCHEDULE"));
    mockMvc.perform(get("/api/organizations/{id}/units", organizationId)
            .header(HttpHeaders.AUTHORIZATION, token(planner)))
        .andExpect(status().isOk());
    mockMvc.perform(get("/api/organizations/{id}/roles", organizationId)
            .header(HttpHeaders.AUTHORIZATION, token(planner)))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.code").value("ACCESS_DENIED"));
  }

  @Test
  void teamScopedPermissionIncludesChildrenButNotSiblingTeams() throws Exception {
    UserAccount owner = user("scope-owner@example.com");
    UserAccount planner = user("scope-planner@example.com");
    String organizationId = id(mockMvc.perform(post("/api/organizations")
            .header(HttpHeaders.AUTHORIZATION, token(owner)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"name\":\"Scoped hotel\",\"timezone\":\"Europe/Berlin\"}"))
        .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString());
    String housekeepingId = id(mockMvc.perform(post("/api/organizations/{id}/units", organizationId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"name\":\"Housekeeping\",\"type\":\"DEPARTMENT\",\"checkInMode\":\"OPTIONAL\"}"))
        .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString());
    String roomsId = id(mockMvc.perform(post("/api/organizations/{id}/units", organizationId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"parentId\":\"%s\",\"name\":\"Rooms\",\"type\":\"TEAM\",\"checkInMode\":\"OPTIONAL\"}"
                .formatted(housekeepingId)))
        .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString());
    String receptionId = id(mockMvc.perform(post("/api/organizations/{id}/units", organizationId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"name\":\"Reception\",\"type\":\"DEPARTMENT\",\"checkInMode\":\"OPTIONAL\"}"))
        .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString());
    String memberId = id(mockMvc.perform(post("/api/organizations/{id}/members", organizationId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"firstName\":\"Scoped\",\"lastName\":\"Planner\",\"email\":\"scope-planner@example.com\"}"))
        .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString());
    String roleId = id(mockMvc.perform(post("/api/organizations/{id}/roles", organizationId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"name\":\"Housekeeping planner\",\"permissions\":[\"MANAGE_SCHEDULE\"]}"))
        .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString());
    mockMvc.perform(post("/api/organizations/{id}/role-assignments", organizationId)
            .header(HttpHeaders.AUTHORIZATION, token(owner)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"membershipId\":\"%s\",\"roleId\":\"%s\",\"unitId\":\"%s\",\"includeDescendants\":true}"
                .formatted(memberId, roleId, housekeepingId)))
        .andExpect(status().isCreated());

    mockMvc.perform(post("/api/organizations/{id}/staffing/work-types", organizationId)
            .header(HttpHeaders.AUTHORIZATION, token(planner)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"unitId\":\"%s\",\"code\":\"ROOM\",\"name\":\"Rooms\",\"color\":\"#10B981\",\"defaultStartTime\":\"08:00\"}"
                .formatted(roomsId)))
        .andExpect(status().isCreated());
    mockMvc.perform(post("/api/organizations/{id}/staffing/work-types", organizationId)
            .header(HttpHeaders.AUTHORIZATION, token(planner)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"unitId\":\"%s\",\"code\":\"REC\",\"name\":\"Reception\",\"color\":\"#3B82F6\",\"defaultStartTime\":\"08:00\"}"
                .formatted(receptionId)))
        .andExpect(status().isForbidden());
  }

  private UserAccount user(String email) {
    UserAccount user = new UserAccount(email, "hash");
    user.verifyEmail();
    return users.saveAndFlush(user);
  }

  private String token(UserAccount user) {
    return "Bearer " + jwt.generateAccessToken(user);
  }

  private String id(String body) {
    int start = body.indexOf("\"id\":\"") + 6;
    return body.substring(start, body.indexOf('"', start));
  }
}
