import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';

import { executeTestDefinition } from '../src/tests/test-execution.js';
import type { ApiTest } from '../src/tests/test-types.js';

const MAX_RESPONSE_BODY_BYTES = 256 * 1024;
let upstreamServer: Server | undefined;
let origin: string;
const priorNodeEnv = process.env.NODE_ENV;
const priorAllowedOrigins = process.env.TEST_LOCAL_ALLOWED_ORIGINS;

function closeServer(server: Server | undefined): Promise<void> {
    if (!server?.listening) return Promise.resolve();
    return new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    });
}

function definition(path: string, timeoutMs = 1_000): ApiTest {
    const now = new Date().toISOString();
    return {
        id: 'network-test',
        apiId: 'network-api',
        name: 'Network test',
        method: 'GET',
        url: `${origin}${path}`,
        headers: { accept: 'application/json' },
        body: null,
        authentication: { type: 'NONE', credentialConfigured: false },
        assertions: [],
        timeoutMs,
        createdAt: now,
        updatedAt: now,
    };
}

before(async () => {
    upstreamServer = createServer((request, response) => {
        if (request.url === '/redirect') {
            response.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
            response.end();
            return;
        }
        if (request.url === '/slow') {
            const timer = setTimeout(() => {
                response.writeHead(200, { 'content-type': 'application/json' });
                response.end('{"status":"late"}');
            }, 150);
            response.on('close', () => clearTimeout(timer));
            return;
        }
        if (request.url === '/oversized') {
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(Buffer.alloc(MAX_RESPONSE_BODY_BYTES + 1, 65));
            return;
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{"status":"ok"}');
    });
    await new Promise<void>((resolve) => upstreamServer?.listen(0, '127.0.0.1', resolve));
    const address = upstreamServer.address() as AddressInfo;
    origin = `http://127.0.0.1:${address.port}`;
    process.env.NODE_ENV = 'test';
    process.env.TEST_LOCAL_ALLOWED_ORIGINS = origin;
});

after(async () => {
    await closeServer(upstreamServer);
    if (priorNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = priorNodeEnv;
    if (priorAllowedOrigins === undefined) delete process.env.TEST_LOCAL_ALLOWED_ORIGINS;
    else process.env.TEST_LOCAL_ALLOWED_ORIGINS = priorAllowedOrigins;
});

test('rejects redirects without following their destination', async () => {
    const result = await executeTestDefinition(definition('/redirect'), null);
    assert.equal(result.status, 'ERROR');
    assert.match(result.errorMessage ?? '', /redirects are disabled/i);
    assert.doesNotMatch(result.errorMessage ?? '', /169\.254\.169\.254/);
});

test('classifies an upstream timeout as an execution error and closes the slow handler', async () => {
    const result = await executeTestDefinition(definition('/slow', 30), null);
    assert.equal(result.status, 'ERROR');
    assert.match(result.errorMessage ?? '', /timed out/i);
});

test('enforces the streamed response-size limit', async () => {
    const result = await executeTestDefinition(definition('/oversized'), null);
    assert.equal(result.status, 'ERROR');
    assert.match(result.errorMessage ?? '', /response exceeded the 262144 byte limit/i);
});
