import { Injectable, UnauthorizedException, ConflictException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { User, UserDocument, UserRole } from '../../schemas/user.schema';

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  /** Seed default admin account on startup */
  async onModuleInit() {
    const email = this.config.get<string>('ADMIN_EMAIL', 'admin@msx.om');
    const password = this.config.get<string>('ADMIN_PASSWORD', 'Admin123!');
    const exists = await this.userModel.findOne({ email });
    if (!exists) {
      const hash = await bcrypt.hash(password, 12);
      await this.userModel.create({
        email,
        password: hash,
        name: 'Administrator',
        role: UserRole.ADMIN,
      });
      console.log(`✅ Admin account created: ${email}`);
    }
  }

  async login(email: string, password: string) {
    const user = await this.userModel
      .findOne({ email: email.toLowerCase(), isActive: true })
      .select('+password')
      .lean();

    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.userModel.updateOne({ _id: user._id }, { lastLoginAt: new Date() });

    const payload = { sub: user._id.toString(), email: user.email, role: user.role };
    const token = this.jwt.sign(payload);

    return {
      accessToken: token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }

  async validateToken(payload: any): Promise<UserDocument | null> {
    return this.userModel.findById(payload.sub).lean() as any;
  }

  async createUser(email: string, password: string, name: string, role: UserRole) {
    const exists = await this.userModel.findOne({ email: email.toLowerCase() });
    if (exists) throw new ConflictException('Email already exists');
    const hash = await bcrypt.hash(password, 12);
    return this.userModel.create({ email: email.toLowerCase(), password: hash, name, role });
  }

  async listUsers(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [users, total] = await Promise.all([
      this.userModel.find().select('-password').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      this.userModel.countDocuments(),
    ]);
    return { users, total, page };
  }
}
