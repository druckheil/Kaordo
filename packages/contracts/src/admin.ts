// Exports Regado administration response types
import type { components, paths } from './openapi.js';

type Schemas = components['schemas'];

export type AdminSummary = Schemas['RegadoSummary'];
export type AdminUser = Schemas['RegadoUser'];
export type AdminAuditEntry = Schemas['RegadoAuditEntry'];
export type AdminSwapDevice = Schemas['RegadoSwapDevice'];
export type AdminMediaMaintenance = Schemas['RegadoMediaMaintenance'];
export type AdminSystem = Schemas['RegadoSystem'];
export type AdminMetrics = Schemas['RegadoMetrics'];
export type AdminLogs = Schemas['RegadoLogs'];
export type AdminJournal = Schemas['RegadoJournal'];
export type AdminService = Schemas['RegadoService'];
export type AdminLogRetentionDays =
	paths['/v1/admin/logs/retention']['patch']['requestBody']['content']['application/json']['retentionDays'];

export type HostFacts = Schemas['HostFacts'];
export type HostDevice = Schemas['HostDevice'];
export type HostDeviceHealth = Schemas['HostDeviceHealth'];
export type HostPool = Schemas['HostPool'];
export type HostPoolMember = Schemas['HostPoolMember'];
export type HostState = Schemas['HostState'];
export type HostPoolPlan = Schemas['HostPoolPlan'];
export type HostPoolStep = Schemas['HostPoolStep'];
export type HostOperation = Schemas['HostOperation'];
export type HostOperationRecord = Schemas['HostOperationRecord'];
export type HostOperationStage = Schemas['HostOperationStage'];
export type HostStateChange = Schemas['HostStateChange'];
export type HostCheckRequest = Schemas['HostCheckRequest'];
export type HostStateChangeResult = Schemas['HostStateChangeResult'];
