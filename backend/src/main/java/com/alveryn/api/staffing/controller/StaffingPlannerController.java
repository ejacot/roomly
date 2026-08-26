package com.alveryn.api.staffing.controller;
import com.alveryn.api.common.response.ApiResponse;
import com.alveryn.api.staffing.dto.StaffingDtos.*;
import com.alveryn.api.staffing.service.StaffingPlannerService;
import jakarta.validation.Valid;
import java.time.LocalDate;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController @RequestMapping("/api/organizations/{organizationId}/staffing") @RequiredArgsConstructor
public class StaffingPlannerController {
  private final StaffingPlannerService service;
  @GetMapping("/work-types") public ApiResponse<List<WorkTypeResponse>> workTypes(@PathVariable UUID organizationId) { return ApiResponse.of(service.listWorkTypes(organizationId)); }
  @PutMapping("/members/order") @ResponseStatus(HttpStatus.NO_CONTENT) public void reorderMembers(@PathVariable UUID organizationId,@Valid @RequestBody MemberOrderRequest request){service.reorderMembers(organizationId,request);}
  @PostMapping("/work-types") @ResponseStatus(HttpStatus.CREATED) public ApiResponse<WorkTypeResponse> createWorkType(@PathVariable UUID organizationId, @Valid @RequestBody WorkTypeRequest request) { return ApiResponse.of(service.createWorkType(organizationId, request)); }
  @GetMapping("/work-types/{workTypeId}") public ApiResponse<WorkTypeResponse> workType(@PathVariable UUID organizationId,@PathVariable UUID workTypeId){return ApiResponse.of(service.getWorkType(organizationId,workTypeId));}
  @PutMapping("/work-types/{workTypeId}") public ApiResponse<WorkTypeResponse> updateWorkType(@PathVariable UUID organizationId,@PathVariable UUID workTypeId,@Valid @RequestBody WorkTypeRequest request){return ApiResponse.of(service.updateWorkType(organizationId,workTypeId,request));}
  @DeleteMapping("/work-types/{workTypeId}") @ResponseStatus(HttpStatus.NO_CONTENT) public void removeWorkType(@PathVariable UUID organizationId,@PathVariable UUID workTypeId){service.removeWorkType(organizationId,workTypeId);}
  @GetMapping("/requirements") public ApiResponse<List<RequirementResponse>> week(@PathVariable UUID organizationId, @RequestParam LocalDate from, @RequestParam LocalDate to) { return ApiResponse.of(service.week(organizationId, from, to)); }
  @PostMapping("/requirements") @ResponseStatus(HttpStatus.CREATED) public ApiResponse<RequirementResponse> createRequirement(@PathVariable UUID organizationId, @Valid @RequestBody RequirementRequest request) { return ApiResponse.of(service.createRequirement(organizationId, request)); }
  @PostMapping("/requirements/bulk") @ResponseStatus(HttpStatus.CREATED) public ApiResponse<List<RequirementResponse>> createRequirements(@PathVariable UUID organizationId, @Valid @RequestBody BulkRequirementRequest request) { return ApiResponse.of(service.createRequirements(organizationId, request)); }
  @PutMapping("/requirements/{requirementId}") public ApiResponse<RequirementResponse> updateRequirement(@PathVariable UUID organizationId, @PathVariable UUID requirementId, @Valid @RequestBody RequirementUpdateRequest request) { return ApiResponse.of(service.updateRequirement(organizationId, requirementId, request)); }
  @DeleteMapping("/requirements/{requirementId}") @ResponseStatus(HttpStatus.NO_CONTENT) public void deleteRequirement(@PathVariable UUID organizationId, @PathVariable UUID requirementId) { service.deleteRequirement(organizationId, requirementId); }
  @PostMapping("/requirements/{requirementId}/assignments") @ResponseStatus(HttpStatus.CREATED) public ApiResponse<RequirementResponse> assign(@PathVariable UUID organizationId, @PathVariable UUID requirementId, @Valid @RequestBody AssignmentRequest request) { return ApiResponse.of(service.assign(organizationId, requirementId, request)); }
  @DeleteMapping("/requirements/{requirementId}/assignments/{assignmentId}") public ApiResponse<RequirementResponse> unassign(@PathVariable UUID organizationId, @PathVariable UUID requirementId, @PathVariable UUID assignmentId) { return ApiResponse.of(service.unassign(organizationId, requirementId, assignmentId)); }
  @PutMapping("/requirements/{requirementId}/assignments/{assignmentId}") public ApiResponse<RequirementResponse> updateAssignment(@PathVariable UUID organizationId, @PathVariable UUID requirementId, @PathVariable UUID assignmentId, @Valid @RequestBody AssignmentTimeRequest request) { return ApiResponse.of(service.updateAssignment(organizationId, requirementId, assignmentId, request)); }
  @PostMapping("/publish") public ApiResponse<PublishResponse> publish(@PathVariable UUID organizationId, @Valid @RequestBody PublishRequest request) { return ApiResponse.of(service.publish(organizationId, request)); }
  @GetMapping("/day-entries") public ApiResponse<List<DayEntryResponse>> dayEntries(@PathVariable UUID organizationId, @RequestParam LocalDate from, @RequestParam LocalDate to) { return ApiResponse.of(service.dayEntries(organizationId, from, to)); }
  @PutMapping("/members/{membershipId}/days/{date}") public ApiResponse<DayEntryResponse> setDayEntry(@PathVariable UUID organizationId, @PathVariable UUID membershipId, @PathVariable LocalDate date, @Valid @RequestBody DayEntryRequest request) { return ApiResponse.of(service.setDayEntry(organizationId, membershipId, date, request)); }
  @DeleteMapping("/members/{membershipId}/days/{date}") @ResponseStatus(HttpStatus.NO_CONTENT) public void removeDayEntry(@PathVariable UUID organizationId, @PathVariable UUID membershipId, @PathVariable LocalDate date) { service.removeDayEntry(organizationId, membershipId, date); }
  @GetMapping("/history") public ApiResponse<List<ChangeEventResponse>> history(@PathVariable UUID organizationId,@RequestParam(defaultValue="30") int limit){return ApiResponse.of(service.history(organizationId,limit));}
  @GetMapping("/results/pending") public ApiResponse<List<AssignmentResultResponse>> pendingResults(@PathVariable UUID organizationId){return ApiResponse.of(service.pendingResults(organizationId));}
  @GetMapping("/members/{membershipId}/hours") public ApiResponse<TeamMemberHoursResponse> memberHours(@PathVariable UUID organizationId,@PathVariable UUID membershipId,@RequestParam LocalDate from,@RequestParam LocalDate to,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="100") int limit){return ApiResponse.of(service.memberHours(organizationId,membershipId,from,to,offset,limit));}
  @PutMapping("/results/{resultId}/approve") public ApiResponse<AssignmentResultResponse> approveResult(@PathVariable UUID organizationId,@PathVariable UUID resultId,@Valid @RequestBody ResultReviewRequest request){return ApiResponse.of(service.approveResult(organizationId,resultId,request));}
  @GetMapping("/absence-requests/pending") public ApiResponse<List<AbsenceRequestResponse>> pendingAbsences(@PathVariable UUID organizationId){return ApiResponse.of(service.pendingAbsenceRequests(organizationId));}
  @PutMapping("/absence-requests/{requestId}/decision") public ApiResponse<AbsenceRequestResponse> decideAbsence(@PathVariable UUID organizationId,@PathVariable UUID requestId,@RequestBody AbsenceDecisionRequest request){return ApiResponse.of(service.decideAbsenceRequest(organizationId,requestId,request));}
}
