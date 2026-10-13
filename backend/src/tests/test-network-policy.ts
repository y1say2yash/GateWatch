import { isIP } from 'node:net';

const LOCAL_HOST_SUFFIXES = [
    '.localhost',
    '.local',
    '.internal',
    '.intranet',
    '.corp',
    '.home.arpa',
    '.test',
];

function ipv4Number(address: string): number | null {
    if (isIP(address) !== 4) {
        return null;
    }
    return address.split('.').reduce((value, octet) => (value * 256) + Number(octet), 0) >>> 0;
}

function ipv6Number(address: string): bigint | null {
    const unzoned = address.toLowerCase().split('%')[0];
    let normalized = unzoned;
    if (normalized.includes('.')) {
        const separator = normalized.lastIndexOf(':');
        const tail = normalized.slice(separator + 1);
        const ipv4 = ipv4Number(tail);
        if (ipv4 === null) {
            return null;
        }
        normalized = `${normalized.slice(0, separator)}:${(ipv4 >>> 16).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
    }

    const halves = normalized.split('::');
    if (halves.length > 2) {
        return null;
    }
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    const omitted = 8 - left.length - right.length;
    if ((halves.length === 1 && omitted !== 0) || (halves.length === 2 && omitted < 1)) {
        return null;
    }
    const groups = [...left, ...Array(Math.max(omitted, 0)).fill('0'), ...right];
    if (groups.length !== 8 || groups.some((group) => !/^[\da-f]{1,4}$/.test(group))) {
        return null;
    }
    return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n);
}

function isIpv4Public(address: string): boolean {
    const value = ipv4Number(address);
    if (value === null) {
        return false;
    }
    const first = value >>> 24;
    const second = (value >>> 16) & 0xff;
    const third = (value >>> 8) & 0xff;
    return !(
        first === 0 ||
        first === 10 ||
        first === 127 ||
        (first === 100 && second >= 64 && second <= 127) ||
        (first === 169 && second === 254) ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 0) ||
        (first === 192 && second === 2) ||
        (first === 192 && second === 88 && third === 99) ||
        (first === 192 && second === 168) ||
        (first === 198 && (second === 18 || second === 19)) ||
        (first === 198 && second === 51 && third === 100) ||
        (first === 203 && second === 0 && third === 113) ||
        first >= 224
    );
}

export function isNonPublicAddress(address: string): boolean {
    const family = isIP(address.split('%')[0]);
    if (family === 4) {
        return !isIpv4Public(address);
    }
    if (family !== 6) {
        return true;
    }

    const value = ipv6Number(address);
    if (value === null) {
        return true;
    }

    const ipv4MappedPrefix = value >> 32n;
    if (ipv4MappedPrefix === 0xffffn) {
        const embeddedIpv4 = Number(value & 0xffffffffn);
        const mappedAddress = [
            (embeddedIpv4 >>> 24) & 0xff,
            (embeddedIpv4 >>> 16) & 0xff,
            (embeddedIpv4 >>> 8) & 0xff,
            embeddedIpv4 & 0xff,
        ].join('.');
        return !isIpv4Public(mappedAddress);
    }

    const isGlobalUnicast = (value >> 125n) === 1n;
    const isDocumentationOrSpecial2001 = (value >> 105n) === BigInt('0x100080');
    const isDocumentation2001Db8 = (value >> 96n) === 0x20010db8n;
    const isSixToFour = (value >> 112n) === 0x2002n;
    const isDocumentation3fff = (value >> 108n) === 0x3fff0n;
    return !isGlobalUnicast ||
        isDocumentationOrSpecial2001 ||
        isDocumentation2001Db8 ||
        isSixToFour ||
        isDocumentation3fff;
}

export function isLocalHostname(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (isIP(host) !== 0) {
        return isNonPublicAddress(host);
    }
    return host === 'localhost' ||
        !host.includes('.') ||
        LOCAL_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix)) ||
        host === 'host.docker.internal' ||
        host === 'gateway.docker.internal' ||
        host === 'host.containers.internal' ||
        host === 'metadata' ||
        host === 'metadata.google.internal';
}

export function isDevelopmentLocalOriginAllowed(target: URL): boolean {
    if (!['development', 'test'].includes(process.env.NODE_ENV ?? '') || !isLocalHostname(target.hostname)) {
        return false;
    }

    return (process.env.TEST_LOCAL_ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((origin) => origin.trim())
        .some((origin) => {
            if (!origin) {
                return false;
            }
            try {
                const allowed = new URL(origin);
                return allowed.origin === origin &&
                    ['http:', 'https:'].includes(allowed.protocol) &&
                    !allowed.username &&
                    !allowed.password &&
                    !allowed.search &&
                    !allowed.hash &&
                    allowed.origin === target.origin;
            } catch {
                return false;
            }
        });
}

export function areResolvedAddressesSafe(
    addresses: readonly string[],
    localOriginAllowed: boolean,
): boolean {
    if (addresses.length === 0 ||
        addresses.some((address) => isIP(address.split('%')[0]) === 0)) {
        return false;
    }
    const classification = addresses.map(isNonPublicAddress);
    if (classification.some((isNonPublic) => isNonPublic) &&
        classification.some((isNonPublic) => !isNonPublic)) {
        return false;
    }
    return localOriginAllowed
        ? classification.every(Boolean)
        : classification.every((isNonPublic) => !isNonPublic);
}
