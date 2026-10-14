export type AlertType =
    | 'API_DOWN'
    | 'UNHEALTHY_DURATION'
    | 'ERROR_RATE'
    | 'LATENCY';

export type AlertRuntimeState = 'INACTIVE' | 'TRIGGERED';

export type AlertConfiguration =
    | Record<string, never>
    | { durationSeconds: number }
    | { threshold: number; windowSeconds: number }
    | { thresholdMs: number; windowSeconds: number };

export interface Alert {
    id: string;
    apiId: string;
    name: string;
    type: AlertType;
    configuration: AlertConfiguration;
    enabled: boolean;
    runtimeState: AlertRuntimeState;
    triggeredAt: string | null;
    recoveredAt: string | null;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
}

export interface CreateAlertInput {
    name: string;
    type: AlertType;
    configuration: AlertConfiguration;
}

export interface UpdateAlertInput {
    name?: string;
    type?: AlertType;
    configuration?: AlertConfiguration;
}

export interface AlertEvent {
    id: string;
    alertId: string;
    eventType: string;
    message: string | null;
    metadata: Record<string, unknown> | null;
    occurredAt: string;
}

export interface AlertEventPage {
    data: AlertEvent[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}
