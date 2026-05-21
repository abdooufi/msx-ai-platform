// Enums only — no Mongoose. All persistence is via PostgreSQL (AppPgService).

export enum UserRole {
  SUPER_ADMIN = 'super_admin',
  ADMIN       = 'admin',
  EDITOR      = 'editor',
  VIEWER      = 'viewer',
  AGENT       = 'agent',
}

export const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  [UserRole.SUPER_ADMIN]: ['*'],
  [UserRole.ADMIN]:       ['dashboard','analytics','conversations','documents','training','knowledge','companies','settings','cache','market'],
  [UserRole.EDITOR]:      ['documents','knowledge','companies'],
  [UserRole.VIEWER]:      ['dashboard','analytics','conversations'],
  [UserRole.AGENT]:       ['documents','knowledge','companies'],
};
