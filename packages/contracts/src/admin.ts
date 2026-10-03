// Exports Regado administration response types
import type { components } from './openapi.js';

type Schemas = components['schemas'];

export type AdminSummary = Schemas['RegadoSummary'];
export type AdminUser = Schemas['RegadoUser'];
export type AdminAuditEntry = Schemas['RegadoAuditEntry'];
export type AdminAccessCase = Schemas['RegadoCase'];
export type AdminContent = Schemas['RegadoContent'];
export type AdminContentPage = Schemas['RegadoContentPage'];
export type AdminDisk = Schemas['RegadoDisk'];
export type AdminSystem = Schemas['RegadoSystem'];
export type AdminMetrics = Schemas['RegadoMetrics'];
export type AdminLogs = Schemas['RegadoLogs'];
