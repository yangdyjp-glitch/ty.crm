import { BadRequestException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';

const safeSelect = {
  id: true,
  username: true,
  name: true,
  phone: true,
  email: true,
  role: true,
  status: true,
  createdAt: true,
};

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  list(role?: UserRole) {
    return this.prisma.user.findMany({
      where: { deletedAt: null, ...(role ? { role } : {}) },
      select: safeSelect,
      orderBy: { id: 'asc' },
    });
  }

  options(role?: UserRole | UserRole[]) {
    const roleWhere = Array.isArray(role) ? { role: { in: role } } : role ? { role } : {};
    return this.prisma.user.findMany({
      where: { deletedAt: null, status: 'active', ...roleWhere },
      select: { id: true, name: true, username: true, role: true },
      orderBy: { id: 'asc' },
    });
  }

  async create(dto: CreateUserDto) {
    const passwordHash = await bcrypt.hash(dto.password, 10);
    return this.prisma.user.create({
      data: {
        username: dto.username,
        name: dto.name,
        phone: dto.phone,
        email: dto.email,
        role: dto.role,
        passwordHash,
      },
      select: safeSelect,
    });
  }

  async update(id: number, dto: UpdateUserDto) {
    const data: Record<string, unknown> = {
      name: dto.name,
      role: dto.role,
      phone: dto.phone,
      email: dto.email,
      status: dto.status,
    };
    if (dto.password) {
      data.passwordHash = await bcrypt.hash(dto.password, 10);
    }
    return this.prisma.user.update({
      where: { id },
      data,
      select: safeSelect,
    });
  }

  async remove(currentUserId: number, id: number) {
    if (id === currentUserId) {
      throw new BadRequestException('不能删除当前登录的自己');
    }
    return this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'disabled' },
      select: safeSelect,
    });
  }
}
