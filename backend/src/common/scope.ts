import { Prisma, UserRole } from '@prisma/client';
import { AuthUser } from '../auth/current-user.decorator';

/**
 * 客户数据范围：按角色限定可见客户。
 * - ADMIN：全部
 * - SALES：自己负责的（ownerUserId）
 * - MARKET：自己登记的（enteredById）
 * - BUSINESS_SUPERVISOR：自己登记的 + 自己负责的
 * - DOWNSTREAM_SALES：管理员分配给自己的（downstreamSalesUserId）
 */
export function customerScopeWhere(user: AuthUser): Prisma.CustomerWhereInput {
  switch (user.role) {
    case UserRole.ADMIN:
      return {};
    case UserRole.SALES:
      return { ownerUserId: user.id };
    case UserRole.MARKET:
      return { enteredById: user.id };
    case UserRole.BUSINESS_SUPERVISOR:
      return {
        AND: [
          {
            OR: [{ enteredById: user.id }, { ownerUserId: user.id }],
          },
        ],
      };
    case UserRole.DOWNSTREAM_SALES:
      return { downstreamSalesUserId: user.id };
    default:
      return { id: -1 }; // 兜底：什么都看不到
  }
}

/** 是否能查看金额/财务（销售、市场、下游销售看不到上游分成与多数财务细节） */
export function canSeeUpstreamCommission(user: AuthUser): boolean {
  return user.role === UserRole.ADMIN;
}
