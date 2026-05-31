import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { AttachmentsService } from './attachments.service';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';

@Controller('attachments')
export class AttachmentsController {
  constructor(private att: AttachmentsService) {}

  @Get()
  list(@Query('relatedType') t: string, @Query('relatedId') id: string) {
    return this.att.list(t, id);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: { originalname?: string; buffer: Buffer; mimetype?: string },
    @Body() dto: { relatedType: string; relatedId: string },
  ) {
    return this.att.save(user, file, dto);
  }

  @Get(':id/file')
  async download(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const { abs, name } = await this.att.filePath(id);
    res.download(abs, name);
  }
}
