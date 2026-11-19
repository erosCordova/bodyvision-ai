import { z } from "zod";
import { secureRequest } from "./privateRequest";

const auditEventSchema = z.object({
  id: z.string().uuid(),
  actor_id: z.string().uuid().nullable(),
  action: z.string(),
  resource_type: z.string(),
  resource_id: z.string().uuid().nullable(),
  outcome: z.enum(["allowed", "denied", "error"]),
  happened_at: z.string(),
  actor_label: z.string().nullable().optional(),
  target_label: z.string().nullable().optional(),
});

const createdUserSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  display_name: z.string(),
  email: z.string(),
  role: z.enum(["specialist", "member"]),
  status: z.literal("active"),
});

const permissionChangeSchema = z.object({
  profile_id: z.string().uuid(),
  user_id: z.string().uuid(),
  status: z.enum(["granted", "revoked"]),
});
export type PermissionGrant = {
  profile_id: string;
  user_id: string;
  access_level: "read" | "write" | "manage";
};
export type PermissionRevoke = Pick<PermissionGrant, "profile_id" | "user_id">;
export type PermissionChange = z.infer<typeof permissionChangeSchema>;

export type AuditEvent = z.infer<typeof auditEventSchema>;
export type NewTestAccount = {
  display_name: string;
  email: string;
  password: string;
  role: "specialist" | "member";
};
export type CreatedTestAccount = z.infer<typeof createdUserSchema>;

const managedUserSchema = z.object({
  id: z.string().uuid(), display_name: z.string(), email: z.string(),
  role: z.enum(["administrator", "specialist", "member", "unassigned"]),
  status: z.enum(["active", "disabled", "locked"]), manageable: z.boolean(),
});
export type ManagedUser = z.infer<typeof managedUserSchema>;
const directorySchema = z.object({
  items: z.array(managedUserSchema), total: z.number(), limit: z.number(), offset: z.number(),
});
const catalogSchema = z.object({ items: z.array(z.object({
  id: z.string().uuid(), display_code: z.string(),
  status: z.enum(["active", "restricted", "archived"]),
  access_level: z.enum(["read", "write", "manage"]).nullable(),
  expires_at: z.string().nullable(), effective: z.boolean(),
})) });
export type PermissionChoice = z.infer<typeof catalogSchema>["items"][number];
const accountStatusSchema = z.object({
  user_id: z.string().uuid(), status: z.enum(["active", "disabled"]),
  changed: z.boolean(), revoked_sessions: z.number().int().nonnegative(),
});

const passwordResetSchema = z.object({
  user_id: z.string().uuid(),
  status: z.literal("reset"),
  revoked_sessions: z.number().int().nonnegative(),
});
export type PasswordResetInput = {
  administrator_password: string;
  new_password: string;
};


export function privateAdminApi(token: string) {
  return {
    users: async (search = "", offset = 0) => directorySchema.parse(await secureRequest(
      token, `/users?search=${encodeURIComponent(search)}&limit=50&offset=${offset}`,
    )),
    permissionCatalog: async (userId: string, search = "") => catalogSchema.parse(await secureRequest(
      token, `/users/${userId}/permission-catalog?search=${encodeURIComponent(search)}`,
    )),
    changeAccountStatus: async (userId: string, status: "active" | "disabled", administratorPassword: string) =>
      accountStatusSchema.parse(await secureRequest(token, `/users/${userId}/status`, {
        method: "POST", body: JSON.stringify({ status, administrator_password: administratorPassword }),
      })),
    resetPassword: async (userId: string, input: PasswordResetInput) =>
      passwordResetSchema.parse(await secureRequest(token, `/users/${userId}/reset-password`, {
        method: "POST", body: JSON.stringify(input),
      })),
    createUser: async (account: NewTestAccount): Promise<CreatedTestAccount> => {
      const body = createdUserSchema.parse(
        await secureRequest(token, "/users", {
          method: "POST",
          body: JSON.stringify(account),
        }),
      );
      return body;
    },
    audit: async (): Promise<AuditEvent[]> =>
      z.array(auditEventSchema).parse(await secureRequest(token, "/audit?limit=30")),
    grantAccess: async (grant: PermissionGrant): Promise<PermissionChange> =>
      permissionChangeSchema.parse(
        await secureRequest(token, "/profile-access/grant", {
          method: "POST", body: JSON.stringify(grant),
        }),
      ),
    revokeAccess: async (data: PermissionRevoke): Promise<PermissionChange> =>
      permissionChangeSchema.parse(
        await secureRequest(token, "/profile-access/revoke", {
          method: "POST", body: JSON.stringify(data),
        }),
      ),
  };
}
