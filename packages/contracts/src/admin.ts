// Exports Regado administration response types
import type { components, paths } from './openapi.js';

type Schemas = components['schemas'];

export type AdminSummary = Schemas['RegadoSummary'];
export type AdminUser = Schemas['RegadoUser'];
export type AdminAuditEntry = Schemas['RegadoAuditEntry'];
export type AdminDisk = Schemas['RegadoDisk'];
export type AdminSwapDevice = Schemas['RegadoSwapDevice'];
export type AdminMount = Schemas['RegadoMount'];
export type AdminReplicationReport = Schemas['RegadoReplicationReport'];
export type AdminMediaMaintenance = Schemas['RegadoMediaMaintenance'];
export type AdminSystem = Schemas['RegadoSystem'];
export type AdminMetrics = Schemas['RegadoMetrics'];
export type AdminLogs = Schemas['RegadoLogs'];
export type AdminJournal = Schemas['RegadoJournal'];
export type AdminService = Schemas['RegadoService'];
export type AdminLogRetentionDays =
	paths['/v1/admin/logs/retention']['patch']['requestBody']['content']['application/json']['retentionDays'];

export type AdminOperationProgress = Schemas['RegadoOperationProgress'];
export type AdminLayoutRequest = Schemas['RegadoLayoutRequest'];
export type AdminStoragePlan = Schemas['RegadoStoragePlan'];
export type AdminLayoutReport = Schemas['RegadoLayoutReport'];
