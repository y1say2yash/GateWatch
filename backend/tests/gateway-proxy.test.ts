import assert from 'node:assert/strict';
import express from 'express';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';

import type { Api } from '../src/apis/api-types.js';
import type { ApiRoute } from '../src/routes/route-types.js';
import {
    proxyGatewayRequest,
    RequestBodyTooLargeError,
    resolveSafeUpstream,
    UpstreamConnectionError,
} from '../src/gateway/gateway-proxy.js';

const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024;
let upstream: Server;
let gateway: Server;
let gatewayPort: number;
let upstreamPort: number;
let upstreamRequests = 0;
const priorNodeEnv = process.env.NODE_ENV;
const priorAllowedOrigins = process.env.TEST_LOCAL_ALLOWED_ORIGINS;

function listen(server: Server): Promise<number> {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            resolve((server.address() as AddressInfo).port);
        });
    });
}

before(async () => {
    upstream = createServer((_request, response) => {
        upstreamRequests += 1;
        response.end('unexpected upstream request');
    });
    upstreamPort = await listen(upstream);
    process.env.NODE_ENV = 'test';
    process.env.TEST_LOCAL_ALLOWED_ORIGINS = `http://127.0.0.1:${upstreamPort}`;

    const app = express();
    const api = {
        upstreamUrl: `http://127.0.0.1:${upstreamPort}`,
        upstreamBasePath: null,
    } as Api;
    const route = { pathPrefix: '/', method: 'POST' } as ApiRoute;
    app.post('/proxy', async (request, response) => {
        try {
            await proxyGatewayRequest(request, response, api, route, '/');
        } catch (error) {
            response.status(error instanceof RequestBodyTooLargeError ? 413 : 502).json({
                error: error instanceof RequestBodyTooLargeError ? 'REQUEST_BODY_TOO_LARGE' : 'PROXY_FAILED',
            });
        }
    });
    app.post('/private/:destination', async (request, response) => {
        const destination = request.params.destination;
        const upstreamUrl = destination.includes(':')
            ? `http://[${destination}]`
            : `http://${destination}`;
        try {
            await proxyGatewayRequest(
                request,
                response,
                { ...api, upstreamUrl },
                route,
                '/',
            );
        } catch {
            response.status(502).json({ error: 'UPSTREAM_CONNECTION_FAILED' });
        }
    });
    gateway = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => gateway.once('listening', resolve));
    gatewayPort = (gateway.address() as AddressInfo).port;
});

after(async () => {
    for (const server of [gateway, upstream]) {
        if (server?.listening) {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    }
    if (priorNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = priorNodeEnv;
    if (priorAllowedOrigins === undefined) delete process.env.TEST_LOCAL_ALLOWED_ORIGINS;
    else process.env.TEST_LOCAL_ALLOWED_ORIGINS = priorAllowedOrigins;
});

test('returns a structured 413 when a chunked request exceeds the gateway body cap', async () => {
    upstreamRequests = 0;
    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const outgoing = httpRequest({
            host: '127.0.0.1',
            port: gatewayPort,
            path: '/proxy',
            method: 'POST',
            headers: { 'transfer-encoding': 'chunked' },
        }, (incoming) => {
            let body = '';
            incoming.setEncoding('utf8');
            incoming.on('data', (chunk: string) => { body += chunk; });
            incoming.on('end', () => resolve({
                status: incoming.statusCode ?? 0,
                body,
            }));
        });
        outgoing.on('error', reject);
        const chunk = Buffer.alloc(1024 * 1024, 65);
        for (let sent = 0; sent <= MAX_REQUEST_BODY_BYTES; sent += chunk.length) {
            outgoing.write(chunk);
        }
        outgoing.end();
    });

    assert.equal(response.status, 413);
    assert.deepEqual(JSON.parse(response.body), { error: 'REQUEST_BODY_TOO_LARGE' });
    assert.equal(upstreamRequests, 0);
});

test('blocks private and metadata destinations before opening the upstream connection', async () => {
    const priorNodeEnv = process.env.NODE_ENV;
    const priorAllowedOrigins = process.env.TEST_LOCAL_ALLOWED_ORIGINS;
    process.env.NODE_ENV = 'production';
    delete process.env.TEST_LOCAL_ALLOWED_ORIGINS;
    upstreamRequests = 0;
    try {
        for (const address of [
            '127.0.0.1',
            '10.0.0.8',
            '169.254.169.254',
            '::1',
            'fe80::1',
        ]) {
            const encodedAddress = address.replaceAll(':', '%3A');
            const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
                const outgoing = httpRequest({
                    host: '127.0.0.1',
                    port: gatewayPort,
                    path: `/private/${encodedAddress}`,
                    method: 'POST',
                }, (incoming) => {
                    let body = '';
                    incoming.setEncoding('utf8');
                    incoming.on('data', (chunk: string) => { body += chunk; });
                    incoming.on('end', () => resolve({
                        status: incoming.statusCode ?? 0,
                        body,
                    }));
                });
                outgoing.on('error', reject);
                outgoing.end();
            });
            assert.equal(response.status, 502, address);
            assert.deepEqual(
                JSON.parse(response.body),
                { error: 'UPSTREAM_CONNECTION_FAILED' },
                address,
            );
            assert.equal(upstreamRequests, 0, address);
        }
    } finally {
        if (priorNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = priorNodeEnv;
        if (priorAllowedOrigins === undefined) delete process.env.TEST_LOCAL_ALLOWED_ORIGINS;
        else process.env.TEST_LOCAL_ALLOWED_ORIGINS = priorAllowedOrigins;
    }
});

test('rejects mixed public/private DNS answers before opening an upstream connection', async () => {
    const priorNodeEnv = process.env.NODE_ENV;
    const priorAllowedOrigins = process.env.TEST_LOCAL_ALLOWED_ORIGINS;
    process.env.NODE_ENV = 'production';
    delete process.env.TEST_LOCAL_ALLOWED_ORIGINS;
    try {
        await assert.rejects(
            resolveSafeUpstream(
                new URL('http://api.example.com/'),
                async () => [
                    { address: '8.8.8.8', family: 4 },
                    { address: '169.254.169.254', family: 4 },
                ],
            ),
            UpstreamConnectionError,
        );
        assert.equal(upstreamRequests, 0);
    } finally {
        if (priorNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = priorNodeEnv;
        if (priorAllowedOrigins === undefined) delete process.env.TEST_LOCAL_ALLOWED_ORIGINS;
        else process.env.TEST_LOCAL_ALLOWED_ORIGINS = priorAllowedOrigins;
    }
});

test('resolves once and returns the validated address to pin against DNS rebinding', async () => {
    const priorNodeEnv = process.env.NODE_ENV;
    const priorAllowedOrigins = process.env.TEST_LOCAL_ALLOWED_ORIGINS;
    process.env.NODE_ENV = 'production';
    delete process.env.TEST_LOCAL_ALLOWED_ORIGINS;
    let lookupCount = 0;
    try {
        const destination = await resolveSafeUpstream(
            new URL('http://api.example.com/'),
            async () => {
                lookupCount += 1;
                return lookupCount === 1
                    ? [{ address: '8.8.8.8', family: 4 }]
                    : [{ address: '169.254.169.254', family: 4 }];
            },
        );
        assert.deepEqual(destination, { address: '8.8.8.8', family: 4 });
        assert.equal(lookupCount, 1);
        assert.equal(upstreamRequests, 0);
    } finally {
        if (priorNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = priorNodeEnv;
        if (priorAllowedOrigins === undefined) delete process.env.TEST_LOCAL_ALLOWED_ORIGINS;
        else process.env.TEST_LOCAL_ALLOWED_ORIGINS = priorAllowedOrigins;
    }
});
