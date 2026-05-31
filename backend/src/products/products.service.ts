import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  list(includeInactive = false) {
    return this.prisma.product.findMany({
      where: {
        deletedAt: null,
        ...(includeInactive ? {} : { status: 'active' }),
      },
      orderBy: { id: 'asc' },
    });
  }

  async get(id: number) {
    const p = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
    });
    if (!p) throw new NotFoundException('项目不存在');
    return p;
  }

  create(dto: CreateProductDto) {
    return this.prisma.product.create({ data: dto });
  }

  update(id: number, dto: UpdateProductDto) {
    return this.prisma.product.update({ where: { id }, data: dto });
  }

  remove(id: number) {
    return this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'inactive' },
    });
  }
}
