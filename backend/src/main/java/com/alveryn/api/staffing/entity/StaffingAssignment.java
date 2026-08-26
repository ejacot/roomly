package com.alveryn.api.staffing.entity;

import com.alveryn.api.common.persistence.BaseEntity;
import com.alveryn.api.organization.entity.OrganizationMembership;
import jakarta.persistence.*;
import java.time.LocalTime;
import java.util.Objects;
import lombok.*;

@Getter @NoArgsConstructor(access = AccessLevel.PROTECTED) @Entity
@Table(name = "staffing_assignments")
public class StaffingAssignment extends BaseEntity {
  @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "requirement_id") private StaffingRequirement requirement;
  @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "membership_id") private OrganizationMembership membership;
  @Column(name = "start_time") private LocalTime startTime;
  @Column(name = "end_time") private LocalTime endTime;
  @Column(name = "assignment_status", nullable = false, length = 20) private String status = "ASSIGNED";
  @ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "assigned_by_membership_id") private OrganizationMembership assignedBy;
  public StaffingAssignment(StaffingRequirement requirement, OrganizationMembership membership, LocalTime start,
      LocalTime end, OrganizationMembership assignedBy) {
    this.requirement = Objects.requireNonNull(requirement); this.membership = Objects.requireNonNull(membership);
    this.startTime = start; this.endTime = end; this.assignedBy = Objects.requireNonNull(assignedBy);
    if (end != null && start == null) throw new IllegalArgumentException("assignment start time is required");
  }

  public void cancel() { this.status = "CANCELLED"; }
  /** Reuses the immutable assignment identity after a manager restores it. */
  public void reactivate(LocalTime start, LocalTime end) {
    updateTimes(start, end);
    this.status = "ASSIGNED";
  }
  public void updateTimes(LocalTime start, LocalTime end) {
    if (end != null && start == null) throw new IllegalArgumentException("assignment start time is required");
    this.startTime = start; this.endTime = end;
  }
}
