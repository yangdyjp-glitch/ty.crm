export const inPortal = /^\/crm(?:\/|$)/.test(window.location.pathname)
export const crmBase = inPortal ? '/crm' : ''
export const crmHome = crmBase + '/'
export const impersonationKey = 'tyai.crm.impersonation'

export function portalLoginUrl() {
  const { pathname, search, hash } = window.location
  return '/?' + new URLSearchParams({ next: pathname + search + hash })
}
