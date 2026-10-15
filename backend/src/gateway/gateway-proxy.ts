import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';

import type { Request, Response } from 'express';

import type { Api } from '../apis/api-types.js';
import type { ApiRoute } from '../routes/route-types.js';
import {
    areResolvedAddressesSafe,
    isDevelopmentLocalOriginAllowed,
    isNonPublicAddress,
} from '../tests/test-network-policy.js';

const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024;
const MAX_RESPONSE_BODY_BYTES = 10 * 1024 * 1024;

const DEFAULT_UPSTREAM_TIMEOUT_MS = 30_000;
const MAX_UPSTREAM_TIMEOUT_MS = 60_000;

const HOP_BY_HOP_HEADERS = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
]);

export class UpstreamConnectionError extends Error {
    constructor() {
        super('Failed to connect to upstream API.');
        this.name = 'UpstreamConnectionError';
    }
}

export class UpstreamTimeoutError extends Error {
    constructor() {
        super('Upstream API request timed out.');
        this.name = 'UpstreamTimeoutError';
    }
}

export class RequestBodyTooLargeError extends Error {
    constructor() {
        super('Request body exceeds the maximum allowed size.');
        this.name = 'RequestBodyTooLargeError';
    }
}

export class UpstreamResponseTooLargeError extends Error {
    constructor() {
        super('Upstream response exceeds the maximum allowed size.');
        this.name = 'UpstreamResponseTooLargeError';
    }
}

interface ResolvedUpstream {
    address: string;
    family: 4 | 6;
}

function getUpstreamTimeout(): number {
    const configured = Number(
        process.env.GATEWAY_UPSTREAM_TIMEOUT_MS ??
        DEFAULT_UPSTREAM_TIMEOUT_MS,
    );

    if (!Number.isFinite(configured) || configured <= 0) {
        return DEFAULT_UPSTREAM_TIMEOUT_MS;
    }

    return Math.min(configured, MAX_UPSTREAM_TIMEOUT_MS);
}

function getRemainingPath(
    requestPath: string,
    routePrefix: string,
): string {
    if (routePrefix === '/') {
        return requestPath || '/';
    }

    if (requestPath === routePrefix) {
        return '/';
    }

    return requestPath.slice(routePrefix.length) || '/';
}

function getQueryString(request: Request): string {
    const originalUrl = request.originalUrl || request.url;

    const questionMarkIndex = originalUrl.indexOf('?');

    if (questionMarkIndex === -1) {
        return '';
    }

    return originalUrl.slice(questionMarkIndex);
}

function buildUpstreamTarget(
    api: Api,
    route: ApiRoute,
    requestPath: string,
    queryString: string,
): URL {
    const upstreamUrl = new URL(api.upstreamUrl);

    const remainingPath = getRemainingPath(
        requestPath,
        route.pathPrefix,
    );

    const basePath =
        api.upstreamBasePath?.trim() || '';

    const normalizedBasePath =
        basePath === '/'
            ? ''
            : basePath.replace(/\/+$/, '');

    const normalizedRemainingPath =
        remainingPath === '/'
            ? '/'
            : `/${remainingPath.replace(/^\/+/, '')}`;

    const combinedPath =
        `${normalizedBasePath}${normalizedRemainingPath}`;

    upstreamUrl.pathname =
        combinedPath === ''
            ? '/'
            : combinedPath;

    upstreamUrl.search = queryString;

    return upstreamUrl;
}

export async function resolveSafeUpstream(
    target: URL,
    lookupAddresses: (
        hostname: string,
    ) => Promise<readonly { address: string; family: number }[]> = async (hostname) =>
        dnsLookup(hostname, { all: true, verbatim: true }),
): Promise<ResolvedUpstream> {
    if (!['http:', 'https:'].includes(target.protocol) ||
        target.username ||
        target.password ||
        target.hash) {
        throw new UpstreamConnectionError();
    }

    const hostname = target.hostname.replace(/^\[|\]$/g, '');
    const localOriginAllowed = isDevelopmentLocalOriginAllowed(target);
    const timeoutMs = Math.min(getUpstreamTimeout(), 5_000);
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
        const timedOut = new Promise<never>((_resolve, reject) => {
            timeoutHandle = setTimeout(() => reject(new UpstreamTimeoutError()), timeoutMs);
        });
        const addresses = await Promise.race([
            isIP(hostname) !== 0
                ? Promise.resolve([{ address: hostname, family: isIP(hostname) }])
                : lookupAddresses(hostname),
            timedOut,
        ]);
        if (!areResolvedAddressesSafe(
            addresses.map(({ address }) => address),
            localOriginAllowed,
        )) {
            throw new UpstreamConnectionError();
        }
        const selected = addresses[0];
        if (!selected || isNonPublicAddress(selected.address) !== localOriginAllowed) {
            throw new UpstreamConnectionError();
        }
        return { address: selected.address, family: selected.family as 4 | 6 };
    } catch (error) {
        if (error instanceof UpstreamTimeoutError || error instanceof UpstreamConnectionError) {
            throw error;
        }
        throw new UpstreamConnectionError();
    } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
    }
}

function copyRequestHeaders(
    request: Request,
    target: URL,
): Record<string, string | string[]> {
    const headers: Record<string, string | string[]> = {};

    for (const [name, value] of Object.entries(request.headers)) {
        const lowerName = name.toLowerCase();

        if (
            HOP_BY_HOP_HEADERS.has(lowerName) ||
            lowerName === 'host' ||
            lowerName === 'x-request-id' ||
            lowerName === 'x-api-key'
        ) {
            continue;
        }

        if (value !== undefined) {
            headers[name] = value;
        }
    }

    headers.host = target.host;

    const forwardedFor = request.headers['x-forwarded-for'];
    const clientIp =
        request.ip ||
        request.socket.remoteAddress ||
        '';

    if (forwardedFor) {
        headers['x-forwarded-for'] =
            `${forwardedFor}, ${clientIp}`;
    } else {
        headers['x-forwarded-for'] = clientIp;
    }

    headers['x-forwarded-proto'] =
        request.headers['x-forwarded-proto'] ??
        request.protocol;

    return headers;
}

function copyResponseHeaders(
    response: Response,
    headers: http.IncomingHttpHeaders,
): void {
    for (const [name, value] of Object.entries(headers)) {
        const lowerName = name.toLowerCase();

        if (
            HOP_BY_HOP_HEADERS.has(lowerName) ||
            lowerName === 'x-request-id' ||
            lowerName === 'x-content-type-options' ||
            lowerName === 'x-frame-options' ||
            lowerName === 'referrer-policy' ||
            lowerName === 'permissions-policy' ||
            lowerName === 'cross-origin-resource-policy' ||
            value === undefined
        ) {
            continue;
        }

        response.setHeader(name, value);
    }
}

function getContentLength(
    headers: http.IncomingHttpHeaders,
): number | null {
    const value = headers['content-length'];

    if (!value) {
        return null;
    }

    const length = Number(value);

    return Number.isFinite(length) && length >= 0
        ? length
        : null;
}

function readUnknownLengthRequestBody(
    request: Request,
): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let bytesRead = 0;
        let oversized = false;

        const cleanup = (): void => {
            request.removeListener('data', onData);
            request.removeListener('end', onEnd);
            request.removeListener('error', onError);
            request.removeListener('aborted', onAborted);
        };
        const onData = (chunk: Buffer): void => {
            if (oversized) return;
            bytesRead += chunk.length;
            if (bytesRead > MAX_REQUEST_BODY_BYTES) {
                oversized = true;
                chunks.length = 0;
                reject(new RequestBodyTooLargeError());
                request.resume();
                return;
            }
            chunks.push(chunk);
        };
        const onEnd = (): void => {
            cleanup();
            if (!oversized) resolve(Buffer.concat(chunks, bytesRead));
        };
        const onError = (error: Error): void => {
            cleanup();
            if (!oversized) reject(error);
        };
        const onAborted = (): void => {
            cleanup();
            if (!oversized) reject(new UpstreamConnectionError());
        };

        request.on('data', onData);
        request.once('end', onEnd);
        request.once('error', onError);
        request.once('aborted', onAborted);
    });
}

export async function proxyGatewayRequest(
    request: Request,
    response: Response,
    api: Api,
    route: ApiRoute,
    requestPath: string,
): Promise<void> {
    const target = buildUpstreamTarget(
        api,
        route,
        requestPath,
        getQueryString(request),
    );

    const contentLengthHeader = request.headers['content-length'];
    const requestContentLength = Number(contentLengthHeader ?? 0);

    if (
        Number.isFinite(requestContentLength) &&
        requestContentLength > MAX_REQUEST_BODY_BYTES
    ) {
        throw new RequestBodyTooLargeError();
    }

    const bufferedRequestBody = contentLengthHeader === undefined
        ? await readUnknownLengthRequestBody(request)
        : null;
    const destination = await resolveSafeUpstream(target);

    const transport =
        target.protocol === 'https:'
            ? https
            : http;

    await new Promise<void>((resolve, reject) => {
        let requestBodyBytes = 0;
        let responseBodyBytes = 0;
        let settled = false;

        const finishResolve = () => {
            if (!settled) {
                settled = true;
                resolve();
            }
        };

        const finishReject = (error: Error) => {
            if (!settled) {
                settled = true;
                reject(error);
            }
        };

        const hostname = target.hostname.replace(/^\[|\]$/g, '');
        const upstreamOptions: http.RequestOptions = {
            protocol: target.protocol,
            hostname: destination.address,
            family: destination.family,
            port: target.port ? Number(target.port) : undefined,
            method: request.method,
            path: `${target.pathname}${target.search}`,
            headers: copyRequestHeaders(request, target),
            timeout: getUpstreamTimeout(),
            ...(target.protocol === 'https:' && isIP(hostname) === 0
                ? { servername: hostname }
                : {}),
        };
        const upstreamRequest = transport.request(
            upstreamOptions,
            (upstreamResponse) => {
                const contentLength =
                    getContentLength(
                        upstreamResponse.headers,
                    );

                if (
                    contentLength !== null &&
                    contentLength >
                    MAX_RESPONSE_BODY_BYTES
                ) {
                    upstreamResponse.destroy();

                    finishReject(
                        new UpstreamResponseTooLargeError(),
                    );

                    return;
                }

                response.status(
                    upstreamResponse.statusCode ?? 502,
                );

                copyResponseHeaders(
                    response,
                    upstreamResponse.headers,
                );

                upstreamResponse.on(
                    'data',
                    (chunk: Buffer) => {
                        responseBodyBytes += chunk.length;

                        if (
                            responseBodyBytes >
                            MAX_RESPONSE_BODY_BYTES
                        ) {
                            upstreamResponse.destroy();

                            if (!response.headersSent) {
                                finishReject(
                                    new UpstreamResponseTooLargeError(),
                                );
                            } else {
                                response.destroy();
                            }

                            return;
                        }

                        response.write(chunk);
                    },
                );

                upstreamResponse.on(
                    'end',
                    () => {
                        response.end();
                        finishResolve();
                    },
                );

                upstreamResponse.on(
                    'error',
                    (error) => {
                        finishReject(error);
                    },
                );
            },
        );

        upstreamRequest.on(
            'timeout',
            () => {
                upstreamRequest.destroy(
                    new UpstreamTimeoutError(),
                );
            },
        );

        upstreamRequest.on(
            'error',
            (error) => {
                if (
                    error instanceof
                    UpstreamTimeoutError
                ) {
                    finishReject(error);
                    return;
                }

                finishReject(
                    new UpstreamConnectionError(),
                );
            },
        );

        if (bufferedRequestBody !== null) {
            if (bufferedRequestBody.length > 0) {
                upstreamRequest.write(bufferedRequestBody);
            }
            upstreamRequest.end();
        } else {
            request.on(
                'data',
                (chunk: Buffer) => {
                    if (settled) {
                        return;
                    }
                    requestBodyBytes += chunk.length;

                    if (
                        requestBodyBytes >
                        MAX_REQUEST_BODY_BYTES
                    ) {
                        upstreamRequest.destroy();
                        finishReject(
                            new RequestBodyTooLargeError(),
                        );
                        request.resume();
                        return;
                    }

                    upstreamRequest.write(chunk);
                },
            );

            request.on(
                'end',
                () => {
                    upstreamRequest.end();
                },
            );

            request.on(
                'error',
                (error) => {
                    upstreamRequest.destroy();
                    finishReject(error);
                },
            );
        }
    });
}