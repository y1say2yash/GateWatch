export type TestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
export type TestAuthenticationType = 'NONE' | 'BASIC' | 'BEARER' | 'API_KEY';
export type TestStatusOperator = 'EQUALS';
export type JsonBodyOperator = 'EQUALS' | 'NOT_EQUALS' | 'CONTAINS' | 'EXISTS';
export type ResponseHeaderOperator = 'EQUALS' | 'CONTAINS' | 'EXISTS';
export type TestAssertion =
  | { type: 'STATUS_CODE'; operator: TestStatusOperator; expected: number }
  | { type: 'JSON_BODY'; path: string; operator: JsonBodyOperator; expected?: unknown }
  | { type: 'RESPONSE_HEADER'; name: string; operator: ResponseHeaderOperator; expected?: string }
  | { type: 'RESPONSE_TIME'; operator: 'LESS_THAN_OR_EQUAL'; expected: number };

export interface TestAuthentication {
  type: TestAuthenticationType;
  credentialConfigured: boolean;
}

export interface ApiTestDefinition {
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

export interface AssertionResult {
  type: TestAssertion['type'];
  pass: boolean;
  expected: unknown | null;
  actual: unknown | null;
  message: string;
  path?: string;
  name?: string;
  operator?: string;
}

export interface TestExecutionResult {
  id: string;
  executionId: string;
  status: 'PASSED' | 'FAILED' | 'ERROR';
  passed: boolean;
  durationMs: number;
  result: {
    passed: boolean;
    status: 'PASSED' | 'FAILED' | 'ERROR';
    durationMs: number;
    responseStatus: number | null;
    responseTimeMs: number | null;
    assertions: AssertionResult[];
    errorMessage?: string;
  };
}

export interface TestExecutionHistoryItem {
  id: string;
  testId: string;
  testName: string;
  status: 'PASSED' | 'FAILED' | 'ERROR';
  triggerType: 'MANUAL' | 'CI_CD';
  responseStatus: number | null;
  responseTimeMs: number | null;
  durationMs: number | null;
  startedAt: string;
  completedAt: string | null;
  assertions: Array<{ type: TestAssertion['type']; pass: boolean }>;
}
