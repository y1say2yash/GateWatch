export type TestMethod =
    | 'GET'
    | 'POST'
    | 'PUT'
    | 'PATCH'
    | 'DELETE'
    | 'HEAD'
    | 'OPTIONS';

export type TestAuthenticationType =
    | 'NONE'
    | 'BASIC'
    | 'BEARER'
    | 'API_KEY';

export interface TestAuthentication {
    type: TestAuthenticationType;
    username?: string;
    credentialConfigured: boolean;
}

export type TestAssertion =
    | {
        type: 'STATUS_CODE';
        operator: 'EQUALS';
        expected: number;
    }
    | {
        type: 'JSON_BODY';
        path: string;
        operator: 'EQUALS' | 'NOT_EQUALS' | 'CONTAINS' | 'EXISTS';
        expected?: unknown;
    }
    | {
        type: 'RESPONSE_HEADER';
        name: string;
        operator: 'EQUALS' | 'CONTAINS' | 'EXISTS';
        expected?: string;
    }
    | {
        type: 'RESPONSE_TIME';
        operator: 'LESS_THAN_OR_EQUAL';
        expected: number;
    };

export interface ApiTest {
    id: string;
    apiId: string;
    name: string;
    method: TestMethod;
    url: string;
    headers: Record<string, string>;
    body: unknown;
    authentication: TestAuthentication;
    assertions: TestAssertion[];
    timeoutMs: number;
    createdAt: string;
    updatedAt: string;
}

export interface TestInput {
    name: string;
    method: TestMethod;
    url: string;
    headers: Record<string, string>;
    body: unknown;
    authentication: Record<string, unknown>;
    assertions: TestAssertion[];
    timeoutMs: number;
}
