import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { UserRole } from '@prisma/client';
import { CustomersService, CustomerListQuery } from './customers.service';
import {
  AssignDownstreamDto,
  AssignDto,
  CreateCustomerDto,
  FollowUpDto,
  SetProblemDto,
  SetSalesStageDto,
  SetStatusDto,
  UpdateCustomerDto,
} from './dto/customer.dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';

@Controller('customers')
export class CustomersController {
  constructor(private customers: CustomersService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: CustomerListQuery) {
    return this.customers.list(user, q);
  }

  @Get('check-duplicate')
  @Roles(UserRole.MARKET, UserRole.ADMIN)
  checkDuplicate(
    @Query('phone') phone?: string,
    @Query('wechat') wechat?: string,
    @Query('email') email?: string,
  ) {
    return this.customers.findDuplicates(phone, wechat, email);
  }

  @Get('export')
  async export(@CurrentUser() user: AuthUser, @Res() res: Response) {
    const buf = await this.customers.exportExcel(user);
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="customers.xlsx"',
    });
    res.send(buf);
  }

  @Post('import')
  @Roles(UserRole.MARKET, UserRole.ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  importExcel(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: { buffer: Buffer },
  ) {
    return this.customers.importExcel(user, file.buffer);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.customers.get(user, id);
  }

  @Post()
  @Roles(UserRole.MARKET, UserRole.ADMIN)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCustomerDto) {
    return this.customers.create(user, dto);
  }

  @Patch(':id')
  @Roles(UserRole.SALES, UserRole.ADMIN)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customers.update(user, id, dto);
  }

  @Post(':id/assign')
  @Roles(UserRole.MARKET, UserRole.ADMIN)
  assign(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignDto,
  ) {
    return this.customers.assign(user, id, dto);
  }

  @Post(':id/assign-downstream')
  @Roles(UserRole.ADMIN)
  assignDownstream(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignDownstreamDto,
  ) {
    return this.customers.assignDownstream(id, dto.downstreamSalesUserId);
  }

  @Post(':id/follow-ups')
  @Roles(UserRole.SALES, UserRole.ADMIN)
  addFollowUp(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: FollowUpDto,
  ) {
    return this.customers.addFollowUp(user, id, dto);
  }

  @Post(':id/problem')
  @Roles(UserRole.SALES, UserRole.ADMIN)
  setProblem(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetProblemDto,
  ) {
    return this.customers.setProblem(user, id, dto);
  }

  @Post(':id/status')
  @Roles(UserRole.SALES, UserRole.ADMIN)
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetStatusDto,
  ) {
    return this.customers.setStatus(user, id, dto);
  }

  @Post(':id/sales-stage')
  @Roles(UserRole.SALES, UserRole.ADMIN)
  setSalesStage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetSalesStageDto,
  ) {
    return this.customers.setSalesStage(user, id, dto.salesStage);
  }

  @Post(':id/score')
  @Roles(UserRole.SALES, UserRole.ADMIN)
  computeScore(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.customers.computeScore(user, id);
  }

  @Get(':id/ai-summary')
  aiSummary(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.customers.aiSummary(user, id);
  }
}
