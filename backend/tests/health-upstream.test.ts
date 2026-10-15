import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';

import {
    performHealthCheckRequest,
    resolveSafeHealthCheckTarget,
    UnsafeHealthCheckTargetError,
} from '../src/health/health-upstream.js';

let server: Server;
let origin: string;
let requestsReceived = 0;
const priorNodeEnv = process.env.NODE_ENV;
const priorAllowedOrigins = process.env.TEST_LOCAL_ALLOWED_ORIGINS;

before(async () => {
    server = createServer((_request, response) => {
        requestsReceived += 1;
        response.writeHead(200);
        response.end();
    });
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address() as AddressInfo;
    origin = `http://127.0.0.1:${address.port}`;
    process.env.NODE_ENV = 'test';
    process.env.TEST_LOCAL_ALLOWED_ORIGINS = origin;
});

after(async () => {
    if (server?.listening) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (priorNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = priorNodeEnv;
    if (priorAllowedOrigins === undefined) delete process.env.TEST_LOCAL_ALLOWED_ORIGINS;
    else process.env.TEST_LOCAL_ALLOWED_ORIGINS = priorAllowedOrigins;
});

test('rejects private and special-use DNS answers for public-looking hosts', async () => {
    const priorMode = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
        for (const address of ['127.0.0.1', '169.254.169.254', '10.0.0.8', '::ffff:127.0.0.1']) {
            await assert.rejects(
                resolveSafeHealthCheckTarget(
                    new URL('http://health.example.com/ready'),
                    async () => [{ address, family: address.includes(':') ? 6 : 4 }],
                ),
                UnsafeHealthCheckTargetError,
                address,
            );
        }
        await assert.rejects(
            resolveSafeHealthCheckTarget(
                new URL('https://health.example.com/ready'),
                async () => [
                    { address: '8.8.8.8', family: 4 },
                    { address: '169.254.169.254', family: 4 },
                ],
            ),
            UnsafeHealthCheckTargetError,
            'mixed public/private DNS answers are rejected',
        );
    } finally {
        if (priorMode === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = priorMode;
    }
});

test('revalidates each attempt and never connects to a rebinding private answer', async () => {
    const priorMode = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    let lookupCount = 0;
    const connectedAddresses: string[] = [];
    const target = new URL('http://health.example.com/ready');
    const resolveAttempt = async (url: URL) =>
        resolveSafeHealthCheckTarget(url, async () => {
            lookupCount += 1;
            return lookupCount === 1
                ? [{ address: '8.8.8.8', family: 4 }]
                : [{ address: '169.254.169.254', family: 4 }];
        });
    const recordPinnedDestination = async (
        _url: URL,
        destination: { address: string; family: 4 | 6 },
    ) => {
        connectedAddresses.push(destination.address);
        return 200;
    };

    try {
        assert.equal(
            await performHealthCheckRequest(
                target,
                1_000,
                resolveAttempt,
                recordPinnedDestination,
            ),
            200,
        );
        await assert.rejects(
            performHealthCheckRequest(
                target,
                1_000,
                resolveAttempt,
                recordPinnedDestination,
            ),
            UnsafeHealthCheckTargetError,
        );
        assert.deepEqual(connectedAddresses, ['8.8.8.8']);
        assert.equal(lookupCount, 2);
    } finally {
        if (priorMode === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = priorMode;
    }
});

test('pins an allowlisted local test health check to its validated address', async () => {
    requestsReceived = 0;
    const responseStatus = await performHealthCheckRequest(new URL(`${origin}/ready`), 1_000);
    assert.equal(responseStatus, 200);
    assert.equal(requestsReceived, 1);
});
