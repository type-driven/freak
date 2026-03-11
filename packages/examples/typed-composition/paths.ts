/**
 * Platform-style mount paths for this typed composition example.
 *
 * Mirrors control-panel patterns in type-driven.com/platform where plugin
 * sub-apps are mounted under an org-scoped platform prefix.
 */

export const PLATFORM_ROOT_TEMPLATE = "/orgs/:orgSlug/platform";

export const COUNTER_SUB_APP_TEMPLATE = `${PLATFORM_ROOT_TEMPLATE}/counter`;
export const GREETING_SUB_APP_TEMPLATE = `${PLATFORM_ROOT_TEMPLATE}/greeting`;

export function platformRootForOrg(orgSlug: string): string {
  return `/orgs/${encodeURIComponent(orgSlug)}/platform`;
}

export function counterSubAppForOrg(orgSlug: string): string {
  return `${platformRootForOrg(orgSlug)}/counter`;
}

export function greetingSubAppForOrg(orgSlug: string): string {
  return `${platformRootForOrg(orgSlug)}/greeting`;
}
