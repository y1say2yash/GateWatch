
export interface ApiKey {
    id: string;
    apiId: string;
    name: string;
    keyPrefix: string;
    lastUsedAt: string | null;
    createdAt: string;
    revokedAt: string | null;
}

export interface CreateApiKeyInput {
    name: string;
}

export interface CreatedApiKey {
    apiKey: ApiKey;
    key: string;
}
