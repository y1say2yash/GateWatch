import type { Knex } from 'knex';

import database from '../config/database.js';
import type {
    ApiTest,
    TestExecutionHistoryItem,
    TestAssertion,
    TestInput,
} from './test-types.js';
import { describeAuthentication } from './test-credentials.js';

interface OwnedApiRow {
    id: string;
    upstream_url: string;
}

interface TestRow {
    id: string;
    api_id: string;
    name: string;
    method: ApiTest['method'];
    url: string | null;
    path: string;
    headers: Record<string, string> | null;
    body: string | null;
    authentication: unknown;
    assertions: ApiTest['assertions'];
    timeout_ms: number;
    created_at: Date;
    updated_at: Date;
    upstream_url?: string;
}

interface ExecutionHistoryRow {
    id: string;
    test_id: string;
    test_name: string;
    status: TestExecutionHistoryItem['status'];
    trigger_type: TestExecutionHistoryItem['triggerType'];
    response_status: number | null;
    response_time_ms: number | null;
    duration_ms: number | null;
    started_at: Date;
    completed_at: Date | null;
    assertions: unknown;
}

function serializeJsonb(value: unknown): Knex.Raw {
    if (value === null) {
        return database.raw('NULL::jsonb');
    }

    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
        throw new Error('JSONB test definition value is not JSON-serializable.');
    }

    return database.raw('?::jsonb', [serialized]);
}

function decodeJsonb(value: unknown): unknown {
    if (typeof value !== 'string') {
        return value;
    }
    try {
        return JSON.parse(value) as unknown;
    } catch {
        throw new Error('Database returned invalid JSONB test definition data.');
    }
}

function isStringRecord(value: unknown): value is Record<string, string> {
    return typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        Object.values(value).every((item) => typeof item === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTestAssertion(value: unknown): value is TestAssertion {
    if (!isRecord(value)) {
        return false;
    }
    if (value.type === 'STATUS_CODE') {
        return value.operator === 'EQUALS' &&
            typeof value.expected === 'number';
    }
    if (value.type === 'JSON_BODY') {
        return typeof value.path === 'string' &&
            ['EQUALS', 'NOT_EQUALS', 'CONTAINS', 'EXISTS'].includes(
                String(value.operator),
            ) &&
            (value.operator === 'EXISTS' || 'expected' in value);
    }
    if (value.type === 'RESPONSE_HEADER') {
        return typeof value.name === 'string' &&
            ['EQUALS', 'CONTAINS', 'EXISTS'].includes(
                String(value.operator),
            ) &&
            (value.operator === 'EXISTS' ||
                typeof value.expected === 'string');
    }
    return value.type === 'RESPONSE_TIME' &&
        value.operator === 'LESS_THAN_OR_EQUAL' &&
        typeof value.expected === 'number';
}

function readHeaders(value: unknown): Record<string, string> {
    const headers = decodeJsonb(value ?? {});
    if (!isStringRecord(headers)) {
        throw new Error('Database returned invalid JSONB test headers.');
    }
    return Object.fromEntries(
        Object.entries(headers).filter(
            ([name]) => !/password|secret|token|credential|authorization|api.?key|cookie|session|signature|private.?key/i.test(name),
        ),
    );
}

function readAssertions(value: unknown): TestAssertion[] {
    const assertions = decodeJsonb(value ?? []);
    if (!Array.isArray(assertions) || !assertions.every(isTestAssertion)) {
        throw new Error('Database returned invalid JSONB test assertions.');
    }
    return assertions;
}

function legacyUrl(upstreamUrl: string, path: string): string {
    const target = new URL(upstreamUrl);
    target.username = '';
    target.password = '';
    if (/^https?:\/\//i.test(path)) {
        const legacyTarget = new URL(path);
        target.pathname = `${target.pathname.replace(/\/+$/, '')}${legacyTarget.pathname}`;
        target.search = legacyTarget.search;
        target.hash = '';
        return target.toString();
    }
    const relative = path.startsWith('/') ? path : `/${path}`;
    target.pathname = `${target.pathname.replace(/\/+$/, '')}${relative}`;
    target.hash = '';
    return target.toString();
}

function safeTargetUrl(row: TestRow): string {
    const upstream = row.upstream_url ?? '';
    try {
        const configuredOrigin = new URL(upstream);
        configuredOrigin.username = '';
        configuredOrigin.password = '';
        const target = new URL(row.url ?? legacyUrl(upstream, row.path));
        target.username = '';
        target.password = '';
        target.hash = '';
        return target.origin === configuredOrigin.origin
            ? target.toString()
            : legacyUrl(upstream, row.path);
    } catch {
        return legacyUrl(upstream, row.path);
    }
}

function mapTest(row: TestRow): ApiTest {
    let body: unknown = row.body;
    if (row.body !== null) {
        try {
            body = JSON.parse(row.body) as unknown;
        } catch {
            body = row.body;
        }
    }
    return {
        id: row.id,
        apiId: row.api_id,
        name: row.name,
        method: row.method,
        url: safeTargetUrl(row),
        headers: readHeaders(row.headers),
        body,
        authentication: describeAuthentication(row.authentication),
        assertions: readAssertions(row.assertions),
        timeoutMs: row.timeout_ms,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
    };
}

export async function findOwnedApi(
    userId: string,
    apiId: string,
): Promise<OwnedApiRow | null> {
    return database<OwnedApiRow>('apis')
        .join('projects', 'projects.id', 'apis.project_id')
        .where({
            'apis.id': apiId,
            'projects.user_id': userId,
        })
        .whereNull('apis.deleted_at')
        .whereNull('projects.deleted_at')
        .whereNot('apis.status', 'DELETED')
        .select('apis.id', 'apis.upstream_url')
        .first() ?? null;
}

export async function listOwnedApiTests(
    userId: string,
    apiId: string,
): Promise<ApiTest[] | null> {
    const api = await findOwnedApi(userId, apiId);
    if (!api) {
        return null;
    }
    const rows = await database<TestRow>('tests')
        .where({ api_id: apiId })
        .whereNull('deleted_at')
        .orderBy('created_at', 'desc')
        .select('*')
        .then((items) => items.map((item) => ({
            ...item,
            upstream_url: api.upstream_url,
        })));
    return rows.map(mapTest);
}

export async function findOwnedTest(
    userId: string,
    testId: string,
): Promise<ApiTest | null> {
    const row = await database<TestRow>('tests')
        .join('apis', 'apis.id', 'tests.api_id')
        .join('projects', 'projects.id', 'apis.project_id')
        .where({
            'tests.id': testId,
            'projects.user_id': userId,
        })
        .whereNull('tests.deleted_at')
        .whereNull('apis.deleted_at')
        .whereNull('projects.deleted_at')
        .whereNot('apis.status', 'DELETED')
        .select('tests.*', 'apis.upstream_url')
        .first();
    return row ? mapTest(row) : null;
}

export async function createTest(
    apiId: string,
    input: TestInput,
    authentication: unknown,
): Promise<ApiTest> {
    const body = input.body === null ? null : JSON.stringify(input.body);
    const path = `${new URL(input.url).pathname}${new URL(input.url).search}`;
    const [row] = await database<TestRow>('tests')
        .insert({
            api_id: apiId,
            name: input.name,
            method: input.method,
            url: input.url,
            path,
            headers: serializeJsonb(input.headers),
            body,
            authentication: serializeJsonb(authentication),
            assertions: serializeJsonb(input.assertions),
            timeout_ms: input.timeoutMs,
        })
        .returning('*');
    return mapTest({ ...row, upstream_url: input.url });
}

export async function updateOwnedTest(
    userId: string,
    testId: string,
    input: Partial<TestInput>,
    authentication?: unknown,
): Promise<ApiTest | null> {
    const update: Record<string, unknown> = {
        updated_at: database.fn.now(),
    };
    if (input.name !== undefined) update.name = input.name;
    if (input.method !== undefined) update.method = input.method;
    if (input.url !== undefined) {
        const target = new URL(input.url);
        update.url = input.url;
        update.path = `${target.pathname}${target.search}`;
    }
    if (input.headers !== undefined) {
        update.headers = serializeJsonb(input.headers);
    }
    if (input.body !== undefined) {
        update.body = input.body === null ? null : JSON.stringify(input.body);
    }
    if (input.assertions !== undefined) {
        update.assertions = serializeJsonb(input.assertions);
    }
    if (input.timeoutMs !== undefined) update.timeout_ms = input.timeoutMs;
    if (authentication !== undefined) {
        update.authentication = serializeJsonb(authentication);
    }

    const [row] = await database<TestRow>('tests')
        .where('tests.id', testId)
        .whereNull('tests.deleted_at')
        .whereIn(
            'tests.api_id',
            database('apis')
                .join('projects', 'projects.id', 'apis.project_id')
                .select('apis.id')
                .where('projects.user_id', userId)
                .whereNull('projects.deleted_at')
                .whereNull('apis.deleted_at')
                .whereNot('apis.status', 'DELETED'),
        )
        .update(update)
        .returning('*');
    if (!row) {
        return null;
    }
    const owned = await findOwnedApi(userId, row.api_id);
    return owned ? mapTest({ ...row, upstream_url: owned.upstream_url }) : null;
}

export async function softDeleteOwnedTest(
    userId: string,
    testId: string,
): Promise<boolean> {
    const updated = await database('tests')
        .where('tests.id', testId)
        .whereNull('tests.deleted_at')
        .whereIn(
            'tests.api_id',
            database('apis')
                .join('projects', 'projects.id', 'apis.project_id')
                .select('apis.id')
                .where('projects.user_id', userId)
                .whereNull('projects.deleted_at')
                .whereNull('apis.deleted_at')
                .whereNot('apis.status', 'DELETED'),
        )
        .update({
            deleted_at: database.fn.now(),
            updated_at: database.fn.now(),
        });
    return updated > 0;
}

export async function findStoredAuthentication(
    testId: string,
): Promise<unknown> {
    const row = await database('tests')
        .where({ id: testId })
        .whereNull('deleted_at')
        .select('authentication')
        .first();
    return row?.authentication ?? null;
}

function mapExecutionHistoryRow(row: ExecutionHistoryRow): TestExecutionHistoryItem {
    const assertions = decodeJsonb(row.assertions);
    const safeAssertions = Array.isArray(assertions)
        ? assertions.flatMap((assertion) => {
            if (!isRecord(assertion) ||
                !['STATUS_CODE', 'JSON_BODY', 'RESPONSE_HEADER', 'RESPONSE_TIME'].includes(
                    String(assertion.type),
                ) ||
                typeof assertion.pass !== 'boolean') {
                return [];
            }
            return [{
                type: assertion.type as TestAssertion['type'],
                pass: assertion.pass,
            }];
        })
        : [];

    return {
        id: row.id,
        testId: row.test_id,
        testName: row.test_name,
        status: row.status,
        triggerType: row.trigger_type,
        responseStatus: row.response_status,
        responseTimeMs: row.response_time_ms,
        durationMs: row.duration_ms,
        startedAt: row.started_at.toISOString(),
        completedAt: row.completed_at === null
            ? null
            : row.completed_at.toISOString(),
        assertions: safeAssertions,
    };
}

export async function listOwnedTestExecutionHistory(
    userId: string,
    testId: string,
    page: number,
    pageSize: number,
): Promise<{ data: TestExecutionHistoryItem[]; total: number } | null> {
    const ownedTest = database('tests')
        .join('apis', 'apis.id', 'tests.api_id')
        .join('projects', 'projects.id', 'apis.project_id')
        .where({
            'tests.id': testId,
            'projects.user_id': userId,
        })
        .whereNull('tests.deleted_at')
        .whereNull('apis.deleted_at')
        .whereNull('projects.deleted_at')
        .whereNot('apis.status', 'DELETED')
        .select('tests.id');
    if (!await ownedTest.clone().first()) {
        return null;
    }
    const ownedExecutions = database('test_executions')
        .join('tests', 'tests.id', 'test_executions.test_id')
        .join('apis', 'apis.id', 'tests.api_id')
        .join('projects', 'projects.id', 'apis.project_id')
        .where({
            'tests.id': testId,
            'projects.user_id': userId,
        })
        .whereNull('tests.deleted_at')
        .whereNull('apis.deleted_at')
        .whereNull('projects.deleted_at')
        .whereNot('apis.status', 'DELETED');

    const countRow = await ownedExecutions.clone().count({ count: 'test_executions.id' }).first();

    const rows = await ownedExecutions
        .clone()
        .select(
            'test_executions.id',
            'test_executions.test_id',
            'tests.name as test_name',
            'test_executions.status',
            'test_executions.trigger_type',
            'test_executions.response_status',
            'test_executions.response_time_ms',
            'test_executions.duration_ms',
            'test_executions.started_at',
            'test_executions.completed_at',
            'test_executions.assertions',
        )
        .orderBy('test_executions.started_at', 'desc')
        .orderBy('test_executions.id', 'desc')
        .limit(pageSize)
        .offset((page - 1) * pageSize) as ExecutionHistoryRow[];

    return {
        data: rows.map(mapExecutionHistoryRow),
        total: Number(countRow?.count ?? 0),
    };
}
