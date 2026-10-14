import database from '../config/database.js';

import type {
    AlertEvent,
    AlertEventPage,
    Alert,
    AlertConfiguration,
    AlertRuntimeState,
    AlertType,
    CreateAlertInput,
    UpdateAlertInput,
} from './alert-types.js';
import type { Knex } from 'knex';

interface AlertRow {
    id: string;
    api_id: string;
    name: string;
    type: string;
    status: 'ACTIVE' | 'RESOLVED' | 'DISABLED' | 'DELETED';
    runtime_state: AlertRuntimeState;
    triggered_at: Date | null;
    recovered_at: Date | null;
    configuration: AlertConfiguration;
    enabled: boolean;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
}

function normalizeType(type: string): AlertType {
    if (type === 'DOWN') {
        return 'API_DOWN';
    }
    if (
        type === 'API_DOWN' ||
        type === 'UNHEALTHY_DURATION' ||
        type === 'ERROR_RATE' ||
        type === 'LATENCY'
    ) {
        return type;
    }
    throw new Error(`Unsupported alert type stored in database: ${type}.`);
}

function mapAlert(row: AlertRow): Alert {
    return {
        id: row.id,
        apiId: row.api_id,
        name: row.name,
        type: normalizeType(row.type),
        configuration: row.configuration,
        enabled: row.enabled,
        runtimeState: row.runtime_state,
        triggeredAt: row.triggered_at?.toISOString() ?? null,
        recoveredAt: row.recovered_at?.toISOString() ?? null,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        deletedAt: row.deleted_at?.toISOString() ?? null,
    };
}

const VISIBLE_API_STATUSES = ['REGISTERED', 'ACTIVE', 'DISABLED'];

function ownedApiQuery(userId: string, apiId: string) {
    return database('apis')
        .join('projects', 'projects.id', 'apis.project_id')
        .where({
            'apis.id': apiId,
            'projects.user_id': userId,
        })
        .whereIn('apis.status', VISIBLE_API_STATUSES)
        .whereNull('apis.deleted_at')
        .whereNull('projects.deleted_at');
}

function ownedAlertQuery(
    userId: string,
    alertId: string,
    connection: Knex | Knex.Transaction = database,
) {
    return connection<AlertRow>('alerts')
        .join('apis', 'apis.id', 'alerts.api_id')
        .join('projects', 'projects.id', 'apis.project_id')
        .where('alerts.id', alertId)
        .andWhere('projects.user_id', userId)
        .whereIn('apis.status', VISIBLE_API_STATUSES)
        .whereNull('alerts.deleted_at')
        .whereNull('apis.deleted_at')
        .whereNull('projects.deleted_at');
}

function ownedAlertMutationQuery(
    userId: string,
    alertId: string,
    connection: Knex | Knex.Transaction = database,
) {
    return connection<AlertRow>('alerts')
        .where('alerts.id', alertId)
        .whereNull('alerts.deleted_at')
        .whereExists((query) => {
            query
                .select(database.raw('1'))
                .from('apis')
                .join('projects', 'projects.id', 'apis.project_id')
                .whereRaw('apis.id = alerts.api_id')
                .andWhere('projects.user_id', userId)
                .whereIn('apis.status', VISIBLE_API_STATUSES)
                .whereNull('apis.deleted_at')
                .whereNull('projects.deleted_at');
        });
}

const ALERT_RETURNING_COLUMNS = [
    'id',
    'api_id',
    'name',
    'type',
    'status',
    'configuration',
    'enabled',
    'runtime_state',
    'triggered_at',
    'recovered_at',
    'created_at',
    'updated_at',
    'deleted_at',
] as const;

export async function findOwnedApiAlerts(
    userId: string,
    apiId: string,
): Promise<Alert[] | null> {
    const api = await ownedApiQuery(userId, apiId)
        .select('apis.id')
        .first();
    if (!api) {
        return null;
    }
    const rows = await database<AlertRow>('alerts')
        .where({ api_id: apiId })
        .whereNull('deleted_at')
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc');
    return rows.map(mapAlert);
}

export async function findOwnedAlert(
    userId: string,
    alertId: string,
    connection: Knex | Knex.Transaction = database,
): Promise<Alert | null> {
    const row = await ownedAlertQuery(userId, alertId, connection)
        .select('alerts.*')
        .first();
    return row ? mapAlert(row) : null;
}

export async function findOwnedAlertForUpdate(
    userId: string,
    alertId: string,
    transaction: Knex.Transaction,
): Promise<Alert | null> {
    const row = await ownedAlertQuery(userId, alertId, transaction)
        .select('alerts.*')
        .forUpdate('alerts')
        .first();
    return row ? mapAlert(row) : null;
}

export async function transitionAlertState(
    transaction: Knex.Transaction,
    alert: Alert,
    active: boolean,
    now: Date,
): Promise<{ alert: Alert; transitioned: boolean }> {
    if (!alert.enabled) {
        return { alert, transitioned: false };
    }

    const nextState: AlertRuntimeState = active ? 'TRIGGERED' : 'INACTIVE';
    if (nextState === alert.runtimeState) {
        return { alert, transitioned: false };
    }

    const transitionType = nextState === 'TRIGGERED'
        ? 'TRIGGERED'
        : 'RECOVERED';
    const update = nextState === 'TRIGGERED'
        ? {
            runtime_state: nextState,
            triggered_at: now,
            recovered_at: null,
            updated_at: now,
        }
        : {
            runtime_state: nextState,
            recovered_at: now,
            updated_at: now,
        };
    const [row] = await transaction<AlertRow>('alerts')
        .where({ id: alert.id })
        .whereNull('deleted_at')
        .update(update)
        .returning('*');

    if (!row) {
        throw new Error('Alert state could not be updated.');
    }

    await transaction('alert_events').insert({
        alert_id: alert.id,
        event_type: transitionType,
        message: transitionType === 'TRIGGERED'
            ? 'Alert condition became active.'
            : 'Alert condition recovered.',
        metadata: { type: alert.type },
        occurred_at: now,
        triggered_at: transitionType === 'TRIGGERED' ? now : null,
        resolved_at: transitionType === 'RECOVERED' ? now : null,
    });

    return { alert: mapAlert(row), transitioned: true };
}

interface AlertEventRow {
    id: string;
    alert_id: string;
    event_type: string;
    message: string | null;
    metadata: Record<string, unknown> | null;
    occurred_at: Date;
}

function mapAlertEvent(row: AlertEventRow): AlertEvent {
    return {
        id: row.id,
        alertId: row.alert_id,
        eventType: row.event_type,
        message: row.message,
        metadata: row.metadata,
        occurredAt: row.occurred_at.toISOString(),
    };
}

function ownedAlertEventQuery(userId: string, alertId: string) {
    return database<AlertEventRow>('alert_events')
        .where('alert_events.alert_id', alertId)
        .whereExists((query) => {
            query
                .select(database.raw('1'))
                .from('alerts')
                .join('apis', 'apis.id', 'alerts.api_id')
                .join('projects', 'projects.id', 'apis.project_id')
                .whereRaw('alerts.id = alert_events.alert_id')
                .andWhere('projects.user_id', userId)
                .whereIn('apis.status', VISIBLE_API_STATUSES)
                .whereNull('alerts.deleted_at')
                .whereNull('apis.deleted_at')
                .whereNull('projects.deleted_at');
        });
}

export async function findOwnedAlertEvents(
    userId: string,
    alertId: string,
    page: number,
    limit: number,
): Promise<AlertEventPage | null> {
    const owned = await ownedAlertQuery(userId, alertId)
        .select('alerts.id')
        .first();
    if (!owned) {
        return null;
    }

    const [{ count }] = await ownedAlertEventQuery(userId, alertId)
        .count<{ count: string }>({ count: 'id' });
    const total = Number(count);
    const rows = await ownedAlertEventQuery(userId, alertId)
        .orderBy('occurred_at', 'desc')
        .orderBy('id', 'desc')
        .limit(limit)
        .offset((page - 1) * limit);

    return {
        data: rows.map(mapAlertEvent),
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
}

export async function createOwnedAlert(
    userId: string,
    apiId: string,
    input: CreateAlertInput,
): Promise<Alert | null> {
    const api = await ownedApiQuery(userId, apiId)
        .select('apis.id')
        .first();
    if (!api) {
        return null;
    }

    const [row] = await database<AlertRow>('alerts')
        .insert({
            api_id: apiId,
            name: input.name,
            type: input.type,
            configuration: input.configuration,
        })
        .returning('*');
    return mapAlert(row);
}

export async function updateOwnedAlert(
    userId: string,
    alertId: string,
    input: UpdateAlertInput,
): Promise<Alert | null> {
    const [row] = await ownedAlertMutationQuery(userId, alertId)
        .update({
            ...(input.name !== undefined && { name: input.name }),
            ...(input.type !== undefined && { type: input.type }),
            ...(input.configuration !== undefined && {
                configuration: input.configuration,
            }),
            updated_at: database.fn.now(),
        })
        .returning<AlertRow[]>(ALERT_RETURNING_COLUMNS);
    return row ? mapAlert(row) : null;
}

export async function setOwnedAlertEnabled(
    userId: string,
    alertId: string,
    enabled: boolean,
): Promise<Alert | null> {
    const [row] = await ownedAlertMutationQuery(userId, alertId)
        .update({
            enabled,
            status: enabled ? 'ACTIVE' : 'DISABLED',
            updated_at: database.fn.now(),
        })
        .returning<AlertRow[]>(ALERT_RETURNING_COLUMNS);
    return row ? mapAlert(row) : null;
}

export async function softDeleteOwnedAlert(
    userId: string,
    alertId: string,
): Promise<boolean> {
    const updatedRows = await ownedAlertMutationQuery(userId, alertId)
        .update({
            enabled: false,
            status: 'DELETED',
            deleted_at: database.fn.now(),
            updated_at: database.fn.now(),
        })
        .returning('id');
    return updatedRows.length > 0;
}
