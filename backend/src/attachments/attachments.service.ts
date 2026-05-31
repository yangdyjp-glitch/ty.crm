import { Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/current-user.decorator';
import { genNo } from '../common/util';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

interface UploadedFileLike {
  originalname?: string;
  buffer: Buffer;
  mimetype?: string;
}

@Injectable()
export class AttachmentsService {
  constructor(private prisma: PrismaService) {
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }

  async save(
    user: AuthUser,
    file: UploadedFileLike,
    dto: { relatedType: string; relatedId: string | number },
  ) {
    const ext = path.extname(file.originalname || '');
    const stored = genNo('F') + ext;
    fs.writeFileSync(path.join(UPLOAD_DIR, stored), file.buffer);
    return this.prisma.attachment.create({
      data: {
        relatedType: dto.relatedType,
        relatedId: Number(dto.relatedId),
        fileName: file.originalname || stored,
        fileUrl: stored,
        fileType: file.mimetype,
        uploadedById: user.id,
      },
    });
  }

  list(relatedType: string, relatedId: string) {
    return this.prisma.attachment.findMany({
      where: { relatedType, relatedId: Number(relatedId) },
      orderBy: { id: 'desc' },
    });
  }

  async filePath(id: number) {
    const a = await this.prisma.attachment.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('附件不存在');
    return { abs: path.join(UPLOAD_DIR, a.fileUrl), name: a.fileName };
  }
}
