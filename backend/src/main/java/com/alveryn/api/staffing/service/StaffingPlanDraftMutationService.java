package com.alveryn.api.staffing.service;

import static com.alveryn.api.staffing.dto.StaffingPlanMutationDtos.*;

import com.alveryn.api.common.exception.NotFoundException;
import com.alveryn.api.organization.entity.MembershipStatus;
import com.alveryn.api.organization.entity.OrganizationMembership;
import com.alveryn.api.organization.entity.OrganizationPermission;
import com.alveryn.api.organization.entity.OrganizationUnit;
import com.alveryn.api.organization.repository.OrganizationMembershipRepository;
import com.alveryn.api.organization.repository.OrganizationUnitRepository;
import com.alveryn.api.organization.service.OrganizationAccessService;
import com.alveryn.api.staffing.entity.OrganizationWorkType;
import com.alveryn.api.staffing.entity.StaffingAssignment;
import com.alveryn.api.staffing.entity.StaffingChangeEvent;
import com.alveryn.api.staffing.entity.StaffingPlan;
import com.alveryn.api.staffing.entity.StaffingPlanDay;
import com.alveryn.api.staffing.entity.StaffingPlanDaySource;
import com.alveryn.api.staffing.entity.StaffingRequirement;
import com.alveryn.api.staffing.exception.StaffingPlanMutationApiException;
import com.alveryn.api.staffing.repository.OrganizationWorkTypeRepository;
import com.alveryn.api.staffing.repository.StaffingAssignmentRepository;
import com.alveryn.api.staffing.repository.StaffingChangeEventRepository;
import com.alveryn.api.staffing.repository.StaffingPlanDayRepository;
import com.alveryn.api.staffing.repository.StaffingPlanRepository;
import com.alveryn.api.staffing.repository.StaffingRequirementRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Collection;
import java.util.HexFormat;
import java.util.LinkedHashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;

/** Aggregate-native Demand/Schedule writes guarded by a strong plan revision ETag. */
@Service
@RequiredArgsConstructor
public class StaffingPlanDraftMutationService {
  private static final Pattern IDEMPOTENCY_KEY = Pattern.compile("^[!-~]{1,200}$");

  private final StaffingPlanRepository plans;
  private final StaffingPlanDayRepository planDays;
  private final StaffingRequirementRepository requirements;
  private final StaffingAssignmentRepository assignments;
  private final OrganizationWorkTypeRepository workTypes;
  private final OrganizationMembershipRepository memberships;
  private final OrganizationUnitRepository units;
  private final OrganizationAccessService access;
  private final StaffingPlanMutationCoordinator coordinator;
  private final StaffingPlanIfMatchParser ifMatchParser;
  private final StaffingChangeEventRepository changeEvents;
  private final JdbcTemplate jdbc;
  private final ObjectMapper objectMapper;

  public MutationResponse createRequirement(UUID organizationId, UUID planId, String ifMatch,
      String idempotencyKey, RequirementInput input) {
    AuthorizedPlan authorized = authorize(organizationId, planId);
    RequirementInput normalized = normalize(input);
    return idempotent(authorized, ifMatch, idempotencyKey, "DEMAND_CREATE", normalized, plan -> {
      validateDate(plan, normalized.date());
      OrganizationWorkType workType = workType(authorized, normalized.workTypeId());
      TimeRange time = requirementTime(workType, normalized.startTime(), normalized.endTime());
      StaffingPlanDay day = day(plan, normalized.date());
      StaffingRequirement saved = requirements.save(new StaffingRequirement(
          authorized.actor().getOrganization(), authorized.unit(), workType, normalized.date(),
          time.start(), time.end(), normalized.requiredWorkers(), normalized.requiredQuantity(),
          normalized.notes(), authorized.actor()));
      saved.attachToPlanDay(day);
      audit(authorized.actor(), "REQUIREMENT_CREATED", "REQUIREMENT", saved.getId(),
          normalized.date(), workType.getCode());
      return Outcome.changed(saved.getId());
    });
  }

  public MutationResponse updateRequirement(UUID organizationId, UUID planId, UUID requirementId,
      String ifMatch, RequirementUpdateInput input) {
    AuthorizedPlan authorized = authorize(organizationId, planId);
    RequirementUpdateInput normalized = normalize(input);
    return regular(authorized, ifMatch, plan -> {
      StaffingRequirement requirement = requirement(authorized, requirementId);
      validateRange(normalized.startTime(), normalized.endTime());
      if (same(requirement, normalized)) return Outcome.unchanged();
      requirement.update(normalized.startTime(), normalized.endTime(), normalized.requiredWorkers(),
          normalized.requiredQuantity(), normalized.notes());
      audit(authorized.actor(), "REQUIREMENT_UPDATED", "REQUIREMENT", requirementId,
          requirement.getDate(), requirement.getWorkType().getCode());
      return Outcome.changed(requirementId);
    });
  }

  public MutationResponse deleteRequirement(UUID organizationId, UUID planId, UUID requirementId,
      String ifMatch) {
    AuthorizedPlan authorized = authorize(organizationId, planId);
    return regular(authorized, ifMatch, plan -> {
      StaffingRequirement requirement = requirement(authorized, requirementId);
      if (assignments.existsByRequirementId(requirementId)) {
        throw error(HttpStatus.CONFLICT, "REQUIREMENT_HAS_ASSIGNMENTS",
            "Requirement must have no assignments before it can be deleted");
      }
      requirements.delete(requirement);
      audit(authorized.actor(), "REQUIREMENT_DELETED", "REQUIREMENT", requirementId,
          requirement.getDate(), requirement.getWorkType().getCode());
      return Outcome.changed(requirementId);
    });
  }

  public MutationResponse batchDemand(UUID organizationId, UUID planId, String ifMatch,
      String idempotencyKey, DemandBatchRequest request) {
    AuthorizedPlan authorized = authorize(organizationId, planId);
    validateDemandBatch(request.actions());
    DemandBatchRequest normalizedRequest = normalize(request);
    return idempotent(authorized, ifMatch, idempotencyKey, "DEMAND_BATCH", normalizedRequest, plan -> {
      Set<UUID> changed = new LinkedHashSet<>();
      for (DemandBatchAction action : normalizedRequest.actions()) {
        switch (action.operation()) {
          case CREATE -> {
            RequirementInput input = normalize(action.create());
            validateDate(plan, input.date());
            OrganizationWorkType workType = workType(authorized, input.workTypeId());
            TimeRange time = requirementTime(workType, input.startTime(), input.endTime());
            StaffingRequirement value = requirements.save(new StaffingRequirement(
                authorized.actor().getOrganization(), authorized.unit(), workType, input.date(),
                time.start(), time.end(), input.requiredWorkers(), input.requiredQuantity(),
                input.notes(), authorized.actor()));
            value.attachToPlanDay(day(plan, input.date()));
            changed.add(value.getId());
          }
          case UPDATE -> {
            StaffingRequirement value = requirement(authorized, action.requirementId());
            RequirementUpdateInput input = normalize(action.update());
            validateRange(input.startTime(), input.endTime());
            if (!same(value, input)) {
              value.update(input.startTime(), input.endTime(), input.requiredWorkers(),
                  input.requiredQuantity(), input.notes());
              changed.add(value.getId());
            }
          }
          case DELETE -> {
            StaffingRequirement value = requirement(authorized, action.requirementId());
            if (assignments.existsByRequirementId(value.getId())) {
              throw error(HttpStatus.CONFLICT, "REQUIREMENT_HAS_ASSIGNMENTS",
                  "Requirement must have no assignments before it can be deleted");
            }
            requirements.delete(value);
            changed.add(value.getId());
          }
          default -> throw validation("Demand batch supports CREATE, UPDATE and DELETE");
        }
      }
      if (!changed.isEmpty()) audit(authorized.actor(), "DEMAND_BATCH_UPDATED", "PLAN",
          planId, plan.getWeekStart(), changed.size() + " demand changes");
      return new Outcome(!changed.isEmpty(), changed);
    });
  }

  public MutationResponse createAssignment(UUID organizationId, UUID planId, String ifMatch,
      String idempotencyKey, AssignmentInput input) {
    AuthorizedPlan authorized = authorize(organizationId, planId);
    AssignmentInput normalized = normalize(input);
    return idempotent(authorized, ifMatch, idempotencyKey, "ASSIGNMENT_CREATE", normalized,
        plan -> {
          StaffingRequirement requirement = requirement(authorized, normalized.requirementId());
          OrganizationMembership member = member(authorized, normalized.membershipId());
          validateRange(normalized.startTime(), normalized.endTime());
          if (assignments.existsByRequirementIdAndMembershipIdAndStatus(requirement.getId(),
              member.getId(), "ASSIGNED")) {
            throw error(HttpStatus.CONFLICT, "BATCH_CONFLICT",
                "Member is already assigned to this requirement");
          }
          StaffingAssignment saved = assignments.findByRequirementIdAndMembershipId(requirement.getId(),
              member.getId()).map(existing -> {
                existing.reactivate(normalized.startTime(), normalized.endTime());
                return existing;
              }).orElseGet(() -> assignments.save(new StaffingAssignment(requirement,
                  member, normalized.startTime(), normalized.endTime(), authorized.actor())));
          assignments.flush();
          audit(authorized.actor(), "MEMBER_ASSIGNED", "ASSIGNMENT", saved.getId(),
              requirement.getDate(), requirement.getWorkType().getCode());
          return Outcome.changed(saved.getId());
        });
  }

  public MutationResponse updateAssignment(UUID organizationId, UUID planId, UUID assignmentId,
      String ifMatch, AssignmentUpdateInput input) {
    AuthorizedPlan authorized = authorize(organizationId, planId);
    AssignmentUpdateInput normalized = normalize(input);
    return regular(authorized, ifMatch, plan -> {
      StaffingAssignment assignment = assignment(authorized, assignmentId);
      if (!"ASSIGNED".equals(assignment.getStatus())) {
        throw validation("Cancelled assignment cannot be updated");
      }
      validateRange(normalized.startTime(), normalized.endTime());
      if (Objects.equals(assignment.getStartTime(), normalized.startTime())
          && Objects.equals(assignment.getEndTime(), normalized.endTime())) {
        return Outcome.unchanged();
      }
      assignment.updateTimes(normalized.startTime(), normalized.endTime());
      audit(authorized.actor(), "ASSIGNMENT_UPDATED", "ASSIGNMENT", assignmentId,
          assignment.getRequirement().getDate(), assignment.getRequirement().getWorkType().getCode());
      return Outcome.changed(assignmentId);
    });
  }

  public MutationResponse cancelAssignment(UUID organizationId, UUID planId, UUID assignmentId,
      String ifMatch) {
    AuthorizedPlan authorized = authorize(organizationId, planId);
    return regular(authorized, ifMatch, plan -> {
      StaffingAssignment assignment = assignment(authorized, assignmentId);
      if ("CANCELLED".equals(assignment.getStatus())) return Outcome.unchanged();
      assignment.cancel();
      audit(authorized.actor(), "MEMBER_UNASSIGNED", "ASSIGNMENT", assignmentId,
          assignment.getRequirement().getDate(), assignment.getRequirement().getWorkType().getCode());
      return Outcome.changed(assignmentId);
    });
  }

  public MutationResponse batchAssignments(UUID organizationId, UUID planId, String ifMatch,
      String idempotencyKey, AssignmentBatchRequest request) {
    AuthorizedPlan authorized = authorize(organizationId, planId);
    validateAssignmentBatch(request.actions());
    AssignmentBatchRequest normalizedRequest = normalize(request);
    return idempotent(authorized, ifMatch, idempotencyKey, "ASSIGNMENT_BATCH", normalizedRequest, plan -> {
      Set<UUID> changed = new LinkedHashSet<>();
      for (AssignmentBatchAction action : normalizedRequest.actions()) {
        switch (action.operation()) {
          case CREATE -> {
            AssignmentInput input = normalize(action.create());
            StaffingRequirement requirement = requirement(authorized, input.requirementId());
            OrganizationMembership member = member(authorized, input.membershipId());
            validateRange(input.startTime(), input.endTime());
            if (assignments.existsByRequirementIdAndMembershipIdAndStatus(requirement.getId(),
                member.getId(), "ASSIGNED")) {
              throw error(HttpStatus.CONFLICT, "BATCH_CONFLICT",
                  "Batch contains a duplicate assignment");
            }
            StaffingAssignment value = assignments.findByRequirementIdAndMembershipId(requirement.getId(),
                member.getId()).map(existing -> {
                  existing.reactivate(input.startTime(), input.endTime());
                  return existing;
                }).orElseGet(() -> assignments.save(new StaffingAssignment(
                    requirement, member, input.startTime(), input.endTime(), authorized.actor())));
            assignments.flush();
            changed.add(value.getId());
          }
          case UPDATE -> {
            StaffingAssignment value = assignment(authorized, action.assignmentId());
            AssignmentUpdateInput input = normalize(action.update());
            validateRange(input.startTime(), input.endTime());
            if (!"ASSIGNED".equals(value.getStatus())) {
              throw validation("Cancelled assignment cannot be updated");
            }
            if (!Objects.equals(value.getStartTime(), input.startTime())
                || !Objects.equals(value.getEndTime(), input.endTime())) {
              value.updateTimes(input.startTime(), input.endTime());
              changed.add(value.getId());
            }
          }
          case CANCEL -> {
            StaffingAssignment value = assignment(authorized, action.assignmentId());
            if (!"CANCELLED".equals(value.getStatus())) {
              value.cancel();
              changed.add(value.getId());
            }
          }
          default -> throw validation("Assignment batch supports CREATE, UPDATE and CANCEL");
        }
      }
      if (!changed.isEmpty()) audit(authorized.actor(), "ASSIGNMENT_BATCH_UPDATED", "PLAN",
          planId, plan.getWeekStart(), changed.size() + " schedule changes");
      return new Outcome(!changed.isEmpty(), changed);
    });
  }

  private MutationResponse regular(AuthorizedPlan authorized, String ifMatch,
      Function<StaffingPlan, Outcome> mutation) {
    Set<Long> expected = ifMatchParser.parse(ifMatch, authorized.plan().getId());
    var result = coordinator.mutatePlan(authorized.organizationId(), authorized.scope(),
        authorized.actor(), plan -> {
          requireCurrent(plan, expected);
          long previous = plan.getDraftRevision();
          Outcome outcome = mutation.apply(plan);
          long current = previous + (outcome.changed() ? 1 : 0);
          MutationResponse response = new MutationResponse(plan.getId(), previous, current,
              outcome.changed(), Set.copyOf(outcome.ids()));
          return new StaffingPlanMutationCoordinator.Change<>(response, outcome.changed(),
              outcome.ids());
        });
    return result.value();
  }

  private MutationResponse idempotent(AuthorizedPlan authorized, String ifMatch,
      String idempotencyKey, String family, Object payload,
      Function<StaffingPlan, Outcome> mutation) {
    requireIdempotencyKey(idempotencyKey);
    Set<Long> expected = ifMatchParser.parse(ifMatch, authorized.plan().getId());
    String fingerprint = fingerprint(authorized.actor().getId(), family, expected, payload);
    var result = coordinator.mutatePlan(authorized.organizationId(), authorized.scope(),
        authorized.actor(), plan -> {
          StoredOperation stored = stored(authorized, family, idempotencyKey);
          if (stored != null) {
            if (!stored.fingerprint().equals(fingerprint)) {
              throw error(HttpStatus.CONFLICT, "IDEMPOTENCY_CONFLICT",
                  "Idempotency key was already used for a different request");
            }
            MutationResponse replay = readResponse(stored.payload());
            return StaffingPlanMutationCoordinator.Change.unchanged(replay);
          }
          requireCurrent(plan, expected);
          long previous = plan.getDraftRevision();
          UUID operationId = UUID.randomUUID();
          jdbc.update("""
              insert into staffing_plan_draft_mutation_operations(
                id,organization_id,unit_id,plan_id,actor_membership_id,operation_family,
                idempotency_key,request_fingerprint,base_draft_revision,operation_status)
              values(?,?,?,?,?,?,?,?,?,'PROCESSING')
              """, operationId, authorized.organizationId(), authorized.unit().getId(),
              plan.getId(), authorized.actor().getId(), family, idempotencyKey.trim(), fingerprint,
              previous);
          Outcome outcome = mutation.apply(plan);
          long current = previous + (outcome.changed() ? 1 : 0);
          MutationResponse response = new MutationResponse(plan.getId(), previous, current,
              outcome.changed(), Set.copyOf(outcome.ids()));
          jdbc.update("""
              update staffing_plan_draft_mutation_operations
              set operation_status='COMPLETED',resulting_draft_revision=?,response_payload=?,
                  completed_at=current_timestamp
              where id=?
              """, current, writeResponse(response), operationId);
          return new StaffingPlanMutationCoordinator.Change<>(response, outcome.changed(),
              outcome.ids());
        });
    return result.value();
  }

  private AuthorizedPlan authorize(UUID organizationId, UUID planId) {
    try {
      Set<OrganizationPermission> permissions = access.permissions(organizationId);
      StaffingPlan plan = plans.findByIdAndOrganizationId(planId, organizationId)
          .orElseThrow(() -> notFound("Staffing plan not found"));
      OrganizationUnit unit = units.findByIdAndOrganizationId(plan.getUnit().getId(), organizationId)
          .orElseThrow(() -> notFound("Staffing plan not found"));
      if (!permissions.contains(OrganizationPermission.MANAGE_SCHEDULE)) {
        throw error(HttpStatus.FORBIDDEN, "FORBIDDEN",
            "Required organization permission is missing");
      }
      if (!access.unitAccessFilter(organizationId, OrganizationPermission.MANAGE_SCHEDULE)
          .test(unit)) {
        throw notFound("Staffing plan not found");
      }
      OrganizationMembership actor = access.requireForUnit(organizationId, unit,
          OrganizationPermission.MANAGE_SCHEDULE);
      return new AuthorizedPlan(organizationId, plan, unit, actor,
          new StaffingPlanMutationCoordinator.Scope(planId, unit.getId()));
    } catch (NotFoundException exception) {
      throw notFound("Staffing plan not found");
    } catch (AccessDeniedException exception) {
      throw error(HttpStatus.FORBIDDEN, "FORBIDDEN",
          "Required organization permission is missing");
    }
  }

  private StaffingRequirement requirement(AuthorizedPlan authorized, UUID id) {
    if (id == null) throw validation("requirementId is required");
    return requirements.findForPlan(authorized.organizationId(), authorized.plan().getId(), id)
        .orElseThrow(() -> notFound("Staffing requirement not found"));
  }

  private StaffingAssignment assignment(AuthorizedPlan authorized, UUID id) {
    if (id == null) throw validation("assignmentId is required");
    return assignments.findForPlan(authorized.organizationId(), authorized.plan().getId(), id)
        .orElseThrow(() -> notFound("Staffing assignment not found"));
  }

  private OrganizationWorkType workType(AuthorizedPlan authorized, UUID id) {
    OrganizationWorkType value = workTypes.findByIdAndOrganizationId(id, authorized.organizationId())
        .orElseThrow(() -> notFound("Organization work type not found"));
    if (!value.isActive() || value.isCompositeEnabled()
        || (value.getUnit() != null
            && !value.getUnit().getId().equals(authorized.unit().getId()))) {
      throw notFound("Organization work type not found");
    }
    return value;
  }

  private OrganizationMembership member(AuthorizedPlan authorized, UUID id) {
    OrganizationMembership value = memberships.findByIdAndOrganizationId(id,
        authorized.organizationId()).orElseThrow(() -> notFound("Organization member not found"));
    if (value.getStatus() == MembershipStatus.SUSPENDED) {
      throw validation("Suspended member cannot receive assignments");
    }
    return value;
  }

  private StaffingPlanDay day(StaffingPlan plan, LocalDate date) {
    return planDays.findByPlanIdAndOrganizationIdAndDate(plan.getId(),
        plan.getOrganization().getId(), date).orElseGet(() -> planDays.save(
            new StaffingPlanDay(plan, date, null, null, StaffingPlanDaySource.MANUAL)));
  }

  private void requireCurrent(StaffingPlan plan, Set<Long> expected) {
    if (!expected.contains(plan.getDraftRevision())) {
      throw new StaffingPlanMutationApiException(HttpStatus.PRECONDITION_FAILED,
          "STALE_PLAN_REVISION", "Staffing plan draft revision is stale",
          StaffingPlanMutationCoordinator.etag(plan.getId(), plan.getDraftRevision()));
    }
  }

  private void validateDate(StaffingPlan plan, LocalDate date) {
    if (!plan.includes(date)) throw validation("date must belong to the plan week");
  }

  private TimeRange requirementTime(OrganizationWorkType workType, LocalTime start,
      LocalTime end) {
    LocalTime actualStart = start == null ? workType.getDefaultStartTime() : start;
    LocalTime actualEnd = end == null ? workType.getDefaultEndTime() : end;
    validateRange(actualStart, actualEnd);
    return new TimeRange(actualStart, actualEnd);
  }

  private void validateRange(LocalTime start, LocalTime end) {
    if (end != null && (start == null || !end.isAfter(start))) {
      throw validation("endTime requires an earlier startTime");
    }
  }

  private void validateDemandBatch(List<DemandBatchAction> actions) {
    Set<UUID> resources = new LinkedHashSet<>();
    for (DemandBatchAction action : actions) {
      boolean create = action.operation() == BatchOperation.CREATE;
      if (create != (action.create() != null)
          || (!create && action.requirementId() == null)
          || (action.operation() == BatchOperation.UPDATE) != (action.update() != null)) {
        throw batchConflict("Demand batch action shape is invalid");
      }
      if (!create && !resources.add(action.requirementId())) {
        throw batchConflict("Demand batch contains contradictory actions for one resource");
      }
    }
  }

  private void validateAssignmentBatch(List<AssignmentBatchAction> actions) {
    Set<UUID> resources = new LinkedHashSet<>();
    Set<String> creates = new LinkedHashSet<>();
    for (AssignmentBatchAction action : actions) {
      boolean create = action.operation() == BatchOperation.CREATE;
      if (create != (action.create() != null)
          || (!create && action.assignmentId() == null)
          || (action.operation() == BatchOperation.UPDATE) != (action.update() != null)) {
        throw batchConflict("Assignment batch action shape is invalid");
      }
      if (create) {
        String key = action.create().requirementId() + ":" + action.create().membershipId();
        if (!creates.add(key)) throw batchConflict("Assignment batch contains duplicate creates");
      } else if (!resources.add(action.assignmentId())) {
        throw batchConflict("Assignment batch contains contradictory actions for one resource");
      }
    }
  }

  private StoredOperation stored(AuthorizedPlan authorized, String family, String key) {
    List<StoredOperation> values = jdbc.query("""
        select request_fingerprint,response_payload from staffing_plan_draft_mutation_operations
        where organization_id=? and plan_id=? and operation_family=? and idempotency_key=?
          and operation_status='COMPLETED'
        """, (rs, row) -> new StoredOperation(rs.getString(1), rs.getString(2)),
        authorized.organizationId(), authorized.plan().getId(), family, key.trim());
    return values.stream().findFirst().orElse(null);
  }

  private String fingerprint(UUID actor, String family, Collection<Long> revisions, Object payload) {
    try {
      Map<String, Object> canonical = new LinkedHashMap<>();
      canonical.put("actor", actor.toString());
      canonical.put("family", family);
      canonical.put("baseRevisions", revisions.stream().sorted().toList());
      canonical.put("payload", payload);
      return sha256(objectMapper.writeValueAsBytes(canonical));
    } catch (JsonProcessingException exception) {
      throw new IllegalStateException("Could not fingerprint staffing mutation", exception);
    }
  }

  private String writeResponse(MutationResponse response) {
    try { return objectMapper.writeValueAsString(response); }
    catch (JsonProcessingException exception) {
      throw new IllegalStateException("Could not store idempotent response", exception);
    }
  }

  private MutationResponse readResponse(String payload) {
    try { return objectMapper.readValue(payload, MutationResponse.class); }
    catch (JsonProcessingException exception) {
      throw new IllegalStateException("Stored idempotent response is invalid", exception);
    }
  }

  private String sha256(byte[] value) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value));
    } catch (NoSuchAlgorithmException exception) {
      throw new IllegalStateException("SHA-256 is unavailable", exception);
    }
  }

  private void requireIdempotencyKey(String value) {
    if (value == null || !IDEMPOTENCY_KEY.matcher(value.trim()).matches()) {
      throw validation("Idempotency-Key must contain 1 to 200 visible ASCII characters");
    }
  }

  private RequirementInput normalize(RequirementInput value) {
    if (value == null) throw validation("requirement input is required");
    return new RequirementInput(value.date(), value.workTypeId(), value.startTime(),
        value.endTime(), value.requiredWorkers(), normalized(value.requiredQuantity()),
        clean(value.notes()));
  }

  private RequirementUpdateInput normalize(RequirementUpdateInput value) {
    if (value == null) throw validation("requirement update is required");
    return new RequirementUpdateInput(value.startTime(), value.endTime(),
        value.requiredWorkers(), normalized(value.requiredQuantity()), clean(value.notes()));
  }

  private AssignmentInput normalize(AssignmentInput value) {
    if (value == null) throw validation("assignment input is required");
    return new AssignmentInput(value.requirementId(), value.membershipId(), value.startTime(),
        value.endTime());
  }

  private AssignmentUpdateInput normalize(AssignmentUpdateInput value) {
    if (value == null) throw validation("assignment update is required");
    return value;
  }

  private DemandBatchRequest normalize(DemandBatchRequest value) {
    return new DemandBatchRequest(value.actions().stream().map(action -> new DemandBatchAction(
        action.operation(), action.requirementId(),
        action.create() == null ? null : normalize(action.create()),
        action.update() == null ? null : normalize(action.update()))).toList());
  }

  private AssignmentBatchRequest normalize(AssignmentBatchRequest value) {
    return new AssignmentBatchRequest(value.actions().stream().map(action ->
        new AssignmentBatchAction(action.operation(), action.assignmentId(),
            action.create() == null ? null : normalize(action.create()),
            action.update() == null ? null : normalize(action.update()))).toList());
  }

  private BigDecimal normalized(BigDecimal value) {
    return value == null ? null : value.stripTrailingZeros();
  }

  private String clean(String value) {
    return value == null || value.isBlank() ? null : value.trim();
  }

  private boolean same(StaffingRequirement value, RequirementUpdateInput input) {
    return Objects.equals(value.getStartTime(), input.startTime())
        && Objects.equals(value.getEndTime(), input.endTime())
        && value.getRequiredWorkers() == input.requiredWorkers()
        && Objects.equals(normalized(value.getRequiredQuantity()), input.requiredQuantity())
        && Objects.equals(clean(value.getNotes()), input.notes());
  }

  private void audit(OrganizationMembership actor, String event, String type, UUID id,
      LocalDate date, String summary) {
    changeEvents.save(new StaffingChangeEvent(actor.getOrganization(), actor, event, type, id,
        date, summary));
  }

  private StaffingPlanMutationApiException validation(String message) {
    return error(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", message);
  }

  private StaffingPlanMutationApiException batchConflict(String message) {
    return error(HttpStatus.CONFLICT, "BATCH_CONFLICT", message);
  }

  private StaffingPlanMutationApiException notFound(String message) {
    return error(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", message);
  }

  private StaffingPlanMutationApiException error(HttpStatus status, String code, String message) {
    return new StaffingPlanMutationApiException(status, code, message);
  }

  private record AuthorizedPlan(UUID organizationId, StaffingPlan plan, OrganizationUnit unit,
      OrganizationMembership actor, StaffingPlanMutationCoordinator.Scope scope) {}
  private record Outcome(boolean changed, Set<UUID> ids) {
    static Outcome changed(UUID id) { return new Outcome(true, Set.of(id)); }
    static Outcome unchanged() { return new Outcome(false, Set.of()); }
  }
  private record TimeRange(LocalTime start, LocalTime end) {}
  private record StoredOperation(String fingerprint, String payload) {}
}
