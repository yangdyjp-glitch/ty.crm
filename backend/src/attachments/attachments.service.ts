import { Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/current-user.decorator';
import { genNo } from '../common/util';
import { customerScopeWhere } from '../common/scope';

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

  private async requireAccess(user: AuthUser, type: string, id: number) {
    if(type!=='Customer'){
      if(user.role==='ADMIN')return;
      throw new NotFoundException();
    }
    if(!Number.isSafeInteger(id)||id<1||!await this.prisma.customer.findFirst({
      where:{AND:[customerScopeWhere(user),{id,deletedAt:null}]},select:{id:true}
    }))throw new NotFoundException();
  }

  async save(
    user: AuthUser,
    file: UploadedFileLike,
    dto: { relatedType: string; relatedId: string | number },
  ) {
    await this.requireAccess(user,dto.relatedType,Number(dto.relatedId));
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

  async list(user:AuthUser,relatedType: string, relatedId: string) {
    await this.requireAccess(user,relatedType,Number(relatedId));
    return this.prisma.attachment.findMany({
      where: { relatedType, relatedId: Number(relatedId) },
      orderBy: { id: 'desc' },
    });
  }

  async filePath(user:AuthUser,id: number) {
    const a = await this.prisma.attachment.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('附件不存在');
    await this.requireAccess(user,a.relatedType,a.relatedId);
    return { abs: path.join(UPLOAD_DIR, a.fileUrl), name: a.fileName };
  }
}
