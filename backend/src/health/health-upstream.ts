import { lookup } from 'node:dns/promises';
import { request as httpRequest, type RequestOptions } from 'node:http';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';

import {
    areResolvedAddressesSafe,
    isDevelopmentLocalOriginAllowed,
    isNonPublicAddress,
} from '../tests/test-network-policy.js';

export interface ResolvedHealthCheckTarget {
    address: string;
    family: 4 | 6;
}

type AddressLookup = (
    hostname: string,
) => Promise<readonly { address: string; family: number }[]>;

type PinnedRequest = (
    target: URL,
    destination: ResolvedHealthCheckTarget,
    signal: AbortSignal,
) => Promise<number>;

export class HealthCheckRequestTimeoutError extends Error {
    constructor() {
        super('Health-check attempt timed out.');
        this.name = 'HealthCheckRequestTimeoutError';
    }
}

export class UnsafeHealthCheckTargetError extends Error {
    constructor() {
        super('The configured health-check target is unsafe.');
        this.name = 'UnsafeHealthCheckTargetError';
    }
}

export async function resolveSafeHealthCheckTarget(
    target: URL,
    lookupAddresses: AddressLookup = async (hostname) =>
        lookup(hostname, { all: true, verbatim: true }),
): Promise<ResolvedHealthCheckTarget> {
    if (!['http:', 'https:'].includes(target.protocol) ||
        target.username || target.password || target.hash) {
        throw new UnsafeHealthCheckTargetError();
    }

    const hostname = target.hostname.replace(/^\[|\]$/g, '');
    const localOriginAllowed = isDevelopmentLocalOriginAllowed(target);
    const addresses = isIP(hostname) !== 0
        ? [{ address: hostname, family: isIP(hostname) }]
        : await lookupAddresses(hostname);
    if (!areResolvedAddressesSafe(
        addresses.map(({ address }) => address),
        localOriginAllowed,
    )) {
        throw new UnsafeHealthCheckTargetError();
    }

    const selected = addresses[0];
    if (!selected || isNonPublicAddress(selected.address) !== localOriginAllowed) {
        throw new UnsafeHealthCheckTargetError();
    }
    return {
        address: selected.address,
        family: selected.family as 4 | 6,
    };
}

function performPinnedRequest(
    target: URL,
    destination: ResolvedHealthCheckTarget,
    signal: AbortSignal,
): Promise<number> {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error, status?: number): void => {
            if (settled) return;
            settled = true;
            signal.removeEventListener('abort', abortRequest);
            if (error) reject(error);
            else resolve(status ?? 0);
        };
        const requestRef: { current?: ReturnType<typeof httpRequest> } = {};
        const abortRequest = (): void => {
            requestRef.current?.destroy(new HealthCheckRequestTimeoutError());
            finish(new HealthCheckRequestTimeoutError());
        };
        if (signal.aborted) {
            abortRequest();
            return;
        }

        const hostname = target.hostname.replace(/^\[|\]$/g, '');
        const options: RequestOptions = {
            protocol: target.protocol,
            hostname: destination.address,
            family: destination.family,
            port: target.port ? Number(target.port) : undefined,
            method: 'GET',
            path: `${target.pathname}${target.search}`,
            headers: {
                accept: '*/*',
                'user-agent': 'GateWatch-Health-Check',
                host: target.host,
            },
            ...(target.protocol === 'https:' && isIP(hostname) === 0
                ? { servername: hostname }
                : {}),
        };
        const transport = target.protocol === 'https:' ? httpsRequest : httpRequest;
        const request = transport(options, (response) => {
            const status = response.statusCode ?? 0;
            response.destroy();
            finish(undefined, status);
        });
        requestRef.current = request;
        signal.addEventListener('abort', abortRequest, { once: true });
        request.on('error', (error) => finish(error));
        request.end();
    });
}

export async function performHealthCheckRequest(
    target: URL,
    timeoutMs: number,
    resolveTarget: (
        url: URL,
        signal: AbortSignal,
    ) => Promise<ResolvedHealthCheckTarget> = async (url, signal) => {
        const resolution = resolveSafeHealthCheckTarget(url);
        const aborted = new Promise<never>((_resolve, reject) => {
            if (signal.aborted) {
                reject(new HealthCheckRequestTimeoutError());
                return;
            }
            signal.addEventListener(
                'abort',
                () => reject(new HealthCheckRequestTimeoutError()),
                { once: true },
            );
        });
        return Promise.race([resolution, aborted]);
    },
    requestPinned: PinnedRequest = performPinnedRequest,
): Promise<number> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const destination = await resolveTarget(target, controller.signal);
        if (controller.signal.aborted) throw new HealthCheckRequestTimeoutError();
        return await requestPinned(target, destination, controller.signal);
    } catch (error) {
        if (controller.signal.aborted) throw new HealthCheckRequestTimeoutError();
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}
