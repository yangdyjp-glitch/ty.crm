import { Body, Controller, Get, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ImpersonateDto } from './dto/impersonate.dto';
import { Public } from './public.decorator';
import { CurrentUser, AuthUser } from './current-user.decorator';
import { Roles } from './roles.decorator';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.username, dto.password);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  @Post('impersonate')
  @Roles(UserRole.ADMIN)
  impersonate(@CurrentUser() user: AuthUser, @Body() dto: ImpersonateDto) {
    return this.auth.impersonate(user, dto.userId);
  }

  @Post('stop-impersonating')
  stopImpersonating(@CurrentUser() user: AuthUser) {
    return this.auth.stopImpersonating(user);
  }

  @Get('impersonation-logs')
  @Roles(UserRole.ADMIN)
  impersonationLogs() {
    return this.auth.listImpersonationLogs();
  }
}
