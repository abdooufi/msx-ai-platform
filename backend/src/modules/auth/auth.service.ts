import {
  Injectable, UnauthorizedException, ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AppPgService } from '../database/app-pg.service';
import { UserRole } from '../../schemas/user.schema';

export { UserRole };

@Injectable()
export class AuthService {
  constructor(
    private pg: AppPgService,
    private jwt: JwtService,
  ) {}

  // ─── Auth ─────────────────────────────────────────────────────────────────

  async login(email: string, password: string) {
    const user = await this.pg.findUserByEmail(email, true);

    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.pg.updateUserLastLogin(user._id);

    const payload = { sub: user._id, email: user.email, role: user.role };
    const token   = this.jwt.sign(payload);

    return {
      accessToken: token,
      user: { id: user._id, email: user.email, name: user.name, role: user.role },
    };
  }

  async validateToken(payload: any): Promise<any | null> {
    return this.pg.findUserById(payload.sub);
  }

  // ─── User management ─────────────────────────────────────────────────────

  async createUser(data: {
    email: string; password: string; name: string; role: UserRole;
  }) {
    const exists = await this.pg.findUserByEmail(data.email);
    if (exists) throw new ConflictException('Email already exists');
    return this.pg.createUser({
      email:    data.email,
      password: data.password,
      name:     data.name,
      role:     data.role,
    });
  }

  async updateUser(id: string, data: {
    name?: string; role?: UserRole; isActive?: boolean;
  }) {
    const before = await this.pg.findUserById(id);
    if (!before) throw new NotFoundException('User not found');

    const updated = await this.pg.updateUser(id, {
      name:     data.name,
      role:     data.role,
      isActive: data.isActive,
    });

    const after = { name: updated?.name, role: updated?.role, isActive: updated?.isActive };
    const beforeSnapshot = { name: before.name, role: before.role, isActive: before.isActive };

    return { user: updated, before: beforeSnapshot, after };
  }

  async changePassword(id: string, newPassword: string) {
    const user = await this.pg.findUserById(id);
    if (!user) throw new NotFoundException('User not found');
    return this.pg.changeUserPassword(id, newPassword);
  }

  async deleteUser(id: string) {
    const deleted = await this.pg.deleteUser(id);
    if (!deleted) throw new NotFoundException('User not found');
    return { ok: true, deleted };
  }

  async listUsers(page = 1, limit = 20) {
    return this.pg.listUsers(page, limit);
  }

  async getUser(id: string) {
    const user = await this.pg.findUserById(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
