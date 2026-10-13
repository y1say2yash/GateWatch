import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import type { IncomingMessage, RequestOptions } from 'node:http';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';

import { decryptAuthentication } from './test-credentials.js';
import {
    areResolvedAddressesSafe,
    isDevelopmentLocalOriginAllowed,
    isNonPublicAddress,
} from './test-network-policy.js';
import type { ApiTest, TestAssertion, TestAssertionResult, TestExecutionResult } from './test-types.js';

const MAX_RESPONSE_BODY_BYTES = 256 * 1024;

export class TestApiDisabledError extends Error {
    constructor() {
        super('API is disabled or deleted.');
        this.name = 'TestApiDisabledError';
    }
}

export class TestExecutionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'TestExecutionError';
    }
}

interface ResolvedDestination {
    address: string;
    family: 4 | 6;
}

class UpstreamTimeoutError extends Error {
    constructor() {
        super('The upstream request timed out.');
        this.name = 'UpstreamTimeoutError';
    }
}

async function validateSafeDestination(
    target: URL,
    timeoutMs: number,
): Promise<ResolvedDestination> {
    if (!['http:', 'https:'].includes(target.protocol)) {
        throw new TestExecutionError('Only HTTP and HTTPS targets are supported.');
    }
    if (target.username || target.password || target.hash) {
        throw new TestExecutionError('URL credentials and fragments are not allowed.');
    }

    const hostname = target.hostname.replace(/^\[|\]$/g, '');
    const localOriginAllowed = isDevelopmentLocalOriginAllowed(target);
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
        const timedOut = new Promise<never>((_resolve, reject) => {
            timeoutHandle = setTimeout(() => reject(new UpstreamTimeoutError()), timeoutMs);
        });
        const addresses = await Promise.race([
            isIP(hostname) !== 0
                ? Promise.resolve([{ address: hostname, family: isIP(hostname) }])
                : lookup(hostname, { all: true, verbatim: true }),
            timedOut,
        ]);
        if (!areResolvedAddressesSafe(
            addresses.map(({ address }) => address),
            localOriginAllowed,
        )) {
            throw new TestExecutionError('The target resolves to a prohibited destination.');
        }
        const selected = addresses[0];
        if (!selected || isNonPublicAddress(selected.address) !== localOriginAllowed) {
            throw new TestExecutionError('The target hostname could not be resolved.');
        }
        return { address: selected.address, family: selected.family as 4 | 6 };
    } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
    }
}

function responseHeadersFromMessage(response: IncomingMessage): Headers {
    const headers = new Headers();
    for (const [name, value] of Object.entries(response.headers)) {
        if (Array.isArray(value)) {
            for (const item of value) headers.append(name, item);
        } else if (typeof value === 'string') {
            headers.set(name, value);
        }
    }
    return headers;
}

function performPinnedRequest(
    target: URL,
    destination: ResolvedDestination,
    method: string,
    headers: Headers,
    body: string | undefined,
    timeoutMs: number,
): Promise<{ status: number; responseTimeMs: number; headers: Headers; body: Buffer }> {
    return new Promise((resolve, reject) => {
        let settled = false;
        const startedAt = Date.now();
        const requestHeaders = Object.fromEntries(headers.entries());
        requestHeaders.host = target.host;
        requestHeaders['accept-encoding'] = 'identity';

        const options: RequestOptions = {
            protocol: target.protocol,
            hostname: destination.address,
            family: destination.family,
            port: target.port ? Number(target.port) : undefined,
            method,
            path: `${target.pathname}${target.search}`,
            headers: requestHeaders,
        };
        const receiveResponse = (response: IncomingMessage): void => {
            const status = response.statusCode ?? 0;
            const responseHeaders = responseHeadersFromMessage(response);
            const redirect = status >= 300 && status < 400;
            const contentLength = Number(response.headers['content-length'] ?? 0);
            if (redirect) {
                response.destroy();
                finishWithError(new TestExecutionError('Redirects are disabled by GateWatch.'));
                return;
            }
            if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BODY_BYTES) {
                response.destroy();
                finishWithError(new TestExecutionError(
                    `Response exceeded the ${MAX_RESPONSE_BODY_BYTES} byte limit.`,
                ));
                return;
            }

            const chunks: Buffer[] = [];
            let totalSize = 0;
            response.on('data', (chunk: Buffer | string) => {
                const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                totalSize += bytes.byteLength;
                if (totalSize > MAX_RESPONSE_BODY_BYTES) {
                    response.destroy();
                    finishWithError(new TestExecutionError(
                        `Response exceeded the ${MAX_RESPONSE_BODY_BYTES} byte limit.`,
                    ));
                    return;
                }
                chunks.push(bytes);
            });

            const responseTimeMs = Date.now() - startedAt;
            response.on('end', () => {
                if (settled) return;
                settled = true;
                if (timer) clearTimeout(timer);
                resolve({
                    status,
                    responseTimeMs,
                    headers: responseHeaders,
                    body: Buffer.concat(chunks),
                });
            });
            response.on('error', (error) => finishWithError(error));
        };

        const upstreamRequest = target.protocol === 'https:'
            ? httpsRequest({
                ...options,
                servername: isIP(target.hostname.replace(/^\[|\]$/g, '')) === 0
                    ? target.hostname
                    : undefined,
            }, receiveResponse)
            : httpRequest(options, receiveResponse);

        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            upstreamRequest.destroy();
            reject(new UpstreamTimeoutError());
        }, timeoutMs);
        const finishWithError = (error: Error): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(error);
        };
        upstreamRequest.on('error', (error) => finishWithError(error));
        upstreamRequest.end(body);
    });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonPointerGet(value: unknown, path: string): unknown {
    if (path === '') {
        return value;
    }
    let current = value;
    const segments = path.split('/').slice(1);
    for (const segment of segments) {
        const decoded = segment.replace(/~1/g, '/').replace(/~0/g, '~');
        if (Array.isArray(current) && /^\d+$/.test(decoded)) {
            current = current[Number(decoded)];
        } else if (isPlainObject(current)) {
            current = current[decoded];
        } else {
            return undefined;
        }
        if (current === undefined) {
            return undefined;
        }
    }
    return current;
}

function getSafeSummary(value: unknown): unknown {
    const sensitiveKeyPattern =
        /password|secret|token|credential|authorization|api[-_]?key|cookie|session|signature|private[-_]?key/i;

    if (typeof value === 'string') {
        return value.length > 128 ? `${value.slice(0, 128)}…` : value;
    }

    if (Array.isArray(value)) {
        return value.slice(0, 5).map((item) => getSafeSummary(item));
    }

    if (isPlainObject(value)) {
        return Object.fromEntries(
            Object.entries(value)
                .slice(0, 5)
                .map(([key, entry]) => [
                    key,
                    sensitiveKeyPattern.test(key)
                        ? '[REDACTED]'
                        : getSafeSummary(entry),
                ]),
        );
    }

    return value;
}

function buildAssertionResult(
    assertion: TestAssertion,
    pass: boolean,
    expected: unknown,
    actual: unknown,
    message: string,
): TestAssertionResult {
    const sensitiveHeader = assertion.type === 'RESPONSE_HEADER' &&
        /authorization|cookie|set-cookie|token|secret|credential|api.?key|signature/i.test(assertion.name);
    return {
        type: assertion.type,
        pass,
        expected: sensitiveHeader ? '[REDACTED]' : getSafeSummary(expected),
        actual: sensitiveHeader && actual !== null && actual !== undefined
            ? '[REDACTED]'
            : getSafeSummary(actual),
        message: sensitiveHeader ? 'Sensitive response header assertion evaluated; value redacted.' : message,
        ...(assertion.type === 'JSON_BODY' && { path: assertion.path }),
        ...(assertion.type === 'RESPONSE_HEADER' && { name: assertion.name }),
        ...(assertion.type === 'RESPONSE_TIME' && { operator: assertion.operator }),
        ...(assertion.type === 'STATUS_CODE' && { operator: assertion.operator }),
    };
}

function evaluateAssertion(
    assertion: TestAssertion,
    statusCode: number,
    responseTimeMs: number,
    body: unknown,
    headers: Headers,
): TestAssertionResult {
    if (assertion.type === 'STATUS_CODE') {
        const pass = statusCode === assertion.expected;
        return buildAssertionResult(
            assertion,
            pass,
            assertion.expected,
            statusCode,
            pass
                ? 'Status code matches the expected value.'
                : `Expected status ${assertion.expected}, got ${statusCode}.`,
        );
    }

    if (assertion.type === 'RESPONSE_TIME') {
        const pass = responseTimeMs <= assertion.expected;
        return buildAssertionResult(
            assertion,
            pass,
            assertion.expected,
            responseTimeMs,
            pass
                ? 'Response completed within the expected time.'
                : `Response took ${responseTimeMs} ms, exceeding ${assertion.expected} ms.`,
        );
    }

    if (assertion.type === 'RESPONSE_HEADER') {
        const actual = headers.get(assertion.name) ?? undefined;
        if (assertion.operator === 'EXISTS') {
            const pass = actual !== undefined;
            return buildAssertionResult(
                assertion,
                pass,
                'Header is present.',
                actual ?? null,
                pass ? `${assertion.name} was present.` : `${assertion.name} was missing.`,
            );
        }
        if (assertion.operator === 'EQUALS') {
            const pass = actual === assertion.expected;
            return buildAssertionResult(
                assertion,
                pass,
                assertion.expected,
                actual ?? null,
                pass
                    ? `Header ${assertion.name} matched the expected value.`
                    : `Header ${assertion.name} expected ${assertion.expected}, got ${actual ?? 'missing'}.`,
            );
        }
        const pass = typeof actual === 'string' && actual.includes(assertion.expected ?? '');
        return buildAssertionResult(
            assertion,
            pass,
            assertion.expected ?? '',
            actual ?? null,
            pass
                ? `Header ${assertion.name} included the expected value.`
                : `Header ${assertion.name} did not include ${assertion.expected ?? 'the expected value'}.`,
        );
    }

    const actual = jsonPointerGet(body, assertion.path);
    if (assertion.operator === 'EXISTS') {
        const pass = actual !== undefined;
        return buildAssertionResult(
            assertion,
            pass,
            'Property exists.',
            actual,
            pass ? `JSON path ${assertion.path} exists.` : `JSON path ${assertion.path} does not exist.`,
        );
    }
    if (assertion.operator === 'EQUALS') {
        const pass = JSON.stringify(actual) === JSON.stringify(assertion.expected);
        return buildAssertionResult(
            assertion,
            pass,
            assertion.expected,
            actual,
            pass
                ? `JSON path ${assertion.path} matched the expected value.`
                : `JSON path ${assertion.path} expected ${JSON.stringify(assertion.expected)}, got ${JSON.stringify(actual)}.`,
        );
    }
    if (assertion.operator === 'NOT_EQUALS') {
        const pass = !Object.is(actual, assertion.expected) && JSON.stringify(actual) !== JSON.stringify(assertion.expected);
        return buildAssertionResult(
            assertion,
            pass,
            assertion.expected,
            actual,
            pass
                ? `JSON path ${assertion.path} did not match the forbidden value.`
                : `JSON path ${assertion.path} unexpectedly matched ${JSON.stringify(assertion.expected)}.`,
        );
    }
    if (typeof actual === 'string') {
        const pass = actual.includes(String(assertion.expected ?? ''));
        return buildAssertionResult(
            assertion,
            pass,
            assertion.expected ?? '',
            actual,
            pass
                ? `JSON path ${assertion.path} contained the expected substring.`
                : `JSON path ${assertion.path} did not contain ${JSON.stringify(assertion.expected)}.`,
        );
    }
    if (Array.isArray(actual)) {
        const pass = actual.includes(assertion.expected as never);
        return buildAssertionResult(
            assertion,
            pass,
            assertion.expected,
            actual,
            pass
                ? `JSON path ${assertion.path} contained the expected member.`
                : `JSON path ${assertion.path} did not contain ${JSON.stringify(assertion.expected)}.`,
        );
    }
    return buildAssertionResult(
        assertion,
        false,
        assertion.expected,
        actual,
        `JSON path ${assertion.path} does not support the CONTAINS operator for this value type.`,
    );
}

export async function executeOwnedTest(
    test: ApiTest,
    storedAuthentication: unknown,
): Promise<TestExecutionResult> {
    const startedAt = new Date();
    const target = new URL(test.url);
    const timeoutMs = Math.min(test.timeoutMs, 30_000);
    let destination: ResolvedDestination;

    try {
        destination = await validateSafeDestination(target, timeoutMs);
    } catch (error) {
        return {
            passed: false,
            status: 'ERROR',
            durationMs: Date.now() - startedAt.getTime(),
            responseStatus: null,
            responseTimeMs: null,
            assertions: [],
            errorMessage: error instanceof UpstreamTimeoutError
                ? `The upstream request timed out after ${timeoutMs} ms.`
                : error instanceof TestExecutionError
                    ? error.message
                    : 'The configured target is unsafe.',
        };
    }

    const requestHeaders = new Headers();
    for (const [header, value] of Object.entries(test.headers)) {
        requestHeaders.set(header, value);
    }
    requestHeaders.delete('cookie');
    requestHeaders.delete('authorization');
    requestHeaders.delete('proxy-authorization');
    requestHeaders.delete('host');

    const decryptedAuth = (() => {
        try {
            return decryptAuthentication(storedAuthentication);
        } catch {
            throw new TestExecutionError('Stored test credentials are invalid or missing.');
        }
    })();
    if (storedAuthentication !== null && storedAuthentication !== undefined && decryptedAuth === null) {
        throw new TestExecutionError('Stored test credentials are invalid or missing.');
    }
    if (decryptedAuth && decryptedAuth.type === 'BASIC') {
        const basic = Buffer.from(`${String(decryptedAuth.username)}:${String(decryptedAuth.password)}`).toString('base64');
        requestHeaders.set('Authorization', `Basic ${basic}`);
    } else if (decryptedAuth && decryptedAuth.type === 'BEARER') {
        requestHeaders.set('Authorization', `Bearer ${String(decryptedAuth.token)}`);
    } else if (decryptedAuth && decryptedAuth.type === 'API_KEY') {
        requestHeaders.set(String(decryptedAuth.name), String(decryptedAuth.value));
    }

    if (test.body !== null && test.body !== undefined) {
        requestHeaders.set('Content-Type', 'application/json');
    }

    let responseStatus: number | null = null;
    let responseTimeMs: number | null = null;
    let responseHeaders: Headers | null = null;
    let rawBody: string;

    try {
        const remainingTimeoutMs = timeoutMs - (Date.now() - startedAt.getTime());
        if (remainingTimeoutMs <= 0) {
            throw new UpstreamTimeoutError();
        }
        const response = await performPinnedRequest(
            target,
            destination,
            test.method,
            requestHeaders,
            test.body === null || test.body === undefined ? undefined : JSON.stringify(test.body),
            remainingTimeoutMs,
        );
        responseStatus = response.status;
        responseTimeMs = response.responseTimeMs;
        responseHeaders = response.headers;
        rawBody = response.body.toString('utf8');
    } catch (error) {
        const errorMessage = error instanceof UpstreamTimeoutError
            ? `The upstream request timed out after ${timeoutMs} ms.`
            : error instanceof TestExecutionError
                ? error.message
                : 'The upstream request could not be completed.';
        const durationMs = Date.now() - startedAt.getTime();
        return {
            passed: false,
            status: 'ERROR',
            durationMs,
            responseStatus,
            responseTimeMs,
            assertions: [],
            errorMessage,
        };
    }

    let parsedBody: unknown = null;
    if (rawBody.length > 0) {
        try {
            parsedBody = JSON.parse(rawBody);
        } catch {
            parsedBody = rawBody;
        }
    }

    const assertions = test.assertions.map((assertion) =>
        evaluateAssertion(assertion, responseStatus ?? 0, responseTimeMs ?? 0, parsedBody, responseHeaders ?? new Headers()),
    );
    const passed = assertions.every((assertion) => assertion.pass);
    return {
        passed,
        status: passed ? 'PASSED' : 'FAILED',
        durationMs: Date.now() - startedAt.getTime(),
        responseStatus,
        responseTimeMs,
        assertions,
        errorMessage: passed ? null : 'One or more test assertions failed.',
    };
}

export async function executeTestDefinition(
    test: ApiTest,
    storedAuthentication: unknown,
): Promise<TestExecutionResult> {
    try {
        const execution = await executeOwnedTest(test, storedAuthentication);
        return execution;
    } catch {
        return {
            passed: false,
            status: 'ERROR',
            durationMs: 0,
            responseStatus: null,
            responseTimeMs: null,
            assertions: [],
            errorMessage: 'The test could not be executed because of an unexpected internal error.',
        };
    }
}

export function sanitizeTestExecutionResult(result: TestExecutionResult): Record<string, unknown> {
    return {
        passed: result.passed,
        status: result.status,
        durationMs: result.durationMs,
        responseStatus: result.responseStatus ?? null,
        responseTimeMs: result.responseTimeMs ?? null,
        assertions: result.assertions.map((assertion) => ({
            type: assertion.type,
            pass: assertion.pass,
            expected: assertion.expected ?? null,
            actual: assertion.actual ?? null,
            message: assertion.message,
            ...(assertion.path !== undefined && { path: assertion.path }),
            ...(assertion.name !== undefined && { name: assertion.name }),
            ...(assertion.operator !== undefined && { operator: assertion.operator }),
        })),
        ...(result.errorMessage !== null && result.errorMessage !== undefined && { errorMessage: result.errorMessage }),
    };
}

export function getExecutionResultForStorage(result: TestExecutionResult): Record<string, unknown> {
    return sanitizeTestExecutionResult(result);
}

export function safeResponseResultStatus(statusCode: number): number | null {
    return Number.isFinite(statusCode) ? statusCode : null;
}

export function isExecutionError(result: TestExecutionResult): boolean {
    return result.status === 'ERROR';
}

export function getExecutionStatus(result: TestExecutionResult): 'PASSED' | 'FAILED' | 'ERROR' {
    return result.status;
}

export function getExecutionDurationMs(startedAt: Date): number {
    return Date.now() - startedAt.getTime();
}

export function isUrlSafeForExecution(testUrl: string): boolean {
    try {
        const target = new URL(testUrl);
        return ['http:', 'https:'].includes(target.protocol) && !target.username && !target.password && !target.hash;
    } catch {
        return false;
    }
}

export function getResolvedAddresses(hostname: string): Promise<string[]> {
    return lookup(hostname, { all: true }).then((entries) => entries.map(({ address }) => address));
}

export function isInboundResponseValueSafe(value: unknown): boolean {
    return value !== undefined && value !== null && !Buffer.isBuffer(value);
}

export function getResponseStatusFromHeaders(headers: Headers | null): number | null {
    if (!headers) {
        return null;
    }
    const statusValue = headers.get('x-response-status');
    if (statusValue === null) {
        return null;
    }
    const parsed = Number(statusValue);
    return Number.isFinite(parsed) ? parsed : null;
}

export function getHeaderValueForAssertion(headers: Headers, name: string): string | undefined {
    return headers.get(name) ?? undefined;
}

export function getBodyForAssertion(response: Response): Promise<unknown> {
    return response.text().then((text) => {
        if (!text) {
            return null;
        }
        try {
            return JSON.parse(text);
        } catch {
            return text;
        }
    });
}
