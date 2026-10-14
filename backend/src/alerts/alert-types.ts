export type AlertType =
    | 'API_DOWN'
    | 'UNHEALTHY_DURATION'
    | 'ERROR_RATE'
    | 'LATENCY';

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
