import { Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';
import { AppPgService } from '../database/app-pg.service';
import { AuditAction } from '../../schemas/audit-log.schema';

export { AuditAction };

export interface AuditContext {
  userId?:    string;
  userEmail:  string;
  userRole:   string;
  ip?:        string;
  userAgent?: string;
}

export interface LogOptions {
  action:      AuditAction;
  resource:    string;
  resourceId?: string;
  details:     string;
  changes?:    { before?: any; after?: any };
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private pg: AppPgService) {}

  /** Extract AuditContext from an Express request with attached JWT user */
  static ctx(req: Request): AuditContext {
    const user = (req as any).user;
    return {
      userId:    user?._id?.toString() ?? user?.id ?? undefined,
      userEmail: user?.email ?? 'system',
      userRole:  user?.role  ?? 'unknown',
      ip:        (req.headers['x-forwarded-for'] as string ?? req.socket?.remoteAddress ?? '').split(',')[0].trim(),
      userAgent: (req.headers['user-agent'] ?? '').slice(0, 200),
    };
  }

  /** Write an audit log entry — never throws (audit must not break the main flow) */
  async log(ctx: AuditContext, opts: LogOptions): Promise<void> {
    try {
      await this.pg.createAuditLog({
        userId:     ctx.userId,
        userEmail:  ctx.userEmail,
        userRole:   ctx.userRole,
        action:     opts.action,
        resource:   opts.resource,
        resourceId: opts.resourceId ?? undefined,
        details:    opts.details,
        changes:    opts.changes   ?? undefined,
        ip:         ctx.ip         ?? '',
        userAgent:  ctx.userAgent  ?? '',
      });
    } catch (err) {
      this.logger.error(`Audit write failed: ${err.message}`);
    }
  }

  /** List audit logs with optional filters — paginated */
  async list(opts: {
    page?:     number;
    limit?:    number;
    action?:   string;
    resource?: string;
    email?:    string;
    from?:     string;
    to?:       string;
  } = {}) {
    return this.pg.listAuditLogs(opts);
  }

  /** Summary stats for dashboard */
  async stats() {
    return this.pg.auditStats();
  }
}
