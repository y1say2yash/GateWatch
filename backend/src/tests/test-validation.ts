import type {
    TestAssertion,
    TestAuthenticationType,
    TestInput,
    TestMethod,
} from './test-types.js';
import {
    isDevelopmentLocalOriginAllowed,
    isLocalHostname,
} from './test-network-policy.js';

const METHODS = new Set<TestMethod>([
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'HEAD',
    'OPTIONS',
]);
const AUTHENTICATION_TYPES = new Set<TestAuthenticationType>([
    'NONE',
    'BASIC',
    'BEARER',
    'API_KEY',
]);
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_HEADERS = 50;
const MAX_HEADER_VALUE_LENGTH = 8_192;
const MAX_BODY_LENGTH = 64 * 1024;
const MAX_ASSERTIONS = 50;
const SENSITIVE_INPUT_NAME = /password|secret|token|credential|authorization|api.?key|session|signature|private.?key/i;
const FORBIDDEN_HEADERS = new Set([
    'authorization',
    'proxy-authorization',
    'host',
    'cookie',
    'set-cookie',
    'connection',
    'transfer-encoding',
    'content-length',
]);

function hasControlCharacters(value: string): boolean {
    return [...value].some((character) => {
        const code = character.charCodeAt(0);
        return code <= 0x1f || code === 0x7f;
    });
}

function isJsonValue(value: unknown): boolean {
    try {
        const serialized = JSON.stringify(value);
        return serialized !== undefined &&
            Buffer.byteLength(serialized) <= MAX_BODY_LENGTH;
    } catch {
        return false;
    }
}

export class TestValidationError extends Error {
    constructor(
        public readonly code: string,
        message: string,
    ) {
        super(message);
        this.name = 'TestValidationError';
    }
}

export class TestTargetUrlError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'TestTargetUrlError';
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateName(value: unknown): string {
    if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 100) {
        throw new TestValidationError(
            'INVALID_TEST_NAME',
            'Test name must be between 1 and 100 characters.',
        );
    }
    return value.trim();
}

function validateMethod(value: unknown): TestMethod {
    if (typeof value !== 'string' || !METHODS.has(value as TestMethod)) {
        throw new TestValidationError(
            'INVALID_TEST_METHOD',
            'Method must be one of GET, POST, PUT, PATCH, DELETE, HEAD, or OPTIONS.',
        );
    }
    return value as TestMethod;
}

function validateUrl(value: unknown, upstreamUrl: string): string {
    if (typeof value !== 'string' || value.length > 2048) {
        throw new TestValidationError(
            'INVALID_TEST_URL',
            'Test URL must be a valid HTTP or HTTPS URL no longer than 2048 characters.',
        );
    }

    let target: URL;
    let upstream: URL;
    try {
        target = new URL(value);
        upstream = new URL(upstreamUrl);
    } catch {
        throw new TestValidationError(
            'INVALID_TEST_URL',
            'Test URL must be a valid absolute HTTP or HTTPS URL.',
        );
    }

    if (
        (target.protocol !== 'http:' && target.protocol !== 'https:') ||
        target.username ||
        target.password ||
        target.hash ||
        upstream.username ||
        upstream.password
    ) {
        throw new TestValidationError(
            'INVALID_TEST_URL',
            'Test URL must use HTTP or HTTPS and cannot contain credentials or a fragment.',
        );
    }

    if (target.origin !== upstream.origin) {
        throw new TestTargetUrlError(
            'Test URL must use the configured upstream API origin.',
        );
    }

    if (
        isLocalHostname(target.hostname) &&
        !isDevelopmentLocalOriginAllowed(target)
    ) {
        throw new TestTargetUrlError(
            'Test URL cannot target a loopback, private, link-local, or metadata host.',
        );
    }

    return target.toString();
}

function validateHeaders(value: unknown): Record<string, string> {
    if (value === undefined || value === null) {
        return {};
    }
    if (!isRecord(value) || Object.keys(value).length > MAX_HEADERS) {
        throw new TestValidationError(
            'INVALID_TEST_HEADERS',
            'Headers must be an object containing no more than 50 entries.',
        );
    }

    const headers: Record<string, string> = {};
    for (const [name, headerValue] of Object.entries(value)) {
        if (
            name.length < 1 ||
            name.length > 128 ||
            /[\r\n:]/.test(name) ||
            FORBIDDEN_HEADERS.has(name.toLowerCase()) ||
            SENSITIVE_INPUT_NAME.test(name)
        ) {
            throw new TestValidationError(
                'INVALID_TEST_HEADERS',
                'A header name is unsupported or identifies credential data.',
            );
        }
        if (
            typeof headerValue !== 'string' ||
            headerValue.length > MAX_HEADER_VALUE_LENGTH ||
            hasControlCharacters(headerValue)
        ) {
            throw new TestValidationError(
                'INVALID_TEST_HEADERS',
                `Header values must be single-line strings no longer than ${MAX_HEADER_VALUE_LENGTH} characters.`,
            );
        }
        headers[name] = headerValue;
    }
    return headers;
}

function validateBody(value: unknown): unknown {
    if (value === undefined) {
        return null;
    }
    let serialized: string;
    try {
        serialized = JSON.stringify(value);
    } catch {
        throw new TestValidationError(
            'INVALID_TEST_BODY',
            'Request body must be JSON-compatible.',
        );
    }
    if (serialized === undefined || Buffer.byteLength(serialized) > MAX_BODY_LENGTH) {
        throw new TestValidationError(
            'INVALID_TEST_BODY',
            'Request body must be JSON-compatible and no larger than 64 KB.',
        );
    }
    const containsCredentialField = (item: unknown): boolean => {
        if (Array.isArray(item)) {
            return item.some(containsCredentialField);
        }
        if (!isRecord(item)) {
            return false;
        }
        return Object.entries(item).some(([key, nested]) =>
            SENSITIVE_INPUT_NAME.test(key) || containsCredentialField(nested),
        );
    };
    if (containsCredentialField(value)) {
        throw new TestValidationError(
            'INVALID_TEST_BODY',
            'Request body cannot contain credential fields; configure authentication separately.',
        );
    }
    return value;
}

function validateAuthentication(value: unknown): Record<string, unknown> {
    if (value === undefined || value === null) {
        return { type: 'NONE' };
    }
    if (!isRecord(value) || typeof value.type !== 'string' ||
        !AUTHENTICATION_TYPES.has(value.type as TestAuthenticationType)) {
        throw new TestValidationError(
            'INVALID_TEST_AUTHENTICATION',
            'Authentication must be NONE, BASIC, BEARER, or API_KEY.',
        );
    }
    const type = value.type as TestAuthenticationType;
    const allowed = type === 'BASIC'
        ? new Set(['type', 'username', 'password'])
        : type === 'BEARER'
            ? new Set(['type', 'token'])
            : type === 'API_KEY'
                ? new Set(['type', 'name', 'value'])
                : new Set(['type']);

    if (Object.keys(value).some((key) => !allowed.has(key))) {
        throw new TestValidationError(
            'INVALID_TEST_AUTHENTICATION',
            'Authentication contains unsupported fields.',
        );
    }
    if (type === 'NONE') {
        return { type };
    }
    if (type === 'BASIC') {
        if (
            typeof value.username !== 'string' ||
            value.username.length < 1 ||
            value.username.length > 256 ||
            hasControlCharacters(value.username) ||
            (value.password !== undefined &&
            (typeof value.password !== 'string' ||
                value.password.length < 1 ||
                value.password.length > 4096 ||
                hasControlCharacters(value.password)))
        ) {
            throw new TestValidationError(
                'INVALID_TEST_AUTHENTICATION',
                'Basic authentication requires a username and a password no longer than 4096 characters.',
            );
        }
        return { type, username: value.username, password: value.password };
    }
    if (type === 'BEARER') {
        if (value.token !== undefined &&
            (typeof value.token !== 'string' ||
                value.token.length < 1 ||
                value.token.length > 4096 ||
                hasControlCharacters(value.token))) {
            throw new TestValidationError(
                'INVALID_TEST_AUTHENTICATION',
                'Bearer token must be a string no longer than 4096 characters.',
            );
        }
        return { type, token: value.token };
    }
    if (
        typeof value.name !== 'string' ||
        value.name.length < 1 ||
        value.name.length > 128 ||
        !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(value.name) ||
        (value.value !== undefined &&
            (typeof value.value !== 'string' || value.value.length < 1 || value.value.length > 4096))
            || (typeof value.value === 'string' && hasControlCharacters(value.value))
    ) {
        throw new TestValidationError(
            'INVALID_TEST_AUTHENTICATION',
            'API-key authentication requires a safe header name and a value no longer than 4096 characters.',
        );
    }
    return { type, name: value.name, value: value.value };
}

function validateAssertion(value: unknown): TestAssertion {
    if (!isRecord(value) || typeof value.type !== 'string') {
        throw new TestValidationError(
            'INVALID_TEST_ASSERTIONS',
            'Each assertion must be an object with a supported type.',
        );
    }
    const keys = Object.keys(value);
    const exactKeys = (expected: string[]) =>
        keys.length === expected.length && expected.every((key) => key in value);
    const status = value.expected;

    if (
        value.type === 'STATUS_CODE' &&
        exactKeys(['type', 'operator', 'expected']) &&
        value.operator === 'EQUALS' &&
        Number.isInteger(status) &&
        typeof status === 'number' &&
        status >= 100 && status <= 599
    ) {
        return { type: 'STATUS_CODE', operator: 'EQUALS', expected: status };
    }
    if (
        value.type === 'JSON_BODY' &&
        (value.operator === 'EXISTS'
            ? exactKeys(['type', 'path', 'operator'])
            : exactKeys(['type', 'path', 'operator', 'expected'])) &&
        typeof value.path === 'string' &&
        value.path.length <= 1024 &&
        (value.path === '' || value.path.startsWith('/')) &&
        !value.path.split('/').some((segment) => /~(?![01])/.test(segment)) &&
        !SENSITIVE_INPUT_NAME.test(value.path) &&
        ['EQUALS', 'NOT_EQUALS', 'CONTAINS', 'EXISTS'].includes(String(value.operator)) &&
        (value.operator === 'EXISTS' ||
            ('expected' in value &&
                isJsonValue(value.expected) &&
                (value.operator !== 'CONTAINS' || typeof value.expected === 'string')))
    ) {
        return {
            type: 'JSON_BODY',
            path: value.path,
            operator: value.operator as 'EQUALS' | 'NOT_EQUALS' | 'CONTAINS' | 'EXISTS',
            ...(value.operator !== 'EXISTS' && { expected: value.expected }),
        };
    }
    if (
        value.type === 'RESPONSE_HEADER' &&
        (value.operator === 'EXISTS'
            ? exactKeys(['type', 'name', 'operator'])
            : exactKeys(['type', 'name', 'operator', 'expected'])) &&
        typeof value.name === 'string' &&
        /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(value.name) &&
        !SENSITIVE_INPUT_NAME.test(value.name) &&
        ['EQUALS', 'CONTAINS', 'EXISTS'].includes(String(value.operator)) &&
        (value.operator === 'EXISTS' ||
            (typeof value.expected === 'string' &&
                value.expected.length <= MAX_HEADER_VALUE_LENGTH))
    ) {
        return {
            type: 'RESPONSE_HEADER',
            name: value.name,
            operator: value.operator as 'EQUALS' | 'CONTAINS' | 'EXISTS',
            ...(value.operator !== 'EXISTS' && { expected: value.expected as string }),
        };
    }
    if (
        value.type === 'RESPONSE_TIME' &&
        exactKeys(['type', 'operator', 'expected']) &&
        value.operator === 'LESS_THAN_OR_EQUAL' &&
        typeof value.expected === 'number' &&
        Number.isInteger(value.expected) &&
        value.expected >= 0 &&
        value.expected <= MAX_TIMEOUT_MS
    ) {
        return {
            type: 'RESPONSE_TIME',
            operator: 'LESS_THAN_OR_EQUAL',
            expected: value.expected,
        };
    }
    throw new TestValidationError(
        'INVALID_TEST_ASSERTIONS',
        'Assertion fields or values are invalid for the selected assertion type.',
    );
}

function validateAssertions(value: unknown): TestAssertion[] {
    if (!Array.isArray(value) || value.length > MAX_ASSERTIONS) {
        throw new TestValidationError(
            'INVALID_TEST_ASSERTIONS',
            'Assertions must be an array containing no more than 50 assertions.',
        );
    }
    return value.map(validateAssertion);
}

export function validateTestInput(
    input: unknown,
    upstreamUrl: string,
    partial = false,
): Partial<TestInput> {
    if (!isRecord(input)) {
        throw new TestValidationError(
            'INVALID_TEST_DATA',
            'Test data must be an object.',
        );
    }
    const allowed = new Set([
        'name',
        'method',
        'url',
        'headers',
        'body',
        'authentication',
        'assertions',
        'timeoutMs',
    ]);
    if (Object.keys(input).some((key) => !allowed.has(key))) {
        throw new TestValidationError(
            'INVALID_TEST_FIELD',
            'Test data contains unsupported fields.',
        );
    }
    if (partial && Object.keys(input).length === 0) {
        throw new TestValidationError(
            'EMPTY_TEST_UPDATE',
            'At least one test field must be provided.',
        );
    }

    const result: Partial<TestInput> = {};
    if (!partial || 'name' in input) result.name = validateName(input.name);
    if (!partial || 'method' in input) result.method = validateMethod(input.method);
    if (!partial || 'url' in input) result.url = validateUrl(input.url, upstreamUrl);
    if (!partial || 'headers' in input) result.headers = validateHeaders(input.headers);
    if (!partial || 'body' in input) result.body = validateBody(input.body);
    if (!partial || 'authentication' in input) {
        result.authentication = validateAuthentication(input.authentication);
    }
    if (!partial || 'assertions' in input) {
        result.assertions = validateAssertions(input.assertions);
    }

    if ('timeoutMs' in input || !partial) {
        const timeoutMs = input.timeoutMs === undefined
            ? DEFAULT_TIMEOUT_MS
            : input.timeoutMs;
        if (
            typeof timeoutMs !== 'number' ||
            !Number.isInteger(timeoutMs) ||
            timeoutMs < 1 ||
            timeoutMs > MAX_TIMEOUT_MS
        ) {
            throw new TestValidationError(
                'INVALID_TEST_TIMEOUT',
                `Timeout must be an integer from 1 to ${MAX_TIMEOUT_MS} milliseconds.`,
            );
        }
        result.timeoutMs = timeoutMs;
    }
    return result;
}
