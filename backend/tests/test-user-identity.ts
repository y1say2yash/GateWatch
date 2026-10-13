import { randomBytes } from 'node:crypto';

const MAX_POSTGRES_BIGINT = (1n << 63n) - 1n;
let nextGithubId =
    BigInt(`0x${randomBytes(8).toString('hex')}`) & MAX_POSTGRES_BIGINT;
if (nextGithubId === 0n) {
    nextGithubId = 1n;
}

export function nextTestGithubId(): string {
    const allocated = nextGithubId;
    nextGithubId = allocated === MAX_POSTGRES_BIGINT ? 1n : allocated + 1n;
    return allocated.toString();
}
