import { Controller, Post, Get, Body, UseGuards, Request, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/guards/roles.decorator';
import { UserRole } from '../../schemas/user.schema';

class LoginDto {
  @IsEmail() email: string;
  @IsString() @MinLength(6) password: string;
}

class CreateUserDto {
  @IsEmail() email: string;
  @IsString() @MinLength(8) password: string;
  @IsString() name: string;
  role: UserRole;
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  getMe(@Request() req) {
    const { password, ...user } = req.user;
    return user;
  }

  @Post('users')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  createUser(@Body() dto: CreateUserDto) {
    return this.auth.createUser(dto.email, dto.password, dto.name, dto.role);
  }

  @Get('users')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  listUsers(@Query('page') page = '1') {
    return this.auth.listUsers(parseInt(page));
  }
}
