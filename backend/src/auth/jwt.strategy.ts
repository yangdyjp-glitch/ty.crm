import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from './current-user.decorator';

export interface JwtPayload {
  sub: number;
  username: string;
  role: UserRole;
  impersonatorId?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET') || 'dev-secret',
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    const [user, impersonator] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: payload.sub } }),
      payload.impersonatorId
        ? this.prisma.user.findUnique({ where: { id: payload.impersonatorId } })
        : Promise.resolve(null),
    ]);
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException();
    }
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      impersonatorId: payload.impersonatorId,
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
}
