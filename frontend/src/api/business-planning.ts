import type { ApiResponse } from "../types/api";
import type { AxiosResponse } from "axios";
import type {
  ApiEntityResult,
  StaffingAssignmentBatchAction,
  StaffingAssignmentCandidates,
  StaffingAssignmentInput,
  StaffingAssignmentUpdateInput,
  StaffingCoverage,
  StaffingDemand,
  StaffingDemandBatchAction,
  StaffingMutationResult,
  StaffingPlanBootstrapResult,
  StaffingPlanHeader,
  StaffingPlanLookup,
  StaffingPublishInput,
  StaffingPublishResult,
  StaffingReview,
  StaffingRequirementInput,
  StaffingRequirementUpdateInput,
  StaffingSchedule,
  StaffingVersionDetail,
  StaffingVersions,
} from "../types/business-planning";
import { http } from "./http";

function response<T>(
  value: Pick<AxiosResponse<ApiResponse<T>>, "data" | "headers" | "status">,
): ApiEntityResult<T> {
  const rawEtag = typeof value.headers.get === "function"
    ? value.headers.get("etag")
    : value.headers.etag;
  const replay = typeof value.headers.get === "function"
    ? value.headers.get("idempotent-replay")
    : value.headers["idempotent-replay"];
  const location = typeof value.headers.get === "function"
    ? value.headers.get("location")
    : value.headers.location;
  return {
    data: value.data.data,
    etag: typeof rawEtag === "string" ? rawEtag : null,
    location: typeof location === "string" ? location : null,
    status: value.status,
    idempotentReplay: replay === "true",
  };
}

function planPath(organizationId: string) {
  return `/api/organizations/${organizationId}/staffing/plans`;
}

export async function findStaffingPlan(
  organizationId: string,
  unitId: string,
  weekStart: string,
) {
  return response(
    await http.get<ApiResponse<StaffingPlanLookup>>(planPath(organizationId), {
      params: { unitId, weekStart },
    }),
  );
}

export async function createStaffingPlan(
  organizationId: string,
  input: { unitId: string; weekStart: string },
  idempotencyKey: string,
) {
  return response(
    await http.post<ApiResponse<StaffingPlanBootstrapResult>>(
      planPath(organizationId),
      input,
      { headers: { "Idempotency-Key": idempotencyKey } },
    ),
  );
}

export async function getStaffingDemand(
  organizationId: string,
  planId: string,
) {
  return response(
    await http.get<ApiResponse<StaffingDemand>>(
      `${planPath(organizationId)}/${planId}/demand`,
    ),
  );
}

export async function getStaffingSchedule(
  organizationId: string,
  planId: string,
) {
  return response(
    await http.get<ApiResponse<StaffingSchedule>>(
      `${planPath(organizationId)}/${planId}/schedule`,
    ),
  );
}

/** Persists the custom people order for the whole Business organization. */
export async function reorderStaffingMembers(organizationId: string, membershipIds: string[]) {
  await http.put(`/api/organizations/${organizationId}/staffing/members/order`, { membershipIds });
}

export async function getStaffingPlanHeader(
  organizationId: string,
  planId: string,
) {
  return response(
    await http.get<ApiResponse<StaffingPlanHeader>>(
      `${planPath(organizationId)}/${planId}`,
    ),
  );
}

export async function getStaffingCoverage(
  organizationId: string,
  planId: string,
) {
  return response(
    await http.get<ApiResponse<StaffingCoverage>>(
      `${planPath(organizationId)}/${planId}/coverage`,
    ),
  );
}

export async function getStaffingReview(
  organizationId: string,
  planId: string,
) {
  return response(
    await http.get<ApiResponse<StaffingReview>>(
      `${planPath(organizationId)}/${planId}/review`,
    ),
  );
}

export async function getStaffingVersions(
  organizationId: string,
  planId: string,
  options: { limit?: number; beforeVersion?: number; ifNoneMatch?: string } = {},
) {
  const result = await http.get<ApiResponse<StaffingVersions>>(
    `${planPath(organizationId)}/${planId}/versions`,
    {
      params: {
        limit: options.limit,
        beforeVersion: options.beforeVersion,
      },
      headers: options.ifNoneMatch ? { "If-None-Match": options.ifNoneMatch } : undefined,
      validateStatus: (status) => status === 200 || status === 304,
    },
  );
  if (result.status === 304) {
    return {
      data: null,
      etag: typeof result.headers.etag === "string" ? result.headers.etag : null,
      location: null,
      status: 304,
      idempotentReplay: false,
    };
  }
  return response(result);
}

export async function getStaffingVersion(
  organizationId: string,
  planId: string,
  versionNumber: number,
  ifNoneMatch?: string,
) {
  const result = await http.get<ApiResponse<StaffingVersionDetail>>(
    `${planPath(organizationId)}/${planId}/versions/${versionNumber}`,
    {
      headers: ifNoneMatch ? { "If-None-Match": ifNoneMatch } : undefined,
      validateStatus: (status) => status === 200 || status === 304,
    },
  );
  if (result.status === 304) {
    return {
      data: null,
      etag: typeof result.headers.etag === "string" ? result.headers.etag : null,
      location: null,
      status: 304,
      idempotentReplay: false,
    };
  }
  return response(result);
}

export async function publishStaffingPlan(
  organizationId: string,
  planId: string,
  etag: string,
  idempotencyKey: string,
  input: StaffingPublishInput,
) {
  return response(
    await http.post<ApiResponse<StaffingPublishResult>>(
      `${planPath(organizationId)}/${planId}/publish`,
      input,
      { headers: { "If-Match": etag, "Idempotency-Key": idempotencyKey } },
    ),
  );
}

export async function getStaffingAssignmentCandidates(
  organizationId: string,
  planId: string,
  requirementId: string,
) {
  return response(
    await http.get<ApiResponse<StaffingAssignmentCandidates>>(
      `${planPath(organizationId)}/${planId}/assignment-candidates`,
      { params: { requirementId } },
    ),
  );
}

export async function createStaffingAssignment(
  organizationId: string,
  planId: string,
  etag: string,
  idempotencyKey: string,
  input: StaffingAssignmentInput,
) {
  return response(
    await http.post<ApiResponse<StaffingMutationResult>>(
      `${planPath(organizationId)}/${planId}/schedule/assignments`,
      input,
      { headers: { "If-Match": etag, "Idempotency-Key": idempotencyKey } },
    ),
  );
}

export async function updateStaffingAssignment(
  organizationId: string,
  planId: string,
  assignmentId: string,
  etag: string,
  input: StaffingAssignmentUpdateInput,
) {
  return response(
    await http.put<ApiResponse<StaffingMutationResult>>(
      `${planPath(organizationId)}/${planId}/schedule/assignments/${assignmentId}`,
      input,
      { headers: { "If-Match": etag } },
    ),
  );
}

export async function cancelStaffingAssignment(
  organizationId: string,
  planId: string,
  assignmentId: string,
  etag: string,
) {
  return response(
    await http.delete<ApiResponse<StaffingMutationResult>>(
      `${planPath(organizationId)}/${planId}/schedule/assignments/${assignmentId}`,
      { headers: { "If-Match": etag } },
    ),
  );
}

export async function batchStaffingAssignments(
  organizationId: string,
  planId: string,
  etag: string,
  idempotencyKey: string,
  actions: StaffingAssignmentBatchAction[],
) {
  return response(
    await http.post<ApiResponse<StaffingMutationResult>>(
      `${planPath(organizationId)}/${planId}/schedule/assignments/batch`,
      { actions },
      { headers: { "If-Match": etag, "Idempotency-Key": idempotencyKey } },
    ),
  );
}

export async function createStaffingRequirement(
  organizationId: string,
  planId: string,
  etag: string,
  idempotencyKey: string,
  input: StaffingRequirementInput,
) {
  return response(
    await http.post<ApiResponse<StaffingMutationResult>>(
      `${planPath(organizationId)}/${planId}/demand/requirements`,
      input,
      {
        headers: {
          "If-Match": etag,
          "Idempotency-Key": idempotencyKey,
        },
      },
    ),
  );
}

export async function updateStaffingRequirement(
  organizationId: string,
  planId: string,
  requirementId: string,
  etag: string,
  input: StaffingRequirementUpdateInput,
) {
  return response(
    await http.put<ApiResponse<StaffingMutationResult>>(
      `${planPath(organizationId)}/${planId}/demand/requirements/${requirementId}`,
      input,
      { headers: { "If-Match": etag } },
    ),
  );
}

export async function deleteStaffingRequirement(
  organizationId: string,
  planId: string,
  requirementId: string,
  etag: string,
) {
  return response(
    await http.delete<ApiResponse<StaffingMutationResult>>(
      `${planPath(organizationId)}/${planId}/demand/requirements/${requirementId}`,
      { headers: { "If-Match": etag } },
    ),
  );
}

export async function batchStaffingDemand(
  organizationId: string,
  planId: string,
  etag: string,
  idempotencyKey: string,
  actions: StaffingDemandBatchAction[],
) {
  return response(
    await http.post<ApiResponse<StaffingMutationResult>>(
      `${planPath(organizationId)}/${planId}/demand/batch`,
      { actions },
      {
        headers: {
          "If-Match": etag,
          "Idempotency-Key": idempotencyKey,
        },
      },
    ),
  );
}
