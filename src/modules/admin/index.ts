// Public API of the admin module.
export * from "./domain/role-matrix";
export { seedRolesAndPermissions, setRolePermission } from "./services/roles";
export { createUser, setUserActive, verifyCredentials, userInputSchema, type UserInput } from "./services/users";
export { listUsers, getPermissionMatrix, listAuditLog } from "./queries/admin";
