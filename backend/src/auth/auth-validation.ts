export function validateOAuthCallback(
    code: string | undefined,
    state: string | undefined,
): void {
    if (!code) {
        throw new Error('GitHub OAuth authorization code is missing.');
    }

    if (!state) {
        throw new Error('GitHub OAuth state is missing.');
    }
}