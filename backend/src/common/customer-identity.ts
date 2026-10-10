import { SourceCategory } from '@prisma/client';

export function normalizeCustomerName(name: string) {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export interface CustomerIdentity {
  name: string;
  sourceCategory: SourceCategory;
  channelId?: number | null;
  acquisitionChannelId?: number | null;
}

export function sameCustomerCandidate(a: CustomerIdentity, b: CustomerIdentity) {
  if (!normalizeCustomerName(a.name) || normalizeCustomerName(a.name) !== normalizeCustomerName(b.name)) {
    return false;
  }
  const aChannel = a.sourceCategory === SourceCategory.SELF ? a.acquisitionChannelId : a.channelId;
  const bChannel = b.sourceCategory === SourceCategory.SELF ? b.acquisitionChannelId : b.channelId;
  // Missing channels are weak matches and always require human confirmation.
  if (!aChannel || !bChannel) return true;
  return (a.sourceCategory === SourceCategory.SELF) === (b.sourceCategory === SourceCategory.SELF)
    && aChannel === bChannel;
}
