package com.alveryn.api.staffing.service;

import com.alveryn.api.auth.security.AuthenticatedUserAccessor;
import com.alveryn.api.common.exception.NotFoundException;
import com.alveryn.api.common.exception.ConflictException;
import com.alveryn.api.organization.entity.*;
import com.alveryn.api.organization.repository.*;
import com.alveryn.api.organization.service.OrganizationAccessService;
import com.alveryn.api.staffing.dto.StaffingDtos.*;
import com.alveryn.api.staffing.entity.*;
import com.alveryn.api.staffing.repository.*;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.*;
import jakarta.persistence.EntityManager;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service @RequiredArgsConstructor
public class StaffingPlannerService {
  private final AuthenticatedUserAccessor currentUser;
  private final OrganizationMembershipRepository memberships;
  private final OrganizationUnitRepository units;
  private final OrganizationWorkTypeRepository workTypes;
  private final StaffingRequirementRepository requirements;
  private final StaffingAssignmentRepository assignments;
  private final StaffingAssignmentResultRepository assignmentResults;
  private final StaffingMemberDayEntryRepository dayEntries;
  private final StaffingScheduleReceiptRepository receipts;
  private final StaffingChangeEventRepository changeEvents;
  private final StaffingAbsenceRequestRepository absenceRequests;
  private final OrganizationAccessService access;
  private final StaffingPlanMutationCoordinator mutations;
  private final StaffingPlanCoverageService coverageService;
  private final StaffingPublishedScheduleService publishedSchedule;
  private final EntityManager entityManager;

  @Transactional(readOnly = true)
  public List<WorkTypeResponse> listWorkTypes(UUID organizationId) {
    access.require(organizationId, OrganizationPermission.VIEW_SCHEDULE,
        OrganizationPermission.MANAGE_SCHEDULE);
    var canViewUnit = access.unitAccessFilter(organizationId,
        OrganizationPermission.VIEW_SCHEDULE, OrganizationPermission.MANAGE_SCHEDULE);
    return workTypes.findAllByOrganizationIdOrderByNameAsc(organizationId).stream()
        .filter(value -> canViewUnit.test(value.getUnit()))
        .map(this::workTypeResponse).toList();
  }
  @Transactional
  public void reorderMembers(UUID organizationId, MemberOrderRequest request) {
    access.require(organizationId, OrganizationPermission.MANAGE_SCHEDULE);
    var members = memberships.findAllByOrganizationIdOrderByCreatedAtAsc(organizationId);
    var requested = request.membershipIds();
    var expectedIds = members.stream().map(OrganizationMembership::getId).collect(java.util.stream.Collectors.toSet());
    var requestedIds = new LinkedHashSet<>(requested);
    if (requestedIds.size() != requested.size() || !requestedIds.equals(expectedIds)) {
      throw new IllegalArgumentException("member order must contain every organization member exactly once");
    }
    Map<UUID, OrganizationMembership> byId = members.stream()
        .collect(java.util.stream.Collectors.toMap(OrganizationMembership::getId, value -> value));
    for (int index = 0; index < requested.size(); index++) byId.get(requested.get(index)).setDisplayOrder(index);
  }
  @Transactional
  public WorkTypeResponse createWorkType(UUID organizationId, WorkTypeRequest request) {
    var unit = request.unitId() == null ? null : unit(organizationId, request.unitId());
    var manager = access.requireForUnit(organizationId, unit, OrganizationPermission.MANAGE_SCHEDULE);
    var existing=workTypes.findByOrganizationIdAndCodeIgnoreCase(organizationId,request.code().trim());
    if(existing.isPresent()){
      if(existing.get().isActive()) throw new ConflictException("A work type with this code already exists in this organization");
      var scopes=mutations.workTypeScopes(organizationId,existing.get().getId());
      return mutations.mutateScopes(organizationId,scopes,manager,null,()->{
        entityManager.refresh(existing.get());
        String before=workTypeFingerprint(existing.get());
        configure(existing.get(),organizationId,unit,request,true);
        var response=workTypeResponse(existing.get());
        return before.equals(workTypeFingerprint(existing.get()))
            ? StaffingPlanMutationCoordinator.Change.unchanged(response)
            : StaffingPlanMutationCoordinator.Change.changed(response,existing.get().getId());
      }).value();
    }
    var value=new OrganizationWorkType(manager.getOrganization(), unit, request.code(),
        workTypeName(request), request.color(), request.defaultStartTime(), request.defaultEndTime(),
        request.defaultBreakMinutes() == null ? 30 : request.defaultBreakMinutes());
    configure(value,organizationId,unit,request,true);
    return workTypeResponse(workTypes.save(value));
  }
  @Transactional(readOnly=true) public WorkTypeResponse getWorkType(UUID organizationId,UUID workTypeId){access.require(organizationId,OrganizationPermission.VIEW_SCHEDULE,OrganizationPermission.MANAGE_SCHEDULE);return workTypeResponse(workType(organizationId,workTypeId));}
  @Transactional public WorkTypeResponse updateWorkType(UUID organizationId,UUID workTypeId,WorkTypeRequest request){var unit=request.unitId()==null?null:unit(organizationId,request.unitId());var manager=access.requireForUnit(organizationId,unit,OrganizationPermission.MANAGE_SCHEDULE);var value=workType(organizationId,workTypeId);workTypes.findByOrganizationIdAndCodeIgnoreCase(organizationId,request.code().trim()).filter(other->!other.getId().equals(workTypeId)).ifPresent(other->{throw new ConflictException("A work type with this code already exists in this organization");});var scopes=mutations.workTypeScopes(organizationId,workTypeId);return mutations.mutateScopes(organizationId,scopes,manager,null,()->{entityManager.refresh(value);String before=workTypeFingerprint(value);configure(value,organizationId,unit,request,request.active()==null||request.active());var response=workTypeResponse(value);return before.equals(workTypeFingerprint(value))?StaffingPlanMutationCoordinator.Change.unchanged(response):StaffingPlanMutationCoordinator.Change.changed(response,value.getId());}).value();}
  @Transactional public void removeWorkType(UUID organizationId,UUID workTypeId){var value=workType(organizationId,workTypeId);var manager=access.requireForUnit(organizationId,value.getUnit(),OrganizationPermission.MANAGE_SCHEDULE);if(!requirements.existsByWorkTypeId(workTypeId)&&workTypes.findAllByParentId(workTypeId).isEmpty()){workTypes.delete(value);workTypes.flush();return;}deactivateWorkType(organizationId,workTypeId);}
  @Transactional public void deactivateWorkType(UUID organizationId,UUID workTypeId){var value=workType(organizationId,workTypeId);var manager=access.requireForUnit(organizationId,value.getUnit(),OrganizationPermission.MANAGE_SCHEDULE);var affected=new ArrayList<OrganizationWorkType>();affected.add(value);if(value.isCompositeEnabled())affected.addAll(workTypes.findAllByParentId(value.getId()));var scopes=affected.stream().flatMap(item->mutations.workTypeScopes(organizationId,item.getId()).stream()).distinct().toList();mutations.mutateScopes(organizationId,scopes,manager,null,()->{affected.forEach(entityManager::refresh);boolean changed=affected.stream().anyMatch(OrganizationWorkType::isActive);if(changed)affected.forEach(item->setActive(item,false));return changed?new StaffingPlanMutationCoordinator.Change<Void>(null,true,affected.stream().map(OrganizationWorkType::getId).collect(java.util.stream.Collectors.toSet())):StaffingPlanMutationCoordinator.Change.unchanged(null);});}
  private OrganizationWorkType workType(UUID organizationId,UUID id){return workTypes.findByIdAndOrganizationId(id,organizationId).orElseThrow(()->new NotFoundException("Organization work type",id));}
  private void configure(OrganizationWorkType value,UUID organizationId,OrganizationUnit unit,WorkTypeRequest request,boolean active){var parent=request.parentId()==null?null:workType(organizationId,request.parentId());if(parent!=null&&(!parent.isCompositeEnabled()||!parent.isActive()))throw new IllegalArgumentException("parent must be an active category");if(parent!=null&&Boolean.TRUE.equals(request.compositeEnabled()))throw new IllegalArgumentException("a category cannot belong to another category");var calculationMethod=parent==null?(request.calculationMethod()==null?com.alveryn.api.worktype.entity.CalculationMethod.TIME_BASED:request.calculationMethod()):parent.getCalculationMethod();if(value.getId()!=null&&value.isCompositeEnabled()&&value.getCalculationMethod()!=calculationMethod&&!workTypes.findAllByParentId(value.getId()).isEmpty())throw new IllegalArgumentException("category calculation cannot change while it contains work types");value.configure(unit,parent,request.code(),workTypeName(request),request.color(),request.defaultStartTime(),request.defaultEndTime(),request.defaultBreakMinutes()==null?30:request.defaultBreakMinutes(),calculationMethod,calculationMethod==com.alveryn.api.worktype.entity.CalculationMethod.UNIT_BASED?com.alveryn.api.worktype.entity.CompensationMethod.PER_UNIT:com.alveryn.api.worktype.entity.CompensationMethod.HOURLY,request.unitLabel(),request.unitSymbol(),request.unitsPerHour(),request.ratePerUnit(),request.currency(),Boolean.TRUE.equals(request.teamworkEnabled()),Boolean.TRUE.equals(request.extraPayEnabled()),Boolean.TRUE.equals(request.compositeEnabled()),request.displayOrder()==null?0:request.displayOrder(),active);}
  /** A code is the required short label; a missing full name deliberately falls back to it. */
  private String workTypeName(WorkTypeRequest request){return request.name()==null||request.name().isBlank()?request.code().trim().toUpperCase():request.name().trim();}
  private void setActive(OrganizationWorkType value,boolean active){value.configure(value.getUnit(),value.getParent(),value.getCode(),value.getName(),value.getColor(),value.getDefaultStartTime(),value.getDefaultEndTime(),value.getDefaultBreakMinutes(),value.getCalculationMethod(),value.getCompensationMethod(),value.getUnitLabel(),value.getUnitSymbol(),value.getUnitsPerHour(),value.getRatePerUnit(),value.getCurrency(),value.isTeamworkEnabled(),value.isExtraPayEnabled(),value.isCompositeEnabled(),value.getDisplayOrder(),active);}
  @Transactional(readOnly = true)
  public List<RequirementResponse> week(UUID organizationId, LocalDate from, LocalDate to) {
    access.require(organizationId, OrganizationPermission.VIEW_SCHEDULE,
        OrganizationPermission.MANAGE_SCHEDULE);
    if (to.isBefore(from) || to.isAfter(from.plusDays(31))) throw new IllegalArgumentException("invalid planner range");
    var canViewUnit = access.unitAccessFilter(organizationId,
        OrganizationPermission.VIEW_SCHEDULE, OrganizationPermission.MANAGE_SCHEDULE);
    List<StaffingRequirement> visible = requirements
        .findAllForManagerRange(organizationId, from, to)
        .stream().filter(value -> canViewUnit.test(value.getUnit())).toList();
    return requirementResponses(visible);
  }
  @Transactional
  public RequirementResponse createRequirement(UUID organizationId, RequirementRequest request) {
    var unit = unit(organizationId, request.unitId());
    var manager = access.requireForUnit(organizationId, unit, OrganizationPermission.MANAGE_SCHEDULE);
    var workType = workTypes.findByIdAndOrganizationId(request.workTypeId(), organizationId)
        .orElseThrow(() -> new NotFoundException("Organization work type", request.workTypeId()));
    requireSchedulable(workType);
    var start = request.startTime() == null ? workType.getDefaultStartTime() : request.startTime();
    var end = request.endTime() == null ? workType.getDefaultEndTime() : request.endTime();
    return mutations.mutateDates(organizationId, unit.getId(), Set.of(request.date()), manager, null,
        planDays -> {
          var saved = new StaffingRequirement(manager.getOrganization(), unit, workType,
              request.date(), start, end, request.requiredWorkers(), request.requiredQuantity(),
              request.notes(), manager);
          saved.attachToPlanDay(planDays.get(request.date()));
          requirements.save(saved);
          audit(manager, "REQUIREMENT_CREATED", "REQUIREMENT", saved.getId(), saved.getDate(),
              saved.getWorkType().getCode());
          return StaffingPlanMutationCoordinator.Change.changed(requirementResponse(saved), saved.getId());
        }).value();
  }
  @Transactional
  public List<RequirementResponse> createRequirements(UUID organizationId, BulkRequirementRequest request) {
    var unit = unit(organizationId, request.unitId());
    var manager = access.requireForUnit(organizationId, unit, OrganizationPermission.MANAGE_SCHEDULE);
    var workType = workTypes.findByIdAndOrganizationId(request.workTypeId(), organizationId)
        .orElseThrow(() -> new NotFoundException("Organization work type", request.workTypeId()));
    requireSchedulable(workType);
    var start = request.startTime() == null ? workType.getDefaultStartTime() : request.startTime();
    var end = request.endTime() == null ? workType.getDefaultEndTime() : request.endTime();
    if (end != null && start == null) throw new IllegalArgumentException("staffing start time is required");
    return mutations.mutateDates(organizationId, unit.getId(), request.dates(), manager, null,
        planDays -> {
          List<StaffingRequirement> values = request.dates().stream().sorted().map(date -> {
            var value = new StaffingRequirement(manager.getOrganization(), unit, workType, date,
                start, end, request.requiredWorkers(), request.requiredQuantity(), request.notes(), manager);
            value.attachToPlanDay(planDays.get(date));
            return requirements.save(value);
          }).toList();
          audit(manager, "REQUIREMENTS_CREATED", "REQUIREMENT", null,
              request.dates().stream().min(LocalDate::compareTo).orElse(null),
              workType.getCode() + " × " + request.dates().size());
          return new StaffingPlanMutationCoordinator.Change<>(requirementResponses(values), true,
              values.stream().map(StaffingRequirement::getId).collect(java.util.stream.Collectors.toSet()));
        }).value();
  }
  @Transactional
  public RequirementResponse assign(UUID organizationId, UUID requirementId, AssignmentRequest request) {
    var scope = mutations.requirementScope(organizationId, requirementId, requirements);
    var unit = unit(organizationId, scope.unitId());
    var manager = access.requireForUnit(organizationId, unit, OrganizationPermission.MANAGE_SCHEDULE);
    var member = memberships.findByIdAndOrganizationId(request.membershipId(), organizationId)
        .orElseThrow(() -> new NotFoundException("Organization member", request.membershipId()));
    if (member.getStatus() == MembershipStatus.SUSPENDED) {
      throw new IllegalArgumentException("suspended member cannot receive new assignments");
    }
    return mutations.mutateScopes(organizationId, List.of(scope), manager, null, () -> {
      var requirement = requirement(organizationId, requirementId);
      rejectAssignmentOnDayEntry(organizationId, member.getId(), requirement.getDate());
      var saved = assignments.save(new StaffingAssignment(requirement, member, request.startTime(),
          request.endTime(), manager));
      assignments.flush();
      audit(manager, "MEMBER_ASSIGNED", "ASSIGNMENT", saved.getId(), requirement.getDate(),
          memberName(member) + " · " + requirement.getWorkType().getCode());
      return StaffingPlanMutationCoordinator.Change.changed(requirementResponse(requirement), saved.getId());
    }).value();
  }
  @Transactional
  public RequirementResponse unassign(UUID organizationId, UUID requirementId, UUID assignmentId) {
    var scope = mutations.requirementScope(organizationId, requirementId, requirements);
    var manager = access.requireForUnit(organizationId, unit(organizationId, scope.unitId()),
        OrganizationPermission.MANAGE_SCHEDULE);
    return mutations.mutateScopes(organizationId, List.of(scope), manager, null, () -> {
      var requirement = requirement(organizationId, requirementId);
      var assignment = assignment(requirementId, assignmentId);
      if ("CANCELLED".equals(assignment.getStatus())) {
        return StaffingPlanMutationCoordinator.Change.unchanged(requirementResponse(requirement));
      }
      assignment.cancel();
      audit(manager, "MEMBER_UNASSIGNED", "ASSIGNMENT", assignmentId, requirement.getDate(),
          memberName(assignment.getMembership()) + " · " + requirement.getWorkType().getCode());
      return StaffingPlanMutationCoordinator.Change.changed(requirementResponse(requirement), assignmentId);
    }).value();
  }
  @Transactional
  public RequirementResponse updateRequirement(UUID organizationId, UUID requirementId, RequirementUpdateRequest request) {
    var scope = mutations.requirementScope(organizationId, requirementId, requirements);
    var manager = access.requireForUnit(organizationId, unit(organizationId, scope.unitId()),
        OrganizationPermission.MANAGE_SCHEDULE);
    return mutations.mutateScopes(organizationId, List.of(scope), manager, null, () -> {
      var requirement = requirement(organizationId, requirementId);
      rejectRequirementReparenting(requirement, request);
      if (sameRequirement(requirement, request)) {
        return StaffingPlanMutationCoordinator.Change.unchanged(requirementResponse(requirement));
      }
      requirement.update(request.startTime(), request.endTime(), request.requiredWorkers(),
          request.requiredQuantity(), request.notes());
      audit(manager, "REQUIREMENT_UPDATED", "REQUIREMENT", requirementId, requirement.getDate(),
          requirement.getWorkType().getCode());
      return StaffingPlanMutationCoordinator.Change.changed(requirementResponse(requirement), requirementId);
    }).value();
  }
  @Transactional
  public void deleteRequirement(UUID organizationId, UUID requirementId) {
    var scope = mutations.requirementScope(organizationId, requirementId, requirements);
    var manager = access.requireForUnit(organizationId, unit(organizationId, scope.unitId()),
        OrganizationPermission.MANAGE_SCHEDULE);
    mutations.mutateScopes(organizationId, List.of(scope), manager, null, () -> {
      var requirement = requirement(organizationId, requirementId);
      audit(manager, "REQUIREMENT_DELETED", "REQUIREMENT", requirementId, requirement.getDate(),
          requirement.getWorkType().getCode());
      requirements.delete(requirement);
      return StaffingPlanMutationCoordinator.Change.changed(null, requirementId);
    });
  }
  @Transactional
  public RequirementResponse updateAssignment(UUID organizationId, UUID requirementId, UUID assignmentId, AssignmentTimeRequest request) {
    var scope = mutations.requirementScope(organizationId, requirementId, requirements);
    var manager = access.requireForUnit(organizationId, unit(organizationId, scope.unitId()),
        OrganizationPermission.MANAGE_SCHEDULE);
    return mutations.mutateScopes(organizationId, List.of(scope), manager, null, () -> {
      var requirement = requirement(organizationId, requirementId);
      var assignment = assignment(requirementId, assignmentId);
      if (Objects.equals(assignment.getStartTime(), request.startTime())
          && Objects.equals(assignment.getEndTime(), request.endTime())) {
        return StaffingPlanMutationCoordinator.Change.unchanged(requirementResponse(requirement));
      }
      assignment.updateTimes(request.startTime(), request.endTime());
      audit(manager, "ASSIGNMENT_UPDATED", "ASSIGNMENT", assignmentId, requirement.getDate(),
          memberName(assignment.getMembership()));
      return StaffingPlanMutationCoordinator.Change.changed(requirementResponse(requirement), assignmentId);
    }).value();
  }
  @Transactional
  public PublishResponse publish(UUID organizationId, PublishRequest request) {
    var manager = access.require(organizationId, OrganizationPermission.PUBLISH_SCHEDULE);
    if (request.to().isBefore(request.from()) || request.to().isAfter(request.from().plusDays(31))) throw new IllegalArgumentException("invalid planner range");
    var selected = requirements.findAllByOrganizationIdAndDateBetweenOrderByDateAscStartTimeAsc(organizationId, request.from(), request.to()).stream()
        .filter(value -> request.requirementIds() == null || request.requirementIds().isEmpty() || request.requirementIds().contains(value.getId())).toList();
    selected.forEach(value -> access.requireForUnit(organizationId, value.getUnit(),
        OrganizationPermission.PUBLISH_SCHEDULE));
    List<StaffingPlanMutationCoordinator.Scope> scopes = selected.stream()
        .map(value -> mutations.requirementScope(organizationId, value.getId(), requirements))
        .distinct().toList();
    Set<UUID> ids = selected.stream().map(StaffingRequirement::getId)
        .collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new));
    return mutations.mutateScopes(organizationId, scopes, manager, null, () -> {
      List<StaffingRequirement> current = requirements.findAllById(ids).stream()
          .filter(value -> value.getOrganization().getId().equals(organizationId)).toList();
      List<StaffingRequirement> changedRequirements = current.stream()
          .filter(value -> !"PUBLISHED".equals(value.getPublicationStatus())).toList();
      boolean changed = !changedRequirements.isEmpty();
      changedRequirements.forEach(StaffingRequirement::publish);
      int publishedAssignments = current.stream().mapToInt(value -> assignments
          .findAllByRequirementIdAndStatusOrderByCreatedAtAsc(value.getId(), "ASSIGNED").size()).sum();
      if (changed) audit(manager, "SCHEDULE_PUBLISHED", "SCHEDULE", null, request.from(),
          request.from() + " — " + request.to());
      var response = new PublishResponse(current.size(), publishedAssignments);
      Set<UUID> changedPlanIds = changedRequirements.stream()
          .map(value -> value.getPlanDay().getPlan().getId())
          .collect(java.util.stream.Collectors.toSet());
      return changed ? StaffingPlanMutationCoordinator.Change.changedInPlans(response,
          changedRequirements.stream().map(StaffingRequirement::getId).toList(), changedPlanIds)
          : StaffingPlanMutationCoordinator.Change.unchanged(response);
    }).value();
  }
  @Transactional(readOnly = true)
  public List<ChangeEventResponse> history(UUID organizationId, int limit) {
    access.require(organizationId, OrganizationPermission.VIEW_SCHEDULE,
        OrganizationPermission.MANAGE_SCHEDULE);
    return changeEvents.findAllByOrganizationIdOrderByCreatedAtDesc(organizationId, org.springframework.data.domain.PageRequest.of(0, Math.min(Math.max(limit, 1), 100))).stream()
        .map(value -> new ChangeEventResponse(value.getId(), value.getEventType(), value.getEntityType(), value.getEntityId(), value.getWorkDate(), value.getSummary(), value.getActor() == null ? "—" : memberName(value.getActor()), value.getCreatedAt())).toList();
  }
  @Transactional
  public AssignmentResultResponse saveMyResult(UUID assignmentId, ResultRequest request) {
    var assignment = assignments.findById(assignmentId)
        .filter(value -> value.getMembership().getUser() != null && value.getMembership().getUser().getId().equals(currentUser.requireUserId()))
        .filter(value -> publishedSchedule.isCurrentPublishedAssignment(
            currentUser.requireUserId(), assignmentId))
        .orElseThrow(() -> new NotFoundException("Staffing assignment", assignmentId));
    var result = assignmentResults.findByAssignmentId(assignmentId).orElseGet(() -> new StaffingAssignmentResult(assignment));
    if ("APPROVED".equals(result.getApprovalStatus())) throw new IllegalArgumentException("approved result cannot be changed");
    result.save(request.actualStartTime(), request.actualEndTime(), request.breakMinutes() == null ? 30 : request.breakMinutes(), request.completedQuantity(), request.notes(), request.submit());
    var saved = assignmentResults.save(result);
    audit(assignment.getMembership(), request.submit() ? "RESULT_SUBMITTED" : "RESULT_SAVED", "ASSIGNMENT_RESULT", saved.getId(), assignment.getRequirement().getDate(), assignment.getRequirement().getWorkType().getCode());
    return resultResponse(saved);
  }
  @Transactional
  public AssignmentResultResponse checkIn(UUID assignmentId) {
    var assignment = ownPublishedAssignment(assignmentId);
    if (assignment.getRequirement().getUnit().getCheckInMode() == CheckInMode.DISABLED) {
      throw new IllegalArgumentException("check-in is disabled for this team");
    }
    var result = assignmentResults.findByAssignmentId(assignmentId)
        .orElseGet(() -> new StaffingAssignmentResult(assignment));
    if ("APPROVED".equals(result.getApprovalStatus())) throw new IllegalArgumentException("approved result cannot be changed");
    var now = OffsetDateTime.now(java.time.ZoneId.of(assignment.getRequirement().getOrganization().getTimezone()));
    result.checkIn(now, now.toLocalTime().withNano(0), assignment.getRequirement().getWorkType().getDefaultBreakMinutes());
    var saved = assignmentResults.save(result);
    audit(assignment.getMembership(), "CHECKED_IN", "ASSIGNMENT_RESULT", saved.getId(), assignment.getRequirement().getDate(), assignment.getRequirement().getWorkType().getCode());
    return resultResponse(saved);
  }
  @Transactional
  public AssignmentResultResponse checkOut(UUID assignmentId) {
    var assignment = ownPublishedAssignment(assignmentId);
    if (assignment.getRequirement().getUnit().getCheckInMode() == CheckInMode.DISABLED) {
      throw new IllegalArgumentException("check-in is disabled for this team");
    }
    var result = assignmentResults.findByAssignmentId(assignmentId)
        .orElseThrow(() -> new IllegalArgumentException("check-in is required before check-out"));
    var now = OffsetDateTime.now(java.time.ZoneId.of(assignment.getRequirement().getOrganization().getTimezone()));
    result.checkOut(now, now.toLocalTime().withNano(0));
    audit(assignment.getMembership(), "CHECKED_OUT", "ASSIGNMENT_RESULT", result.getId(), assignment.getRequirement().getDate(), assignment.getRequirement().getWorkType().getCode());
    return resultResponse(result);
  }
  @Transactional(readOnly = true)
  public List<AssignmentResultResponse> pendingResults(UUID organizationId) {
    access.require(organizationId, OrganizationPermission.APPROVE_ACTUALS);
    return assignmentResults.findAllByAssignmentRequirementOrganizationIdAndApprovalStatusOrderBySubmittedAtAsc(organizationId, "SUBMITTED").stream().map(this::resultResponse).toList();
  }
  @Transactional(readOnly = true)
  public TeamMemberHoursResponse memberHours(UUID organizationId, UUID membershipId, LocalDate from,
      LocalDate to, int offset, int limit) {
    if (to.isBefore(from) || to.isAfter(from.plusDays(366)) || offset < 0 || limit < 1 || limit > 100) {
      throw new IllegalArgumentException("invalid hours range");
    }
    access.require(organizationId, OrganizationPermission.VIEW_TEAM_HOURS);
    var member = memberships.findByIdAndOrganizationId(membershipId, organizationId)
        .orElseThrow(() -> new NotFoundException("Organization member", membershipId));
    var allowedUnits = access.unitAccessFilter(organizationId, OrganizationPermission.VIEW_TEAM_HOURS);
    var memberAssignments = assignments.findAssignedForMemberReport(organizationId, membershipId, from, to);
    var assignmentsForMember = memberAssignments.stream()
        .filter(value -> allowedUnits.test(value.getRequirement().getUnit())).toList();
    if ((assignmentsForMember.isEmpty() && !memberAssignments.isEmpty())
        || (assignmentsForMember.isEmpty() && member.getStatus() != MembershipStatus.ACTIVE)) {
      throw new NotFoundException("Organization member", membershipId);
    }
    var resultsByAssignment = assignmentsForMember.isEmpty() ? Map.<UUID, StaffingAssignmentResult>of()
        : assignmentResults.findAllForAssignments(assignmentsForMember.stream()
            .map(StaffingAssignment::getId).toList()).stream()
            .collect(java.util.stream.Collectors.toMap(value -> value.getAssignment().getId(), value -> value));
    Map<LocalDate, List<StaffingAssignment>> byDate = assignmentsForMember.stream()
        .collect(java.util.stream.Collectors.groupingBy(value -> value.getRequirement().getDate(), TreeMap::new,
            java.util.stream.Collectors.toList()));
    List<TeamHoursDayResponse> days = byDate.entrySet().stream().map(entry -> {
      int planned = entry.getValue().stream().mapToInt(this::plannedMinutes).sum();
      List<StaffingAssignmentResult> results = entry.getValue().stream()
          .map(value -> resultsByAssignment.get(value.getId())).filter(Objects::nonNull).toList();
      int worked = results.stream().map(this::calculatedMinutes).filter(Objects::nonNull)
          .mapToInt(Integer::intValue).sum();
      int open = (int) results.stream().filter(value -> value.getCheckedInAt() != null
          && value.getCheckedOutAt() == null).count();
      int incomplete = (int) entry.getValue().stream().filter(value -> {
        StaffingAssignmentResult result = resultsByAssignment.get(value.getId());
        return result == null || (result.getCheckedInAt() == null
            && (result.getActualStartTime() == null || result.getActualEndTime() == null));
      }).count();
      int corrected = (int) results.stream().filter(value -> "APPROVED".equals(value.getApprovalStatus())).count();
      int completed = (int) results.stream().filter(value -> calculatedMinutes(value) != null).count();
      return new TeamHoursDayResponse(entry.getKey(), planned, worked, completed, open, incomplete, corrected);
    }).toList();
    int planned = days.stream().mapToInt(TeamHoursDayResponse::plannedMinutes).sum();
    int worked = days.stream().mapToInt(TeamHoursDayResponse::workedMinutes).sum();
    var allSessions = assignmentsForMember.stream().map(assignment -> {
      var result = resultsByAssignment.get(assignment.getId());
      String state = result == null ? "INCOMPLETE"
          : result.getCheckedInAt() != null && result.getCheckedOutAt() == null ? "OPEN"
          : "APPROVED".equals(result.getApprovalStatus()) ? "CORRECTED"
          : calculatedMinutes(result) == null ? "INCOMPLETE" : "COMPLETED";
      return new TeamHoursSessionResponse(assignment.getRequirement().getDate(),
          assignment.getRequirement().getUnit().getName(), assignment.getRequirement().getWorkType().getName(),
          assignment.getStartTime(), assignment.getEndTime(), result == null ? null : result.getActualStartTime(),
          result == null ? null : result.getActualEndTime(), result == null ? 0 : result.getBreakMinutes(),
          result == null ? null : calculatedMinutes(result), state);
    }).sorted(Comparator.comparing(TeamHoursSessionResponse::date).reversed()).toList();
    var sessions = allSessions.stream().skip(offset).limit(limit).toList();
    var absences = assignmentsForMember.isEmpty() ? List.<TeamHoursAbsenceResponse>of()
        : dayEntries.findAllByOrganizationIdAndMembershipIdAndDateBetweenOrderByDateAsc(
            organizationId, membershipId, from, to).stream()
            .filter(value -> "VACATION".equals(value.getType()) || "SICK".equals(value.getType()))
            .map(value -> new TeamHoursAbsenceResponse(value.getDate(), value.getType(), value.getNotes())).toList();
    return new TeamMemberHoursResponse(member.getId(), memberName(member), from, to,
        (int) days.stream().filter(value -> value.workedMinutes() > 0).count(), planned, worked, days,
        periods(days, value -> value.with(java.time.temporal.TemporalAdjusters.previousOrSame(java.time.DayOfWeek.MONDAY)),
            value -> value.plusDays(6)),
        periods(days, value -> value.withDayOfMonth(1),
            value -> value.plusMonths(1).minusDays(1)), sessions, allSessions.size(), offset, absences);
  }
  @Transactional
  public AssignmentResultResponse approveResult(UUID organizationId, UUID resultId, ResultReviewRequest request) {
    var manager = access.require(organizationId, OrganizationPermission.APPROVE_ACTUALS);
    var result = assignmentResults.findById(resultId)
        .filter(value -> value.getAssignment().getRequirement().getOrganization().getId().equals(organizationId))
        .orElseThrow(() -> new NotFoundException("Staffing assignment result", resultId));
    if (!"SUBMITTED".equals(result.getApprovalStatus())) throw new IllegalArgumentException("only submitted results can be approved");
    result.approve(manager, request.actualStartTime(), request.actualEndTime(), request.breakMinutes() == null ? 30 : request.breakMinutes(), request.completedQuantity(), request.notes());
    audit(manager, "RESULT_APPROVED", "ASSIGNMENT_RESULT", result.getId(), result.getAssignment().getRequirement().getDate(), memberName(result.getAssignment().getMembership()));
    return resultResponse(result);
  }
  @Transactional
  public AbsenceRequestResponse createMyAbsenceRequest(AbsenceRequestCreate request) {
    if (request.endDate().isBefore(request.startDate()) || request.endDate().isAfter(request.startDate().plusDays(365))) throw new IllegalArgumentException("invalid absence range");
    if (!Set.of("REST_DAY","VACATION","SICK").contains(request.type())) throw new IllegalArgumentException("invalid absence type");
    var member = memberships.findByOrganizationIdAndUserId(request.organizationId(), currentUser.requireUserId())
        .filter(value -> value.getStatus() == MembershipStatus.ACTIVE).orElseThrow(() -> new NotFoundException("Organization", request.organizationId()));
    var scopes = mutations.memberDateScopes(request.organizationId(), member.getId(),
        request.startDate(), request.endDate());
    return mutations.mutateScopes(request.organizationId(), scopes, member, null, () -> {
      var saved = absenceRequests.save(new StaffingAbsenceRequest(member,request.type(),
          request.startDate(),request.endDate(),request.notes()));
      audit(member,"ABSENCE_REQUESTED","ABSENCE_REQUEST",saved.getId(),request.startDate(),request.type());
      return StaffingPlanMutationCoordinator.Change.changed(absenceResponse(saved), saved.getId());
    }).value();
  }
  @Transactional(readOnly=true)
  public List<AbsenceRequestResponse> myAbsenceRequests(){return absenceRequests.findAllByMembershipUserIdOrderByCreatedAtDesc(currentUser.requireUserId()).stream().map(this::absenceResponse).toList();}
  @Transactional(readOnly=true)
  public List<AbsenceRequestResponse> pendingAbsenceRequests(UUID organizationId){access.require(organizationId,OrganizationPermission.MANAGE_ABSENCES);return absenceRequests.findAllByOrganizationIdAndStatusOrderByCreatedAtAsc(organizationId,"PENDING").stream().map(this::absenceResponse).toList();}
  @Transactional
  public AbsenceRequestResponse decideAbsenceRequest(UUID organizationId,UUID requestId,AbsenceDecisionRequest request){
    var manager=access.require(organizationId,OrganizationPermission.MANAGE_ABSENCES);
    var observed=absenceRequest(organizationId,requestId);
    var scopes=mutations.memberDateScopes(organizationId, observed.getMembership().getId(),
        observed.getStartDate(), observed.getEndDate());
    return mutations.mutateScopes(organizationId,scopes,manager,null,()->{
      var value=absenceRequest(organizationId,requestId);
      entityManager.refresh(value);
      value.decide(request.approve(),manager);
      if(request.approve()) value.getStartDate().datesUntil(value.getEndDate().plusDays(1)).forEach(date->{
        var entry=dayEntries.findByOrganizationIdAndMembershipIdAndDate(organizationId,
            value.getMembership().getId(),date).map(item->{item.update(value.getType(),value.getNotes());return item;})
            .orElseGet(()->new StaffingMemberDayEntry(manager.getOrganization(),value.getMembership(),date,
                value.getType(),value.getNotes(),manager));
        dayEntries.save(entry);
      });
      audit(manager,request.approve()?"ABSENCE_APPROVED":"ABSENCE_REJECTED","ABSENCE_REQUEST",
          value.getId(),value.getStartDate(),memberName(value.getMembership()));
      return StaffingPlanMutationCoordinator.Change.changed(absenceResponse(value),value.getId());
    }).value();
  }
  @Transactional(readOnly = true)
  public List<DayEntryResponse> dayEntries(UUID organizationId, LocalDate from, LocalDate to) {
    access.require(organizationId, OrganizationPermission.VIEW_SCHEDULE,
        OrganizationPermission.MANAGE_SCHEDULE);
    if (to.isBefore(from) || to.isAfter(from.plusDays(31))) throw new IllegalArgumentException("invalid planner range");
    return dayEntries.findAllByOrganizationIdAndDateBetweenOrderByDateAsc(organizationId, from, to).stream().map(this::dayEntryResponse).toList();
  }
  @Transactional
  public DayEntryResponse setDayEntry(UUID organizationId, UUID membershipId, LocalDate date, DayEntryRequest request) {
    var manager = access.require(organizationId, OrganizationPermission.MANAGE_SCHEDULE,
        OrganizationPermission.MANAGE_ABSENCES);
    var member = memberships.findByIdAndOrganizationId(membershipId, organizationId)
        .orElseThrow(() -> new NotFoundException("Organization member", membershipId));
    var scopes = mutations.memberDateScopes(organizationId, membershipId, date, date);
    return mutations.mutateScopes(organizationId, scopes, manager, null, () -> {
      var existing=dayEntries.findByOrganizationIdAndMembershipIdAndDate(organizationId,membershipId,date);
      if(existing.isPresent() && sameDayEntry(existing.get(),request)) {
        return StaffingPlanMutationCoordinator.Change.unchanged(dayEntryResponse(existing.get()));
      }
      if (!assignments.findAllByMembershipIdAndStatusAndRequirementDate(membershipId, "ASSIGNED", date)
          .isEmpty()) {
        throw new ConflictException("Remove the person's assignment before setting Day off, Vacation, or Sick.",
            "DAY_STATUS_ASSIGNMENT_CONFLICT");
      }
      var entry=existing.map(value->{value.update(request.type(),request.notes());return value;})
          .orElseGet(()->new StaffingMemberDayEntry(manager.getOrganization(),member,date,
              request.type(),request.notes(),manager));
      dayEntries.save(entry);
      return StaffingPlanMutationCoordinator.Change.changed(dayEntryResponse(entry),entry.getId());
    }).value();
  }
  @Transactional
  public void removeDayEntry(UUID organizationId, UUID membershipId, LocalDate date) {
    var manager=access.require(organizationId, OrganizationPermission.MANAGE_SCHEDULE,
        OrganizationPermission.MANAGE_ABSENCES);
    var scopes=mutations.memberDateScopes(organizationId,membershipId,date,date);
    mutations.mutateScopes(organizationId,scopes,manager,null,()->{
      var existing=dayEntries.findByOrganizationIdAndMembershipIdAndDate(organizationId,membershipId,date);
      if(existing.isEmpty()) return StaffingPlanMutationCoordinator.Change.unchanged(null);
      UUID id=existing.get().getId(); dayEntries.delete(existing.get());
      return StaffingPlanMutationCoordinator.Change.changed(null,id);
    });
  }
  private void rejectAssignmentOnDayEntry(UUID organizationId, UUID membershipId, LocalDate date) {
    dayEntries.findByOrganizationIdAndMembershipIdAndDate(organizationId, membershipId, date)
        .ifPresent(entry -> {
          throw new ConflictException("This person is marked " + dayEntryLabel(entry.getType())
              + " for this day. Remove that status before assigning work.",
              "DAY_STATUS_ASSIGNMENT_CONFLICT");
        });
  }
  private static String dayEntryLabel(String type) {
    return switch (type) {
      case "REST_DAY" -> "Day off";
      case "VACATION" -> "Vacation";
      case "SICK" -> "Sick";
      default -> "unavailable";
    };
  }
  private OrganizationUnit unit(UUID organizationId, UUID unitId) { return units.findByIdAndOrganizationId(unitId, organizationId).orElseThrow(() -> new NotFoundException("Organization unit", unitId)); }
  private StaffingRequirement requirement(UUID organizationId,UUID id){return requirements.findByIdAndOrganizationId(id,organizationId).orElseThrow(()->new NotFoundException("Staffing requirement",id));}
  private StaffingAssignment assignment(UUID requirementId,UUID id){return assignments.findByIdAndRequirementId(id,requirementId).orElseThrow(()->new NotFoundException("Staffing assignment",id));}
  private StaffingAbsenceRequest absenceRequest(UUID organizationId,UUID id){return absenceRequests.findById(id).filter(value->value.getOrganization().getId().equals(organizationId)).orElseThrow(()->new NotFoundException("Absence request",id));}
  private boolean sameRequirement(StaffingRequirement value,RequirementUpdateRequest request){return Objects.equals(value.getStartTime(),request.startTime())&&Objects.equals(value.getEndTime(),request.endTime())&&value.getRequiredWorkers()==request.requiredWorkers()&&Objects.equals(value.getRequiredQuantity(),request.requiredQuantity())&&Objects.equals(clean(value.getNotes()),clean(request.notes()));}
  private void rejectRequirementReparenting(StaffingRequirement value,RequirementUpdateRequest request){if((request.unitId()!=null&&!request.unitId().equals(value.getUnit().getId()))||(request.workTypeId()!=null&&!request.workTypeId().equals(value.getWorkType().getId()))||(request.date()!=null&&!request.date().equals(value.getDate())))throw new IllegalArgumentException("requirement date, unit and work type cannot be changed; delete and recreate it");}
  private boolean sameDayEntry(StaffingMemberDayEntry value,DayEntryRequest request){return Objects.equals(value.getType(),request.type())&&Objects.equals(clean(value.getNotes()),clean(request.notes()));}
  private String clean(String value){return value==null||value.isBlank()?null:value.trim();}
  private String workTypeFingerprint(OrganizationWorkType value){return String.join("\u001f",Objects.toString(value.getUnit()==null?null:value.getUnit().getId(),""),Objects.toString(value.getParent()==null?null:value.getParent().getId(),""),value.getCode(),value.getName(),Objects.toString(value.getColor(),""),Objects.toString(value.getDefaultStartTime(),""),Objects.toString(value.getDefaultEndTime(),""),Integer.toString(value.getDefaultBreakMinutes()),value.getCalculationMethod().name(),value.getCompensationMethod().name(),Objects.toString(value.getUnitLabel(),""),Objects.toString(value.getUnitSymbol(),""),Objects.toString(value.getUnitsPerHour(),""),Objects.toString(value.getRatePerUnit(),""),Objects.toString(value.getCurrency(),""),Boolean.toString(value.isTeamworkEnabled()),Boolean.toString(value.isExtraPayEnabled()),Boolean.toString(value.isCompositeEnabled()),Integer.toString(value.getDisplayOrder()),Boolean.toString(value.isActive()));}
  private void requireSchedulable(OrganizationWorkType value) { if (!value.isActive() || value.isCompositeEnabled()) throw new IllegalArgumentException("only active work types can be scheduled"); }
  private WorkTypeResponse workTypeResponse(OrganizationWorkType value) { return new WorkTypeResponse(value.getId(), value.getUnit() == null ? null : value.getUnit().getId(),value.getParent()==null?null:value.getParent().getId(), value.getCode(), value.getName(), value.getColor(), value.getDefaultStartTime(), value.getDefaultEndTime(), value.getDefaultBreakMinutes(),value.getCalculationMethod(),value.getCompensationMethod(),value.getUnitLabel(),value.getUnitSymbol(),value.getUnitsPerHour(),value.getRatePerUnit(),value.getCurrency(),value.isTeamworkEnabled(),value.isExtraPayEnabled(),value.isCompositeEnabled(),value.getDisplayOrder(),value.isActive()); }
  private List<RequirementResponse> requirementResponses(Collection<StaffingRequirement> values) {
    if (values.isEmpty()) return List.of();
    entityManager.flush();
    Set<UUID> requirementIds = values.stream().map(StaffingRequirement::getId)
        .collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new));
    List<StaffingAssignment> assigned = assignments.findAssignedForRequirements(requirementIds);
    Map<UUID, List<StaffingAssignment>> assignmentsByRequirement = assigned.stream()
        .collect(java.util.stream.Collectors.groupingBy(value -> value.getRequirement().getId(),
            LinkedHashMap::new, java.util.stream.Collectors.toList()));
    Map<UUID, StaffingAssignmentResult> resultsByAssignment = assigned.isEmpty() ? Map.of()
        : assignmentResults.findAllForAssignments(
                assigned.stream().map(StaffingAssignment::getId).toList()).stream()
            .collect(java.util.stream.Collectors.toMap(
                value -> value.getAssignment().getId(), java.util.function.Function.identity()));
    Map<ReceiptKey, StaffingScheduleReceipt> receiptsByScope = loadReceipts(values, assigned);
    Map<UUID, StaffingPlanCoverageService.CoverageResult> coverageByPlan = new HashMap<>();
    for (StaffingRequirement value : values) {
      StaffingPlan plan = Objects.requireNonNull(value.getPlanDay(), "requirement plan day is required")
          .getPlan();
      coverageByPlan.computeIfAbsent(plan.getId(), ignored -> coverageService.calculate(
          plan.getOrganization().getId(), plan.getUnit().getId(), plan.getId()));
    }
    return values.stream().map(value -> {
      StaffingPlan plan = value.getPlanDay().getPlan();
      return requirementResponse(value, coverageByPlan.get(plan.getId()),
          assignmentsByRequirement.getOrDefault(value.getId(), List.of()), resultsByAssignment,
          receiptsByScope);
    }).toList();
  }

  private RequirementResponse requirementResponse(StaffingRequirement value) {
    return requirementResponses(List.of(value)).getFirst();
  }

  private RequirementResponse requirementResponse(StaffingRequirement value,
      StaffingPlanCoverageService.CoverageResult coverageResult,
      List<StaffingAssignment> assigned, Map<UUID, StaffingAssignmentResult> resultsByAssignment,
      Map<ReceiptKey, StaffingScheduleReceipt> receiptsByScope) {
    StaffingPlanCoverageService.RequirementCoverage canonical = Objects.requireNonNull(
        coverageResult.requirement(value.getId()), "canonical requirement coverage is required");
    int difference = canonical.effectiveAssigned() - canonical.required();
    String coverage = difference < 0 ? "UNDERSTAFFED" : difference > 0 ? "OVERSTAFFED" : "COVERED";
    var assignmentResponses = assigned.stream().map(item -> {
      var conflicts = conflictingAssignmentIds(coverageResult, item.getId());
      boolean hasConflict = !conflicts.isEmpty() || coverageResult.issues().stream()
          .anyMatch(issue -> item.getId().equals(issue.assignmentId())
              && (issue.code() == StaffingPlanCoverageService.IssueCode.INCOMPATIBLE_OVERLAP
                  || issue.code() == StaffingPlanCoverageService.IssueCode.DUPLICATE_ASSIGNMENT));
      return new AssignmentResponse(item.getId(), item.getMembership().getId(), memberName(item.getMembership()),
          effectiveStart(item), effectiveEnd(item), hasConflict, conflicts,
          viewed(value, item.getMembership(), receiptsByScope),
          Optional.ofNullable(resultsByAssignment.get(item.getId())).map(this::resultResponse).orElse(null));
    }).toList();
    return new RequirementResponse(value.getId(), value.getUnit().getId(), value.getUnit().getName(), value.getWorkType().getId(), value.getWorkType().getCode(), value.getWorkType().getName(), value.getWorkType().getColor(), value.getDate(), value.getStartTime(), value.getEndTime(), value.getRequiredWorkers(), value.getRequiredQuantity(), canonical.assigned(), difference, coverage, value.getPublicationStatus(), value.getUnit().getCheckInMode().name(), assignmentResponses);
  }

  private List<UUID> conflictingAssignmentIds(
      StaffingPlanCoverageService.CoverageResult coverage, UUID assignmentId) {
    LinkedHashSet<UUID> result = new LinkedHashSet<>();
    coverage.issues().stream().filter(issue -> issue.code()
        == StaffingPlanCoverageService.IssueCode.INCOMPATIBLE_OVERLAP
        || issue.code() == StaffingPlanCoverageService.IssueCode.DUPLICATE_ASSIGNMENT)
        .map(issue -> issue.parameters().get("assignmentPair")).filter(Objects::nonNull)
        .map(pair -> Arrays.stream(pair.split(":"))
            .map(UUID::fromString).toList())
        .filter(pair -> pair.contains(assignmentId))
        .flatMap(Collection::stream).filter(value -> !value.equals(assignmentId))
        .forEach(result::add);
    return List.copyOf(result);
  }
  private Map<ReceiptKey, StaffingScheduleReceipt> loadReceipts(
      Collection<StaffingRequirement> requirements, Collection<StaffingAssignment> assigned) {
    if (assigned.isEmpty() || requirements.stream().noneMatch(value -> value.getPublishedAt() != null)) {
      return Map.of();
    }
    Set<UUID> organizations = requirements.stream().map(value -> value.getOrganization().getId())
        .collect(java.util.stream.Collectors.toSet());
    Set<UUID> members = assigned.stream().map(value -> value.getMembership().getId())
        .collect(java.util.stream.Collectors.toSet());
    Set<LocalDate> weeks = requirements.stream().map(value -> value.getDate().with(
        java.time.temporal.TemporalAdjusters.previousOrSame(java.time.DayOfWeek.MONDAY)))
        .collect(java.util.stream.Collectors.toSet());
    return receipts.findAllForScopes(
        organizations, members, weeks).stream().collect(java.util.stream.Collectors.toMap(
            value -> new ReceiptKey(value.getOrganization().getId(), value.getMembership().getId(),
                value.getWeekStart()), java.util.function.Function.identity(),
            (left, right) -> left));
  }
  private java.time.LocalTime effectiveStart(StaffingAssignment item) { return item.getStartTime() == null ? item.getRequirement().getStartTime() : item.getStartTime(); }
  private java.time.LocalTime effectiveEnd(StaffingAssignment item) { return item.getEndTime() == null ? item.getRequirement().getEndTime() : item.getEndTime(); }
  private DayEntryResponse dayEntryResponse(StaffingMemberDayEntry value) {
    boolean conflict = !assignments.findAllByMembershipIdAndStatusAndRequirementDate(value.getMembership().getId(), "ASSIGNED", value.getDate()).isEmpty();
    return new DayEntryResponse(value.getId(), value.getMembership().getId(), value.getDate(), value.getType(), value.getNotes(), conflict);
  }
  private PersonalAssignmentResponse personalAssignmentResponse(StaffingAssignment value) {
    var requirement = value.getRequirement();
    return new PersonalAssignmentResponse(value.getId(), null, requirement.getDate(), requirement.getUnit().getId(),
        requirement.getUnit().getName(), requirement.getWorkType().getId(), requirement.getWorkType().getCode(),
        requirement.getWorkType().getName(), requirement.getWorkType().getColor(), effectiveStart(value),
        effectiveEnd(value), requirement.getUnit().getCheckInMode().name(),
        assignmentResults.findByAssignmentId(value.getId()).map(this::personalResultResponse).orElse(null));
  }
  private PersonalDayEntryResponse personalDayEntryResponse(StaffingMemberDayEntry value,
      boolean hasPublishedWorkConflict) {
    return new PersonalDayEntryResponse(value.getId(), null, value.getDate(), value.getType(), value.getNotes(),
        hasPublishedWorkConflict);
  }
  private PersonalAssignmentResultResponse personalResultResponse(StaffingAssignmentResult value) {
    return new PersonalAssignmentResultResponse(value.getId(), value.getActualStartTime(),
        value.getActualEndTime(), value.getBreakMinutes(), value.getCompletedQuantity(),
        calculatedMinutes(value), value.getNotes(), value.getApprovalStatus(), value.getSubmittedAt(),
        value.getReviewedAt(), value.getCheckedInAt(), value.getCheckedOutAt(),
        value.getTimeCaptureSource());
  }
  private boolean viewed(StaffingRequirement requirement, OrganizationMembership member,
      Map<ReceiptKey, StaffingScheduleReceipt> receiptsByScope) {
    if (requirement.getPublishedAt() == null) return false;
    var weekStart = requirement.getDate().with(java.time.temporal.TemporalAdjusters.previousOrSame(java.time.DayOfWeek.MONDAY));
    StaffingScheduleReceipt receipt = receiptsByScope.get(new ReceiptKey(
        requirement.getOrganization().getId(), member.getId(), weekStart));
    return receipt != null && !receipt.getViewedAt().isBefore(requirement.getPublishedAt());
  }
  private void audit(OrganizationMembership actor, String eventType, String entityType, UUID entityId, LocalDate date, String summary) { changeEvents.save(new StaffingChangeEvent(actor.getOrganization(), actor, eventType, entityType, entityId, date, summary)); }
  private AssignmentResultResponse resultResponse(StaffingAssignmentResult value) {
    var assignment = value.getAssignment(); var requirement = assignment.getRequirement();
    return new AssignmentResultResponse(value.getId(), assignment.getId(), requirement.getOrganization().getId(),
        requirement.getOrganization().getName(), memberName(assignment.getMembership()), requirement.getDate(),
        requirement.getWorkType().getName(), requirement.getWorkType().getCode(), requirement.getUnit().getName(),
        value.getActualStartTime(), value.getActualEndTime(), value.getBreakMinutes(), value.getCompletedQuantity(), calculatedMinutes(value),
        value.getNotes(), value.getApprovalStatus(), value.getSubmittedAt(), value.getReviewedAt(),
        value.getCheckedInAt(), value.getCheckedOutAt(), value.getTimeCaptureSource());
  }
  private Integer calculatedMinutes(StaffingAssignmentResult value) {
    var workType=value.getAssignment().getRequirement().getWorkType();
    if(workType.getCalculationMethod()==com.alveryn.api.worktype.entity.CalculationMethod.UNITS_PER_HOUR_BASED
        && value.getCompletedQuantity()!=null&&workType.getUnitsPerHour()!=null&&workType.getUnitsPerHour().signum()>0)
      return value.getCompletedQuantity().multiply(java.math.BigDecimal.valueOf(60)).divide(workType.getUnitsPerHour(),0,java.math.RoundingMode.HALF_UP).intValue();
    if(value.getActualStartTime()==null||value.getActualEndTime()==null)return null;
    long minutes=java.time.Duration.between(value.getActualStartTime(),value.getActualEndTime()).toMinutes();
    if(minutes<0)minutes+=24*60;
    return (int)Math.max(0,minutes-value.getBreakMinutes());
  }
  private int plannedMinutes(StaffingAssignment value) {
    LocalTime start = value.getStartTime() == null ? value.getRequirement().getStartTime() : value.getStartTime();
    LocalTime end = value.getEndTime() == null ? value.getRequirement().getEndTime() : value.getEndTime();
    if (start == null || end == null) return 0;
    long minutes = java.time.Duration.between(start, end).toMinutes();
    if (minutes < 0) minutes += 24 * 60;
    return (int) Math.max(0, minutes - value.getRequirement().getWorkType().getDefaultBreakMinutes());
  }
  private List<TeamHoursPeriodResponse> periods(List<TeamHoursDayResponse> days,
      java.util.function.Function<LocalDate, LocalDate> start,
      java.util.function.Function<LocalDate, LocalDate> end) {
    return days.stream().collect(java.util.stream.Collectors.groupingBy(value -> start.apply(value.date()),
        TreeMap::new, java.util.stream.Collectors.toList())).entrySet().stream()
        .map(entry -> new TeamHoursPeriodResponse(entry.getKey(), end.apply(entry.getKey()),
            entry.getValue().stream().mapToInt(TeamHoursDayResponse::plannedMinutes).sum(),
            entry.getValue().stream().mapToInt(TeamHoursDayResponse::workedMinutes).sum())).toList();
  }
  private StaffingAssignment ownPublishedAssignment(UUID assignmentId) {
    return assignments.findById(assignmentId)
        .filter(value -> value.getMembership().getUser() != null
            && value.getMembership().getUser().getId().equals(currentUser.requireUserId()))
        .filter(value -> publishedSchedule.isCurrentPublishedAssignment(
            currentUser.requireUserId(), assignmentId))
        .orElseThrow(() -> new NotFoundException("Staffing assignment", assignmentId));
  }
  private AbsenceRequestResponse absenceResponse(StaffingAbsenceRequest value){return new AbsenceRequestResponse(value.getId(),value.getOrganization().getId(),value.getOrganization().getName(),value.getMembership().getId(),memberName(value.getMembership()),value.getType(),value.getStartDate(),value.getEndDate(),value.getNotes(),value.getStatus(),value.getCreatedAt(),value.getReviewedAt());}
  private String memberName(OrganizationMembership member) { if (member.getUser() != null) return member.getUser().getEmail(); return String.join(" ", List.of(member.getFirstName() == null ? "" : member.getFirstName(), member.getLastName() == null ? "" : member.getLastName())).trim(); }
  private record ReceiptKey(UUID organizationId, UUID membershipId, LocalDate weekStart) {}
}
