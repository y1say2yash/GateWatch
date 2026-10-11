import {
    createTest,
    findOwnedApi,
    findOwnedTest,
    findStoredAuthentication,
    listOwnedApiTests,
    softDeleteOwnedTest,
    updateOwnedTest,
} from './test-repository.js';
import {
    protectAuthentication,
    storedAuthentication,
} from './test-credentials.js';
import { validateTestInput } from './test-validation.js';
import type { ApiTest, TestInput } from './test-types.js';

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
