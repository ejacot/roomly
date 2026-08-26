-- Invitation state controls account access; employment status controls whether
-- a manager can schedule the person. Existing pending invitations remain
-- unable to authenticate because their access_state is still INVITED.
UPDATE organization_memberships
SET membership_status = 'ACTIVE'
WHERE access_state = 'INVITED'
  AND membership_status = 'INVITED';
