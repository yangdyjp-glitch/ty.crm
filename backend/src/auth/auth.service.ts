import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from './current-user.decorator';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  private userDto(
    user: Pick<User, 'id' | 'username' | 'name' | 'role'>,
    impersonator?: Pick<User, 'id' | 'username' | 'name' | 'role'> | null,
  ) {
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      impersonator: impersonator
        ? {
            id: impersonator.id,
            username: impersonator.username,
            name: impersonator.name,
            role: impersonator.role,
          }
        : null,
    };
  }

  private signFor(user: Pick<User, 'id' | 'username' | 'role'>, impersonatorId?: number) {
    return this.jwt.signAsync({
      sub: user.id,
      username: user.username,
      role: user.role,
      ...(impersonatorId ? { impersonatorId } : {}),
    });
  }

  async login(username: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('账号或密码错误');
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('账号或密码错误');
    }
    const token = await this.signFor(user);
    return {
      token,
      user: this.userDto(user),
    };
  }

  async impersonate(current: AuthUser, targetUserId: number) {
    if (current.role !== UserRole.ADMIN) {
      throw new ForbiddenException('仅管理员可执行此操作');
    }
    if (current.impersonatorId) {
      throw new BadRequestException('请先退出当前代理登录，再切换到其他用户');
    }
    if (targetUserId === current.id) {
      throw new BadRequestException('无需登录自己的账户');
    }
    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId, deletedAt: null, status: 'active' },
    });
    if (!target) {
      throw new BadRequestException('目标用户不存在或已停用');
    }
    await this.prisma.impersonationLog.create({
      data: { actorId: current.id, targetUserId: target.id, action: 'start' },
    });
    const token = await this.signFor(target, current.id);
    return { token, user: this.userDto(target, current) };
  }

  async stopImpersonating(current: AuthUser) {
    if (!current.impersonatorId) {
      throw new BadRequestException('当前不处于代理登录状态');
    }
    const admin = await this.prisma.user.findFirst({
      where: {
        id: current.impersonatorId,
        role: UserRole.ADMIN,
        deletedAt: null,
        status: 'active',
      },
    });
    if (!admin) {
      throw new UnauthorizedException('原管理员账户不可用，请重新登录');
    }
    await this.prisma.impersonationLog.create({
      data: { actorId: admin.id, targetUserId: current.id, action: 'stop' },
    });
    const token = await this.signFor(admin);
    return { token, user: this.userDto(admin) };
  }

  async listImpersonationLogs() {
    const logs = await this.prisma.impersonationLog.findMany({
      orderBy: { id: 'desc' },
      take: 200,
    });
    const userIds = [
      ...new Set(logs.flatMap((l) => [l.actorId, l.targetUserId])),
    ];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, username: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));
    return logs.map((l) => ({
      id: l.id,
      action: l.action,
      actorId: l.actorId,
      actorName: userMap.get(l.actorId)?.name ?? '—',
      actorUsername: userMap.get(l.actorId)?.username ?? '',
      targetUserId: l.targetUserId,
      targetName: userMap.get(l.targetUserId)?.name ?? '—',
      targetUsername: userMap.get(l.targetUserId)?.username ?? '',
      createdAt: l.createdAt,
    }));
  }
}
