import type { Response } from 'express';
import type { Knex } from 'knex';

import database from '../config/database.js';

export type AuditActorRole = 'USER' | 'ADMIN' | null;

export interface AuditLogInput {
    actorUserId: string | null;
    actorRole: AuditActorRole;
    action: string;
    resourceType: string;
    resourceId?: string | null;
    metadata?: Record<string, string | number | boolean | null>;
    ipAddress?: string | null;
}

export class AuditLogWriteError extends Error {
    constructor() {
        super('Audit logging is temporarily unavailable.');
        this.name = 'AuditLogWriteError';
    }
}

const SENSITIVE_METADATA_KEY =
    /password|secret|token|credential|authorization|api.?key|body|actor|resource|user.?id|role|session/i;

export function sanitizeAuditMetadata(
    metadata: Record<string, unknown> | null | undefined,
): Record<string, string | number | boolean | null> | null {
    if (!metadata) {
        return null;
    }

    const safeMetadata: Record<
        string,
        string | number | boolean | null
    > = {};
    for (const [key, value] of Object.entries(metadata)) {
        if (
            SENSITIVE_METADATA_KEY.test(key) ||
            !(
                typeof value === 'string' ||
                typeof value === 'number' ||
                typeof value === 'boolean' ||
                value === null
            )
        ) {
            continue;
        }
        safeMetadata[key] = value;
    }

    return Object.keys(safeMetadata).length === 0
        ? null
        : safeMetadata;
}

export async function writeAuditLog(
    input: AuditLogInput,
    transaction?: Knex.Transaction,
): Promise<void> {
    try {
        await (transaction ?? database)('audit_logs').insert({
            user_id: input.actorUserId,
            actor_role: input.actorRole,
            action: input.action,
            resource_type: input.resourceType,
            resource_id: input.resourceId ?? null,
            details: sanitizeAuditMetadata(input.metadata),
            ip_address: input.ipAddress ?? null,
        });
    } catch {
        console.error('Audit-log persistence failed.');
        throw new AuditLogWriteError();
    }
}

export function sendAuditLogFailure(
    error: unknown,
    response: Response,
): boolean {
    if (!(error instanceof AuditLogWriteError)) {
        return false;
    }

    response.status(503).json({
        error: {
            code: 'AUDIT_LOG_UNAVAILABLE',
            message: 'Audit logging is temporarily unavailable.',
        },
    });
    return true;
}

export function getAuditActorRole(isAdmin: boolean): AuditActorRole {
    return isAdmin ? 'ADMIN' : 'USER';
}
