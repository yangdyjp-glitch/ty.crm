import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export interface AuthUser {
  id: number;
  username: string;
  name: string;
  role: UserRole;
  impersonatorId?: number;
  impersonator?: {
    id: number;
    username: string;
    name: string;
    role: UserRole;
  } | null;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    return ctx.switchToHttp().getRequest().user;
  },
);
