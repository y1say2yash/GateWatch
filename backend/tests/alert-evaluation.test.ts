import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

import database from '../src/config/database.js';
import { createApi } from '../src/apis/api-repository.js';
import { createOwnedAlert } from '../src/alerts/alert-repository.js';
import { evaluateUserAlert } from '../src/alerts/alert-service.js';
import { nextTestGithubId } from './test-user-identity.js';

let ownerId: string;
let otherUserId: string;
let apiId: string;

async function createUser(usernamePrefix: string): Promise<string> {
    const [user] = await database<{ id: string }>('users')
        .insert({
            github_id: nextTestGithubId(),
            github_username: `${usernamePrefix}-${randomUUID()}`,
        })
        .returning('id');
    return user.id;
}

before(async () => {
    ownerId = await createUser('alert-eval-owner');
    otherUserId = await createUser('alert-eval-other');

    const [project] = await database<{ id: string }>('projects')
        .insert({
            user_id: ownerId,
            name: `Alert eval ${randomUUID()}`,
            slug: `alert-eval-${randomUUID()}`,
        })
        .returning('id');

    const api = await createApi(project.id, {
        name: `Alert API ${randomUUID()}`,
        upstreamUrl: 'https://example.test',
    });
    apiId = api.id;
    await database('apis').where({ id: apiId }).update({ status: 'ACTIVE' });
});

after(async () => {
    await database('request_history').where({ api_id: apiId }).delete();
    await database('health_checks').where({ api_id: apiId }).delete();
    await database('alerts').where({ api_id: apiId }).delete();
    await database('apis').where({ id: apiId }).delete();
    await database('projects').where({ user_id: ownerId }).delete();
    await database('users').whereIn('id', [ownerId, otherUserId]).delete();
    await database.destroy();
});

test('evaluates API_DOWN from the current persisted health status', async () => {
    const alert = await createOwnedAlert(ownerId, apiId, {
        name: 'API is down',
        type: 'API_DOWN',
        configuration: {},
    });
    assert.ok(alert);

    await database('apis')
        .where({ id: apiId })
        .update({
            health_status: 'DOWN',
            last_health_check_at: new Date('2026-01-01T00:00:00.000Z'),
        });
    await database('health_checks').insert({
        id: randomUUID(),
        api_id: apiId,
        status: 'DOWN',
        response_status: 503,
        response_time_ms: 2_000,
        attempt_count: 1,
        error_message: 'Upstream unavailable.',
        is_manual: false,
        checked_at: new Date('2026-01-01T00:00:00.000Z'),
    });

    const result = await evaluateUserAlert(ownerId, alert.id);
    assert.equal(result.active, true);

    await database('apis').where({ id: apiId }).update({ status: 'DISABLED' });
    const disabledResult = await evaluateUserAlert(ownerId, alert.id);
    assert.equal(disabledResult.active, false);
});

test('evaluates UNHEALTHY_DURATION for a continuous unhealthy period', async () => {
    const alert = await createOwnedAlert(ownerId, apiId, {
        name: 'Unhealthy too long',
        type: 'UNHEALTHY_DURATION',
        configuration: { durationSeconds: 900 },
    });

    const now = new Date('2026-01-01T00:45:00.000Z');
    await database('apis')
        .where({ id: apiId })
        .update({
            status: 'ACTIVE',
            health_status: 'DOWN',
            last_health_check_at: now,
        });
    await database('health_checks').insert([
        {
            id: randomUUID(),
            api_id: apiId,
            status: 'HEALTHY',
            response_status: 200,
            response_time_ms: 100,
            attempt_count: 1,
            error_message: null,
            is_manual: false,
            checked_at: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
            id: randomUUID(),
            api_id: apiId,
            status: 'DOWN',
            response_status: 503,
            response_time_ms: 2_000,
            attempt_count: 1,
            error_message: 'Down',
            is_manual: false,
            checked_at: new Date('2026-01-01T00:15:00.000Z'),
        },
        {
            id: randomUUID(),
            api_id: apiId,
            status: 'DOWN',
            response_status: 503,
            response_time_ms: 2_000,
            attempt_count: 1,
            error_message: 'Down',
            is_manual: false,
            checked_at: new Date('2026-01-01T00:30:00.000Z'),
        },
    ]);

    const active = await evaluateUserAlert(ownerId, alert.id, now);
    assert.equal(active.active, true);

    await database('health_checks').insert({
        id: randomUUID(),
        api_id: apiId,
        status: 'HEALTHY',
        response_status: 200,
        response_time_ms: 120,
        attempt_count: 1,
        error_message: null,
        is_manual: false,
        checked_at: new Date('2026-01-01T00:40:00.000Z'),
    });

    const reset = await evaluateUserAlert(ownerId, alert.id, now);
    assert.equal(reset.active, false);
});

test('evaluates ERROR_RATE using the configured threshold and ignores empty windows', async () => {
    const alert = await createOwnedAlert(ownerId, apiId, {
        name: 'Error rate high',
        type: 'ERROR_RATE',
        configuration: { threshold: 0.5, windowSeconds: 3600 },
    });

    const now = new Date('2026-01-01T01:00:00.000Z');
    await database('request_history').where({ api_id: apiId }).delete();
    await database('request_history').insert([
        { id: randomUUID(), api_id: apiId, method: 'GET', path: '/', status_code: 200, response_time_ms: 50, client_ip: null, created_at: new Date('2026-01-01T00:00:00.000Z'), result: {} },
        { id: randomUUID(), api_id: apiId, method: 'GET', path: '/', status_code: 500, response_time_ms: 120, client_ip: null, created_at: new Date('2026-01-01T00:10:00.000Z'), result: {} },
        { id: randomUUID(), api_id: apiId, method: 'GET', path: '/', status_code: 200, response_time_ms: 80, client_ip: null, created_at: new Date('2026-01-01T00:20:00.000Z'), result: {} },
        { id: randomUUID(), api_id: apiId, method: 'GET', path: '/', status_code: 500, response_time_ms: 140, client_ip: null, created_at: new Date('2026-01-01T00:30:00.000Z'), result: {} },
        { id: randomUUID(), api_id: apiId, method: 'GET', path: '/', status_code: 500, response_time_ms: 160, client_ip: null, created_at: new Date('2026-01-01T00:40:00.000Z'), result: {} },
        { id: randomUUID(), api_id: apiId, method: 'GET', path: '/', status_code: 500, response_time_ms: 10_000, client_ip: null, created_at: new Date('2025-12-31T23:59:59.999Z'), result: {} },
        { id: randomUUID(), api_id: apiId, method: 'GET', path: '/', status_code: 500, response_time_ms: 10_000, client_ip: null, created_at: new Date('2026-01-01T01:00:00.001Z'), result: {} },
    ]);

    const active = await evaluateUserAlert(ownerId, alert.id, now);
    assert.equal(active.active, true);

    await database('request_history').where({ api_id: apiId }).update({ status_code: 200 });
    const belowThreshold = await evaluateUserAlert(ownerId, alert.id, now);
    assert.equal(belowThreshold.active, false);

    await database('request_history')
        .where({ api_id: apiId })
        .whereIn('created_at', [
            new Date('2026-01-01T00:10:00.000Z'),
            new Date('2026-01-01T00:40:00.000Z'),
        ])
        .update({ status_code: 500 });
    const thresholdBoundary = await evaluateUserAlert(ownerId, alert.id, now);
    assert.equal(thresholdBoundary.active, false);

    await database('alerts').where({ id: alert.id }).update({ configuration: { threshold: 0.01, windowSeconds: 60 } });
    const noWindow = await evaluateUserAlert(ownerId, alert.id, now);
    assert.equal(noWindow.active, false);
});

test('evaluates LATENCY using the existing average latency metric', async () => {
    const alert = await createOwnedAlert(ownerId, apiId, {
        name: 'Slow API latency',
        type: 'LATENCY',
        configuration: { thresholdMs: 1000, windowSeconds: 3600 },
    });

    const now = new Date('2026-01-01T01:00:00.000Z');
    await database('request_history').where({ api_id: apiId }).delete();
    await database('request_history').insert([
        { id: randomUUID(), api_id: apiId, method: 'GET', path: '/', status_code: 200, response_time_ms: 800, client_ip: null, created_at: new Date('2026-01-01T00:40:00.000Z'), result: {} },
        { id: randomUUID(), api_id: apiId, method: 'GET', path: '/', status_code: 200, response_time_ms: 1_300, client_ip: null, created_at: new Date('2026-01-01T00:50:00.000Z'), result: {} },
        { id: randomUUID(), api_id: apiId, method: 'GET', path: '/', status_code: 200, response_time_ms: 10_000, client_ip: null, created_at: new Date('2025-12-31T23:59:59.999Z'), result: {} },
        { id: randomUUID(), api_id: apiId, method: 'GET', path: '/', status_code: 200, response_time_ms: 10_000, client_ip: null, created_at: new Date('2026-01-01T01:00:00.001Z'), result: {} },
    ]);

    const active = await evaluateUserAlert(ownerId, alert.id, now);
    assert.equal(active.active, true);

    await database('request_history')
        .where({ api_id: apiId })
        .whereIn('created_at', [
            new Date('2026-01-01T00:40:00.000Z'),
            new Date('2026-01-01T00:50:00.000Z'),
        ])
        .update({ response_time_ms: 800 });
    const belowThreshold = await evaluateUserAlert(ownerId, alert.id, now);
    assert.equal(belowThreshold.active, false);

    await database('request_history')
        .where({ api_id: apiId })
        .whereIn('created_at', [
            new Date('2026-01-01T00:40:00.000Z'),
            new Date('2026-01-01T00:50:00.000Z'),
        ])
        .update({ response_time_ms: 1000 });
    const thresholdBoundary = await evaluateUserAlert(ownerId, alert.id, now);
    assert.equal(thresholdBoundary.active, false);

    await database('alerts').where({ id: alert.id }).update({ configuration: { thresholdMs: 1, windowSeconds: 60 } });
    await database('request_history').where({ api_id: apiId }).delete();
    const noData = await evaluateUserAlert(ownerId, alert.id, now);
    assert.equal(noData.active, false);
});

test('rejects evaluation for a different user', async () => {
    const alert = await createOwnedAlert(ownerId, apiId, {
        name: 'Foreign user',
        type: 'API_DOWN',
        configuration: {},
    });

    await assert.rejects(
        () => evaluateUserAlert(otherUserId, alert.id),
        /Alert not found|Alert or API not found/,
    );
});
