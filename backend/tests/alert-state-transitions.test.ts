import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';

import app from '../src/app.js';
import { createApi } from '../src/apis/api-repository.js';
import { createOwnedAlert } from '../src/alerts/alert-repository.js';
import database from '../src/config/database.js';
import { nextTestGithubId } from './test-user-identity.js';

let ownerId: string;
let otherUserId: string;
let apiId: string;
let ownerSession: string;
let otherSession: string;
let server: ReturnType<typeof createServer>;
let baseUrl: string;

async function createUser(prefix: string): Promise<string> {
    const [user] = await database<{ id: string }>('users')
        .insert({
            github_id: nextTestGithubId(),
            github_username: `${prefix}-${randomUUID()}`,
        })
        .returning('id');
    return user.id;
}

async function createSession(userId: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    await database('sessions').insert({
        user_id: userId,
        token_hash: createHash('sha256').update(token).digest('hex'),
        expires_at: new Date(Date.now() + 60_000),
    });
    return token;
}

async function createAlert(name: string) {
    const alert = await createOwnedAlert(ownerId, apiId, {
        name,
        type: 'API_DOWN',
        configuration: {},
    });
    assert.ok(alert);
    return alert;
}

async function setConditionActive(alertApiId = apiId): Promise<void> {
    const checkedAt = new Date();
    await database('apis').where({ id: alertApiId }).update({
        status: 'ACTIVE',
        health_status: 'DOWN',
        last_health_check_at: checkedAt,
    });
    await database('health_checks').insert({
        id: randomUUID(),
        api_id: alertApiId,
        status: 'DOWN',
        response_status: 503,
        response_time_ms: 100,
        attempt_count: 1,
        error_message: 'Unavailable',
        is_manual: false,
        checked_at: checkedAt,
    });
}

async function setConditionInactive(alertApiId = apiId): Promise<void> {
    const checkedAt = new Date();
    await database('apis').where({ id: alertApiId }).update({
        status: 'ACTIVE',
        health_status: 'HEALTHY',
        last_health_check_at: checkedAt,
    });
    await database('health_checks').insert({
        id: randomUUID(),
        api_id: alertApiId,
        status: 'HEALTHY',
        response_status: 200,
        response_time_ms: 100,
        attempt_count: 1,
        error_message: null,
        is_manual: false,
        checked_at: checkedAt,
    });
}

async function request(
    path: string,
    token?: string,
    method = 'GET',
): Promise<{ status: number; body: unknown }> {
    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: token ? { cookie: `gatewatch_session=${token}` } : {},
    });
    return {
        status: response.status,
        body: response.status === 204 ? undefined : await response.json(),
    };
}

function responseData<T>(body: unknown): T {
    assert.ok(typeof body === 'object' && body !== null && 'data' in body);
    return body.data as T;
}

async function eventRows(alertId: string) {
    return database('alert_events')
        .where({ alert_id: alertId })
        .orderBy('occurred_at', 'asc');
}

before(async () => {
    ownerId = await createUser('alert-state-owner');
    otherUserId = await createUser('alert-state-other');
    ownerSession = await createSession(ownerId);
    otherSession = await createSession(otherUserId);

    const [project] = await database<{ id: string }>('projects')
        .insert({
            user_id: ownerId,
            name: `Alert state ${randomUUID()}`,
            slug: `alert-state-${randomUUID()}`,
        })
        .returning('id');
    const api = await createApi(project.id, {
        name: `Alert state API ${randomUUID()}`,
        upstreamUrl: 'https://example.test',
    });
    apiId = api.id;
    await database('apis').where({ id: apiId }).update({ status: 'ACTIVE' });

    server = createServer(app);
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});

after(async () => {
    if (ownerId || otherUserId) {
        await database('audit_logs')
            .whereIn('user_id', [ownerId, otherUserId].filter(Boolean))
            .delete();
        await database('users')
            .whereIn('id', [ownerId, otherUserId].filter(Boolean))
            .delete();
    }
    if (server) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await database.destroy();
});

test('GET evaluation is read-only and POST persists one trigger and recovery', async () => {
    const alert = await createAlert('Transitions');
    assert.equal(alert.runtimeState, 'INACTIVE');
    await setConditionActive();

    const preview = await request(
        `/alerts/${alert.id}/evaluate`,
        ownerSession,
    );
    assert.equal(preview.status, 200);
    assert.equal(responseData<{ active: boolean }>(preview.body).active, true);
    assert.equal(
        (await database('alerts').where({ id: alert.id }).first()).runtime_state,
        'INACTIVE',
    );
    assert.equal((await eventRows(alert.id)).length, 0);

    const triggered = await request(
        `/alerts/${alert.id}/evaluate`,
        ownerSession,
        'POST',
    );
    const triggerResult = responseData<{
        runtimeState: string;
        transitioned: boolean;
    }>(triggered.body);
    assert.equal(triggerResult.runtimeState, 'TRIGGERED');
    assert.equal(triggerResult.transitioned, true);

    const repeated = await request(
        `/alerts/${alert.id}/evaluate`,
        ownerSession,
        'POST',
    );
    assert.equal(
        responseData<{ transitioned: boolean }>(repeated.body).transitioned,
        false,
    );
    const triggers = await eventRows(alert.id);
    assert.equal(triggers.length, 1);
    assert.equal(triggers[0].event_type, 'TRIGGERED');
    assert.ok(triggers[0].triggered_at);
    assert.equal(triggers[0].resolved_at, null);

    await setConditionInactive();
    const recovered = await request(
        `/alerts/${alert.id}/evaluate`,
        ownerSession,
        'POST',
    );
    assert.equal(
        responseData<{ runtimeState: string }>(recovered.body).runtimeState,
        'INACTIVE',
    );
    assert.equal((await eventRows(alert.id)).length, 2);
    const recovery = (await eventRows(alert.id))[1];
    assert.equal(recovery.event_type, 'RECOVERED');
    assert.equal(recovery.triggered_at, null);
    assert.ok(recovery.resolved_at);
    assert.ok(recovery.occurred_at);

    const repeatedRecovery = await request(
        `/alerts/${alert.id}/evaluate`,
        ownerSession,
        'POST',
    );
    assert.equal(
        responseData<{ transitioned: boolean }>(repeatedRecovery.body)
            .transitioned,
        false,
    );
    assert.equal((await eventRows(alert.id)).length, 2);
});

test('disabled alerts preserve state and reconcile when re-enabled', async () => {
    const inactiveAlert = await createAlert('Disabled inactive');
    await setConditionActive();
    await database('alerts')
        .where({ id: inactiveAlert.id })
        .update({ enabled: false, status: 'DISABLED' });
    const skipped = await request(
        `/alerts/${inactiveAlert.id}/evaluate`,
        ownerSession,
        'POST',
    );
    assert.equal(
        responseData<{ runtimeState: string; transitioned: boolean }>(
            skipped.body,
        ).runtimeState,
        'INACTIVE',
    );
    assert.equal((await eventRows(inactiveAlert.id)).length, 0);

    const triggeredAlert = await createAlert('Disabled triggered');
    await setConditionActive();
    await request(
        `/alerts/${triggeredAlert.id}/evaluate`,
        ownerSession,
        'POST',
    );
    await database('alerts')
        .where({ id: triggeredAlert.id })
        .update({ enabled: false, status: 'DISABLED' });
    await setConditionInactive();
    await request(
        `/alerts/${triggeredAlert.id}/evaluate`,
        ownerSession,
        'POST',
    );
    assert.equal(
        (await database('alerts')
            .where({ id: triggeredAlert.id })
            .first()).runtime_state,
        'TRIGGERED',
    );
    assert.equal((await eventRows(triggeredAlert.id)).length, 1);

    await database('alerts')
        .where({ id: triggeredAlert.id })
        .update({ enabled: true, status: 'ACTIVE' });
    const reconciled = await request(
        `/alerts/${triggeredAlert.id}/evaluate`,
        ownerSession,
        'POST',
    );
    assert.equal(
        responseData<{ runtimeState: string; transitioned: boolean }>(
            reconciled.body,
        ).runtimeState,
        'INACTIVE',
    );
    assert.equal((await eventRows(triggeredAlert.id)).length, 2);
});

test('concurrent evaluations persist one transition event', async () => {
    const alert = await createAlert('Concurrent evaluations');
    await setConditionActive();

    const results = await Promise.all([
        request(`/alerts/${alert.id}/evaluate`, ownerSession, 'POST'),
        request(`/alerts/${alert.id}/evaluate`, ownerSession, 'POST'),
    ]);
    assert.ok(results.every((result) => result.status === 200));
    assert.equal((await eventRows(alert.id)).length, 1);
    assert.equal(
        (await database('alerts').where({ id: alert.id }).first()).runtime_state,
        'TRIGGERED',
    );
});

test('event insertion failure rolls back the runtime state update', async () => {
    const alert = await createAlert('Transition rollback');
    await setConditionActive();
    const suffix = randomUUID().replaceAll('-', '');
    const functionName = `fail_alert_event_${suffix}`;
    const triggerName = `fail_alert_event_trigger_${suffix}`;
    await database.raw(`
        CREATE FUNCTION ${functionName}() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.alert_id = '${alert.id}' THEN
                RAISE EXCEPTION 'injected alert event failure';
            END IF;
            RETURN NEW;
        END;
        $$
    `);
    try {
        await database.raw(`
            CREATE TRIGGER ${triggerName}
            BEFORE INSERT ON alert_events
            FOR EACH ROW EXECUTE FUNCTION ${functionName}()
        `);
        const result = await request(
            `/alerts/${alert.id}/evaluate`,
            ownerSession,
            'POST',
        );
        assert.equal(result.status, 500);
        assert.equal(
            (await database('alerts').where({ id: alert.id }).first())
                .runtime_state,
            'INACTIVE',
        );
        assert.equal((await eventRows(alert.id)).length, 0);
    } finally {
        try {
            await database.raw(
                `DROP TRIGGER IF EXISTS ${triggerName} ON alert_events`,
            );
        } finally {
            await database.raw(`DROP FUNCTION IF EXISTS ${functionName}()`);
        }
    }
});

test('state update failure leaves no event behind', async () => {
    const alert = await createAlert('State update rollback');
    await setConditionActive();
    const suffix = randomUUID().replaceAll('-', '');
    const functionName = `fail_alert_state_${suffix}`;
    const triggerName = `fail_alert_state_trigger_${suffix}`;
    await database.raw(`
        CREATE FUNCTION ${functionName}() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            IF OLD.id = '${alert.id}'
                AND NEW.runtime_state IS DISTINCT FROM OLD.runtime_state THEN
                RAISE EXCEPTION 'injected alert state failure';
            END IF;
            RETURN NEW;
        END;
        $$
    `);
    try {
        await database.raw(`
            CREATE TRIGGER ${triggerName}
            BEFORE UPDATE ON alerts
            FOR EACH ROW EXECUTE FUNCTION ${functionName}()
        `);
        const result = await request(
            `/alerts/${alert.id}/evaluate`,
            ownerSession,
            'POST',
        );
        assert.equal(result.status, 500);
        assert.equal((await eventRows(alert.id)).length, 0);
        assert.equal(
            (await database('alerts').where({ id: alert.id }).first())
                .runtime_state,
            'INACTIVE',
        );
    } finally {
        try {
            await database.raw(
                `DROP TRIGGER IF EXISTS ${triggerName} ON alerts`,
            );
        } finally {
            await database.raw(`DROP FUNCTION IF EXISTS ${functionName}()`);
        }
    }
});

test('event history is owned, newest-first, paginated, and validates query input', async () => {
    const alert = await createAlert('Event history');
    await setConditionActive();
    await request(`/alerts/${alert.id}/evaluate`, ownerSession, 'POST');
    await setConditionInactive();
    await request(`/alerts/${alert.id}/evaluate`, ownerSession, 'POST');

    const history = await request(
        `/alerts/${alert.id}/events?limit=1`,
        ownerSession,
    );
    assert.equal(history.status, 200);
    assert.ok(typeof history.body === 'object' && history.body !== null);
    const historyBody = history.body as {
        data: Array<{ eventType: string }>;
        pagination: { page: number; limit: number; total: number };
    };
    assert.equal(historyBody.data.length, 1);
    assert.equal(historyBody.data[0].eventType, 'RECOVERED');
    assert.equal(historyBody.pagination.total, 2);

    const emptyAlert = await createAlert('Empty event history');
    const empty = await request(
        `/alerts/${emptyAlert.id}/events`,
        ownerSession,
    );
    assert.equal(empty.status, 200);
    assert.equal(responseData<unknown[]>(empty.body).length, 0);

    assert.equal(
        (await request(`/alerts/${alert.id}/events?page=0`, ownerSession))
            .status,
        400,
    );
    assert.equal(
        (await request(`/alerts/${alert.id}/events?unexpected=1`, ownerSession))
            .status,
        400,
    );
    assert.equal(
        (await request(`/alerts/not-a-uuid/events`, ownerSession)).status,
        404,
    );
    assert.equal(
        (await request(`/alerts/${alert.id}/events`, otherSession)).status,
        404,
    );
    assert.equal(
        (await request(`/alerts/${alert.id}/events`)).status,
        401,
    );
});
