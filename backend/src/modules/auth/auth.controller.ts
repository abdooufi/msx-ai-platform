import {
  Controller, Post, Get, Put, Patch, Delete,
  Body, Param, Query, UseGuards, Request, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, IsEnum, IsOptional, IsBoolean } from 'class-validator';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/guards/roles.decorator';
import { UserRole } from '../../schemas/user.schema';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../../schemas/audit-log.schema';

class LoginDto {
  @IsEmail()   email:    string;
  @IsString()  @MinLength(6) password: string;
}

class CreateUserDto {
  @IsEmail()   email:    string;
  @IsString()  @MinLength(8) password: string;
  @IsString()  name:     string;
  @IsEnum(UserRole) role: UserRole;
}

class UpdateUserDto {
  @IsString()  @IsOptional() name?:     string;
  @IsEnum(UserRole) @IsOptional() role?: UserRole;
  @IsBoolean() @IsOptional() isActive?: boolean;
}

class ChangePasswordDto {
  @IsString() @MinLength(8) password: string;
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth:  AuthService,
    private readonly audit: AuditService,
  ) {}

  // ─── Public ───────────────────────────────────────────────────────────────

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login and receive JWT' })
  async login(@Body() dto: LoginDto, @Request() req) {
    try {
      const result = await this.auth.login(dto.email, dto.password);
      await this.audit.log(
        { userEmail: dto.email, userRole: result.user.role, ip: AuditService.ctx(req).ip },
        { action: AuditAction.LOGIN, resource: 'auth', details: `Successful login: ${dto.email}` },
      );
      return result;
    } catch (err) {
      await this.audit.log(
        { userEmail: dto.email, userRole: 'unknown', ip: AuditService.ctx(req).ip },
        { action: AuditAction.LOGIN_FAILED, resource: 'auth', details: `Failed login attempt: ${dto.email}` },
      ).catch(() => {});
      throw err;
    }
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  getMe(@Request() req) {
    const { password, ...user } = req.user;
    return user;
  }

  // ─── User management (super_admin only) ──────────────────────────────────

  @Post('users')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  @ApiOperation({ summary: 'Create a new user (super_admin only)' })
  async createUser(@Body() dto: CreateUserDto, @Request() req) {
    const user = await this.auth.createUser(dto);
    await this.audit.log(AuditService.ctx(req), {
      action:     AuditAction.USER_CREATE,
      resource:   'user',
      resourceId: (user as any)._id?.toString(),
      details:    `Created user ${dto.email} with role ${dto.role}`,
      changes:    { after: { email: dto.email, role: dto.role, name: dto.name } },
    });
    return user;
  }

  @Get('users')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin', 'admin')
  @ApiOperation({ summary: 'List all users' })
  listUsers(@Query('page') page = '1', @Query('limit') limit = '20') {
    return this.auth.listUsers(parseInt(page), parseInt(limit));
  }

  @Get('users/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin', 'admin')
  getUser(@Param('id') id: string) {
    return this.auth.getUser(id);
  }

  @Put('users/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  @ApiOperation({ summary: 'Update user name / role / isActive (super_admin only)' })
  async updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto, @Request() req) {
    const result = await this.auth.updateUser(id, dto);
    await this.audit.log(AuditService.ctx(req), {
      action:     AuditAction.USER_UPDATE,
      resource:   'user',
      resourceId: id,
      details:    `Updated user ${(result.user as any)?.email ?? id}`,
      changes:    { before: result.before, after: result.after },
    });
    return result.user;
  }

  @Patch('users/:id/password')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  @ApiOperation({ summary: 'Reset user password (super_admin only)' })
  async changePassword(@Param('id') id: string, @Body() dto: ChangePasswordDto, @Request() req) {
    const result = await this.auth.changePassword(id, dto.password);
    await this.audit.log(AuditService.ctx(req), {
      action:     AuditAction.PASSWORD_CHANGE,
      resource:   'user',
      resourceId: id,
      details:    `Password reset for user ${id}`,
    });
    return result;
  }

  @Delete('users/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  @ApiOperation({ summary: 'Delete a user (super_admin only)' })
  async deleteUser(@Param('id') id: string, @Request() req) {
    const result = await this.auth.deleteUser(id);
    await this.audit.log(AuditService.ctx(req), {
      action:     AuditAction.USER_DELETE,
      resource:   'user',
      resourceId: id,
      details:    `Deleted user ${(result.deleted as any)?.email ?? id}`,
      changes:    { before: result.deleted },
    });
    return { ok: true };
  }
}
