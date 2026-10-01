import { describe, expect, it } from 'vitest';
import { can } from './admin.js';

describe('admin RBAC', () => {
  it('only admins can ban and read the audit log', () => {
    expect(can('admin', 'accounts:ban')).toBe(true);
    expect(can('moderator', 'accounts:ban')).toBe(false);
    expect(can('moderator', 'accounts:warn_suspend')).toBe(true);
    expect(can('grievance_officer', 'audit:read')).toBe(false);
  });
  it('grievance officers manage grievances and legal requests; moderators do not', () => {
    expect(can('grievance_officer', 'grievances:manage')).toBe(true);
    expect(can('grievance_officer', 'legal:manage')).toBe(true);
    expect(can('moderator', 'grievances:manage')).toBe(false);
  });
});
