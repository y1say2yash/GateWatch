import database from '../config/database.js';
import {
    createTest,
    findOwnedApi,
    findOwnedTest,
    findStoredAuthentication,
    listOwnedTestExecutionHistory,
    listOwnedApiTests,
    softDeleteOwnedTest,
    updateOwnedTest,
} from './test-repository.js';
import {
    protectAuthentication,
    storedAuthentication,
} from './test-credentials.js';
import { executeTestDefinition, TestApiDisabledError } from './test-execution.js';
import { validateTestInput } from './test-validation.js';
import type {
    ApiTest,
    TestExecutionHistoryItem,
    TestExecutionResult,
    TestInput,
} from './test-types.js';

export class TestNotFoundError extends Error {
    constructor() {
        super('Test not found.');
        this.name = 'TestNotFoundError';
    }
}

export class TestApiNotFoundError extends Error {
    constructor() {
        super('API not found.');
        this.name = 'TestApiNotFoundError';
    }
}

export class TestHistoryQueryError extends Error {
    constructor() {
        super('Page must be a positive integer and page size must be between 1 and 100.');
        this.name = 'TestHistoryQueryError';
    }
}

function requireCredentials(authentication: Record<string, unknown>): void {
    if (authentication.type === 'BASIC' && typeof authentication.password !== 'string') {
        throw new Error('Basic authentication password is required.');
    }
    if (authentication.type === 'BEARER' && typeof authentication.token !== 'string') {
        throw new Error('Bearer token is required.');
    }
    if (authentication.type === 'API_KEY' && typeof authentication.value !== 'string') {
        throw new Error('API-key value is required.');
    }
}

export async function listUserTests(
    userId: string,
    apiId: string,
): Promise<ApiTest[]> {
    const tests = await listOwnedApiTests(userId, apiId);
    if (!tests) throw new TestApiNotFoundError();
    return tests;
}

export async function getUserTest(
    userId: string,
    testId: string,
): Promise<ApiTest> {
    const test = await findOwnedTest(userId, testId);
    if (!test) throw new TestNotFoundError();
    return test;
}

export async function getUserTestExecutionHistory(
    userId: string,
    testId: string,
    rawPage?: string,
    rawPageSize?: string,
): Promise<{
    data: TestExecutionHistoryItem[];
    page: number;
    pageSize: number;
    total: number;
    hasNextPage: boolean;
}> {
    const page = rawPage === undefined ? 1 : Number(rawPage);
    const pageSize = rawPageSize === undefined ? 20 : Number(rawPageSize);
    if (!Number.isSafeInteger(page) || page < 1 ||
        !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
        throw new TestHistoryQueryError();
    }

    const result = await listOwnedTestExecutionHistory(userId, testId, page, pageSize);
    if (!result) throw new TestNotFoundError();
    return {
        ...result,
        page,
        pageSize,
        hasNextPage: page * pageSize < result.total,
    };
}

export async function createUserTest(
    userId: string,
    apiId: string,
    rawInput: unknown,
): Promise<ApiTest> {
    const api = await findOwnedApi(userId, apiId);
    if (!api) throw new TestApiNotFoundError();
    const input = validateTestInput(rawInput, api.upstream_url) as TestInput;
    const authentication = input.authentication;
    requireCredentials(authentication);
    return createTest(
        apiId,
        input,
        protectAuthentication(authentication),
    );
}

export async function updateUserTest(
    userId: string,
    testId: string,
    rawInput: unknown,
): Promise<ApiTest> {
    const current = await findOwnedTest(userId, testId);
    if (!current) throw new TestNotFoundError();
    const api = await findOwnedApi(userId, current.apiId);
    if (!api) throw new TestNotFoundError();
    const input = validateTestInput(rawInput, api.upstream_url, true);
    let authentication: unknown;

    if (input.authentication !== undefined) {
        const supplied = input.authentication;
        const existing = storedAuthentication(
            await findStoredAuthentication(testId),
        );
        const authType = supplied.type;
        const hasCredential = authType === 'BASIC'
            ? typeof supplied.password === 'string'
            : authType === 'BEARER'
                ? typeof supplied.token === 'string'
                : authType === 'API_KEY'
                    ? typeof supplied.value === 'string'
                    : true;
        if (!hasCredential && existing?.type !== authType) {
            requireCredentials(supplied);
        }
        authentication = protectAuthentication(supplied, existing);
    }

    const updated = await updateOwnedTest(
        userId,
        testId,
        input,
        authentication,
    );
    if (!updated) throw new TestNotFoundError();
    return updated;
}

export async function deleteUserTest(
    userId: string,
    testId: string,
): Promise<void> {
    if (!await softDeleteOwnedTest(userId, testId)) {
        throw new TestNotFoundError();
    }
}

export async function executeUserTest(
    userId: string,
    testId: string,
    triggerType: 'MANUAL' | 'CI_CD' = 'MANUAL',
): Promise<{ id: string; executionId: string; status: 'PASSED' | 'FAILED' | 'ERROR'; passed: boolean; durationMs: number; result: TestExecutionResult; }> {
    const test = await findOwnedTest(userId, testId);
    if (!test) {
        throw new TestNotFoundError();
    }

    const apiRow = await database<{ status: 'ACTIVE' | 'DISABLED' | 'DELETED'; id: string }>('apis')
        .join('projects', 'projects.id', 'apis.project_id')
        .where({ 'apis.id': test.apiId, 'projects.user_id': userId })
        .whereNull('apis.deleted_at')
        .whereNull('projects.deleted_at')
        .select('apis.status', 'apis.id')
        .first();

    if (!apiRow || apiRow.status === 'DELETED' || apiRow.status === 'DISABLED') {
        throw new TestApiDisabledError();
    }

    const rawStoredAuthentication = await findStoredAuthentication(testId);
    const validationTarget = validateTestInput(
        {
            name: test.name,
            method: test.method,
            url: test.url,
            headers: test.headers,
            body: test.body,
            authentication: { type: 'NONE' },
            assertions: test.assertions,
            timeoutMs: test.timeoutMs,
        },
        await database<{ upstream_url: string }>('apis')
            .join('projects', 'projects.id', 'apis.project_id')
            .where({ 'apis.id': test.apiId, 'projects.user_id': userId })
            .whereNull('apis.deleted_at')
            .whereNull('projects.deleted_at')
            .select('apis.upstream_url')
            .first()
            .then((row) => row?.upstream_url ?? ''),
    );
    if (validationTarget.url === undefined) {
        throw new TestNotFoundError();
    }

    const startedAt = new Date();
    const result = await executeTestDefinition(test, rawStoredAuthentication);
    const inserted = await database('test_executions')
        .insert({
            test_id: test.id,
            status: result.status,
            trigger_type: triggerType,
            response_status: result.responseStatus,
            response_time_ms: result.responseTimeMs,
            assertions: database.raw('?::jsonb', [JSON.stringify(result.assertions)]),
            error_message: result.errorMessage,
            started_at: startedAt,
            completed_at: new Date(),
            duration_ms: result.durationMs,
            result: database.raw('?::jsonb', [JSON.stringify({
                passed: result.passed,
                status: result.status,
                durationMs: result.durationMs,
                responseStatus: result.responseStatus,
                responseTimeMs: result.responseTimeMs,
                assertions: result.assertions,
                errorMessage: result.errorMessage,
            })]),
        })
        .returning(['id', 'status']);

    const executionId = inserted[0]?.id ?? '';
    return {
        id: executionId,
        executionId,
        status: result.status,
        passed: result.passed,
        durationMs: result.durationMs,
        result,
    };
}
