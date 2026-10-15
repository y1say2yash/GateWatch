import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { useOwnedApis } from '../features/apis/useOwnedApis';
import type {
  ApiTestDefinition,
  TestAuthenticationType,
  TestExecutionResult,
  TestMethod,
} from '../features/testing/types';
import { ApiError, apiRequest } from '../lib/api';

const testMethods: TestMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const authenticationTypes: TestAuthenticationType[] = ['NONE', 'BASIC', 'BEARER', 'API_KEY'];

interface TestDraft {
  name: string;
  method: TestMethod;
  url: string;
  headers: string;
  body: string;
  authenticationType: TestAuthenticationType;
  username: string;
  apiKeyName: string;
  credential: string;
  assertions: string;
  timeoutMs: string;
}

interface TestCollection {
  apiId: string;
  tests: ApiTestDefinition[];
}

function safeDisplayUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    const queryKeys: string[] = [];
    url.searchParams.forEach((_value, key) => queryKeys.push(key));
    for (const key of queryKeys) url.searchParams.set(key, '[hidden]');
    return url.toString();
  } catch {
    return 'URL unavailable';
  }
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${label} must contain valid JSON.`);
  }
}

function parseHeaders(value: string): Record<string, string> {
  const parsed: unknown = parseJson(value, 'Headers');
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Headers must be a JSON object with string values.');
  }
  const entries = Object.entries(parsed);
  if (entries.some(([, headerValue]) => typeof headerValue !== 'string')) {
    throw new Error('Header values must be strings.');
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function validateTestUrl(value: string, preserveExistingQuery = false): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Enter a valid absolute test URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error('Test URLs must use HTTP or HTTPS and cannot include credentials or a fragment.');
  }
  const queryKeys: string[] = [];
  url.searchParams.forEach((_value, key) => queryKeys.push(key));
  if (!preserveExistingQuery && queryKeys.some((key) => /(?:api[-_]?key|key|token|secret|password|credential|authorization)/i.test(key))) {
    throw new Error('Do not put credentials in the URL. Configure them in the Authentication section.');
  }
}

function draftFromTest(test: ApiTestDefinition): TestDraft {
  return {
    name: test.name,
    method: test.method,
    url: safeDisplayUrl(test.url),
    headers: JSON.stringify(test.headers, null, 2),
    body: JSON.stringify(test.body ?? null, null, 2),
    authenticationType: test.authentication.type,
    username: '',
    apiKeyName: '',
    credential: '',
    assertions: JSON.stringify(test.assertions, null, 2),
    timeoutMs: String(test.timeoutMs),
  };
}

const newTestDraft = (): TestDraft => ({
  name: '',
  method: 'GET',
  url: '',
  headers: '{}',
  body: 'null',
  authenticationType: 'NONE',
  username: '',
  apiKeyName: '',
  credential: '',
  assertions: '[]',
  timeoutMs: '5000',
});

export function TestingPage(): ReactElement {
  const { apis, loading: loadingApis, error: apiError, reload: reloadApis } = useOwnedApis();
  const [selectedApiIdState, setSelectedApiId] = useState('');
  const selectedApiId = apis.some((api) => api.id === selectedApiIdState)
    ? selectedApiIdState
    : apis[0]?.id ?? '';
  const selectedApi = apis.find((api) => api.id === selectedApiId);
  const [collection, setCollection] = useState<TestCollection | null>(null);
  const [loadingTests, setLoadingTests] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [editingTest, setEditingTest] = useState<ApiTestDefinition | null>(null);
  const [draft, setDraft] = useState<TestDraft>(newTestDraft);
  const [testUrlEdited, setTestUrlEdited] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingTestId, setDeletingTestId] = useState<string | null>(null);
  const [executingTestId, setExecutingTestId] = useState<string | null>(null);
  const [executionResults, setExecutionResults] = useState<Record<string, TestExecutionResult>>({});
  const [executionErrors, setExecutionErrors] = useState<Record<string, string>>({});
  const submitInProgress = useRef(false);
  const executionInProgress = useRef(false);
  const requestSequence = useRef(0);

  useEffect(() => {
    let active = true;
    const requestId = ++requestSequence.current;
    void Promise.resolve().then(async () => {
      if (!active) return;
      if (!selectedApiId) {
        setCollection(null);
        setTestError(null);
        setLoadingTests(false);
        return;
      }
      setCollection(null);
      setLoadingTests(true);
      setTestError(null);
      try {
        const tests = await apiRequest<ApiTestDefinition[]>(`/api/v1/apis/${selectedApiId}/tests`);
        if (active && requestId === requestSequence.current) setCollection({ apiId: selectedApiId, tests });
      } catch (error) {
        if (active && requestId === requestSequence.current) {
          setCollection(null);
          setTestError(error instanceof ApiError ? error.message : 'Unable to load API tests. Please try again.');
        }
      } finally {
        if (active && requestId === requestSequence.current) setLoadingTests(false);
      }
    });
    return () => {
      active = false;
      requestSequence.current += 1;
    };
  }, [selectedApiId, revision]);

  const openNewForm = (): void => {
    setEditingTest(null);
    setDraft(newTestDraft());
    setTestUrlEdited(false);
    setFormError(null);
    setFormOpen(true);
  };

  const closeForm = (): void => {
    setFormOpen(false);
    setEditingTest(null);
    setFormError(null);
    setTestUrlEdited(false);
    setDraft((current) => ({ ...current, username: '', apiKeyName: '', credential: '' }));
  };

  const openEditForm = (test: ApiTestDefinition): void => {
    setEditingTest(test);
    setDraft(draftFromTest(test));
    setTestUrlEdited(false);
    setFormError(null);
    setFormOpen(true);
  };

  const submitTest = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitInProgress.current || !selectedApiId) return;
    setFormError(null);
    if (!draft.name.trim()) {
      setFormError('Enter a test name.');
      return;
    }
    try {
      const testUrl = editingTest && !testUrlEdited ? editingTest.url : draft.url.trim();
      validateTestUrl(testUrl, Boolean(editingTest && !testUrlEdited));
      const headers = parseHeaders(draft.headers);
      const body = parseJson(draft.body, 'Request body');
      const assertions: unknown = parseJson(draft.assertions, 'Assertions');
      if (!Array.isArray(assertions)) throw new Error('Assertions must be a JSON array.');
      if (assertions.length === 0) throw new Error('Add at least one assertion so the test verifies an expected result.');
      const timeoutMs = Number(draft.timeoutMs);
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
        throw new Error('Timeout must be an integer from 1 to 30000 milliseconds.');
      }

      const authentication: Record<string, string> = { type: draft.authenticationType };
      if (draft.authenticationType === 'BASIC') {
        const replacingBasicCredentials = Boolean(draft.username.trim() || draft.credential);
        if (!editingTest?.authentication.credentialConfigured || editingTest.authentication.type !== 'BASIC' || replacingBasicCredentials) {
          if (!draft.username.trim() || !draft.credential) throw new Error('Enter a username and password for Basic authentication.');
          authentication.username = draft.username.trim();
          authentication.password = draft.credential;
        }
      } else if (draft.authenticationType === 'BEARER') {
        if (!editingTest?.authentication.credentialConfigured || editingTest.authentication.type !== 'BEARER') {
          if (!draft.credential) throw new Error('Enter a bearer token.');
          authentication.token = draft.credential;
        } else if (draft.credential) {
          authentication.token = draft.credential;
        }
      } else if (draft.authenticationType === 'API_KEY') {
        const replacingApiKey = Boolean(draft.apiKeyName.trim() || draft.credential);
        if (!editingTest?.authentication.credentialConfigured || editingTest.authentication.type !== 'API_KEY' || replacingApiKey) {
          if (!draft.apiKeyName.trim() || !draft.credential) throw new Error('Enter an API key header name and value.');
          authentication.name = draft.apiKeyName.trim();
          authentication.value = draft.credential;
        }
      }

      const payload = {
        name: draft.name.trim(),
        method: draft.method,
        url: testUrl,
        headers,
        body,
        authentication,
        assertions,
        timeoutMs,
      };

      submitInProgress.current = true;
      setSaving(true);
      const path = editingTest
        ? `/api/v1/tests/${editingTest.id}`
        : `/api/v1/apis/${selectedApiId}/tests`;
      await apiRequest<ApiTestDefinition>(path, {
        method: editingTest ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      });
      setFormOpen(false);
      setDraft(newTestDraft());
      setEditingTest(null);
      setTestUrlEdited(false);
      setRevision((current) => current + 1);
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message
        : error instanceof Error ? error.message
          : 'Unable to save this test. Please try again.');
    } finally {
      submitInProgress.current = false;
      setSaving(false);
    }
  };

  const deleteTest = async (test: ApiTestDefinition): Promise<void> => {
    if (!window.confirm(`Delete the test "${test.name}"?`)) return;
    setDeletingTestId(test.id);
    setTestError(null);
    try {
      await apiRequest<void>(`/api/v1/tests/${test.id}`, { method: 'DELETE' });
      setRevision((current) => current + 1);
    } catch (error) {
      setTestError(error instanceof ApiError ? error.message : 'Unable to delete this test.');
    } finally {
      setDeletingTestId(null);
    }
  };

  const executeTest = async (test: ApiTestDefinition): Promise<void> => {
    if (executionInProgress.current) return;
    executionInProgress.current = true;
    setExecutingTestId(test.id);
    setExecutionErrors((current) => ({ ...current, [test.id]: '' }));
    setExecutionResults((current) => {
      const next = { ...current };
      delete next[test.id];
      return next;
    });
    try {
      const result = await apiRequest<TestExecutionResult>(`/api/v1/tests/${test.id}/execute`, {
        method: 'POST',
      });
      setExecutionResults((current) => ({ ...current, [test.id]: result }));
    } catch (error) {
      setExecutionErrors((current) => ({
        ...current,
        [test.id]: error instanceof ApiError ? error.message : 'Unable to execute this test.',
      }));
    } finally {
      executionInProgress.current = false;
      setExecutingTestId(null);
    }
  };

  const tests = collection?.apiId === selectedApiId ? collection.tests : [];
  const waitingForTests = Boolean(selectedApiId && (loadingTests || collection?.apiId !== selectedApiId));

  return (
    <div className="page-container">
      <header className="page-header">
        <div><p className="eyebrow">Validation</p><h1>API Testing</h1></div>
        <button className="primary-button" type="button" onClick={openNewForm} disabled={!selectedApiId || loadingApis}>
          Create test
        </button>
      </header>

      <section className="panel test-api-picker">
        <label htmlFor="testing-api">API</label>
        {loadingApis ? <p role="status">Loading APIs…</p> : apiError ? (
          <div role="alert"><p>{apiError}</p><button className="secondary-button" type="button" onClick={reloadApis}>Retry</button></div>
        ) : apis.length ? (
          <select id="testing-api" value={selectedApiId} onChange={(event) => {
            setSelectedApiId(event.target.value);
            closeForm();
          }}>
            {apis.map((api) => <option key={api.id} value={api.id}>{api.projectName} / {api.name}</option>)}
          </select>
        ) : (
          <div className="compact-empty"><p>No APIs are available for testing yet. Create a project and register an API first.</p><Link className="text-link" to="/projects">Go to projects</Link></div>
        )}
        {selectedApi && <small className="test-api-status">API lifecycle: {selectedApi.status}. Manual execution requires an active API.</small>}
      </section>

      {formOpen && selectedApiId && (
        <TestDefinitionForm
          draft={draft}
          editing={Boolean(editingTest)}
          credentialConfigured={Boolean(editingTest?.authentication.credentialConfigured)}
          saving={saving}
          error={formError}
          setDraft={setDraft}
          onSubmit={submitTest}
          onCancel={closeForm}
        />
      )}

      {selectedApiId && testError && <div className="panel state-panel" role="alert"><p>{testError}</p><button className="secondary-button" type="button" onClick={() => setRevision((current) => current + 1)}>Retry</button></div>}
      {waitingForTests ? (
        <div className="panel state-panel" role="status"><span className="loader" />Loading tests…</div>
      ) : !testError && selectedApiId && tests.length === 0 ? (
        <div className="panel empty-panel"><div className="empty-mark" aria-hidden="true">API</div><h2>No tests for this API</h2><p>Create a request test with assertions, then run it manually. Targets must match this API’s upstream origin.</p></div>
      ) : !testError && selectedApiId && tests.length > 0 ? (
        <section className="test-list" aria-label="API test definitions">
          {tests.map((test) => (
            <article className="panel test-card" key={test.id}>
              <div className="test-card-heading">
                <div><p className="eyebrow">{test.method} · {test.timeoutMs} ms timeout</p><h2>{test.name}</h2></div>
                <span className="status-badge lifecycle-registered">{test.assertions.length} assertions</span>
              </div>
              <p className="test-url" title={safeDisplayUrl(test.url)}>{safeDisplayUrl(test.url)}</p>
              <p>{test.authentication.credentialConfigured
                ? `Authentication configured (${test.authentication.type}); credential is hidden.`
                : `Authentication: ${test.authentication.type}.`}</p>
              <div className="test-card-actions">
                <button className="primary-button" type="button" disabled={executingTestId !== null || selectedApi?.status !== 'ACTIVE'} onClick={() => void executeTest(test)}>
                  {executingTestId === test.id ? 'Running…' : 'Run test'}
                </button>
                <button className="secondary-button" type="button" disabled={saving || executingTestId !== null} onClick={() => openEditForm(test)}>Edit</button>
                <button className="danger-button" type="button" disabled={deletingTestId !== null || executingTestId !== null} onClick={() => void deleteTest(test)}>
                  {deletingTestId === test.id ? 'Deleting…' : 'Delete'}
                </button>
              </div>
              {executionErrors[test.id] && <p className="auth-error" role="alert">{executionErrors[test.id]}</p>}
              {executionResults[test.id] && <ExecutionResult result={executionResults[test.id]} />}
            </article>
          ))}
          <p className="test-history-note">The backend has no execution-history read endpoint yet. Each manual run is shown here for this visit only; no response body is displayed. Runs are not idempotent: if a connection fails, GateWatch may still have completed the run, and retrying starts another execution.</p>
        </section>
      ) : null}
    </div>
  );
}

interface TestDefinitionFormProps {
  draft: TestDraft;
  editing: boolean;
  credentialConfigured: boolean;
  saving: boolean;
  error: string | null;
  setDraft: (draft: TestDraft) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}

function TestDefinitionForm(props: TestDefinitionFormProps): ReactElement {
  const update = (key: keyof TestDraft, value: string): void => {
    props.setDraft({ ...props.draft, [key]: value });
  };

  return (
    <form className="panel management-form test-definition-form" onSubmit={props.onSubmit} aria-label={props.editing ? 'Edit API test' : 'Create API test'}>
      <h2>{props.editing ? 'Edit API test' : 'Create API test'}</h2>
      <label htmlFor="test-name">Name</label>
      <input id="test-name" value={props.draft.name} maxLength={100} onChange={(event) => update('name', event.target.value)} required />
      <div className="test-form-row">
        <div><label htmlFor="test-method">Method</label><select id="test-method" value={props.draft.method} onChange={(event) => update('method', event.target.value)}>{testMethods.map((method) => <option key={method}>{method}</option>)}</select></div>
        <div><label htmlFor="test-timeout">Timeout (ms)</label><input id="test-timeout" type="number" min={1} max={30000} step={1} value={props.draft.timeoutMs} onChange={(event) => update('timeoutMs', event.target.value)} required /></div>
      </div>
      <label htmlFor="test-url">Test URL</label>
      <input id="test-url" type="url" value={props.draft.url} onChange={(event) => update('url', event.target.value)} required aria-describedby="test-url-help" />
      <small id="test-url-help">Use HTTP or HTTPS on the registered API’s upstream origin. Put credentials in Authentication, not in the URL. Saved query values are hidden; leave this field unchanged to preserve them.</small>
      <label htmlFor="test-headers">Request headers (JSON object)</label>
      <textarea id="test-headers" rows={4} value={props.draft.headers} onChange={(event) => update('headers', event.target.value)} spellCheck={false} />
      <label htmlFor="test-body">Request body (JSON)</label>
      <textarea id="test-body" rows={4} value={props.draft.body} onChange={(event) => update('body', event.target.value)} spellCheck={false} />
      <label htmlFor="test-authentication">Authentication</label>
      <select id="test-authentication" value={props.draft.authenticationType} onChange={(event) => {
        const authenticationType = event.target.value as TestAuthenticationType;
        props.setDraft({
          ...props.draft,
          authenticationType,
          username: '',
          apiKeyName: authenticationType === 'API_KEY' ? 'X-API-Key' : '',
          credential: '',
        });
      }}>
        {authenticationTypes.map((type) => <option key={type} value={type}>{type.replace('_', ' ')}</option>)}
      </select>
      {props.draft.authenticationType === 'BASIC' && <>
        <label htmlFor="test-username">Username</label><input id="test-username" autoComplete="off" value={props.draft.username} onChange={(event) => update('username', event.target.value)} />
        <label htmlFor="test-password">Password</label><input id="test-password" type="password" autoComplete="new-password" value={props.draft.credential} onChange={(event) => update('credential', event.target.value)} />
      </>}
      {props.draft.authenticationType === 'BEARER' && <>
        <label htmlFor="test-bearer-token">Bearer token</label><input id="test-bearer-token" type="password" autoComplete="new-password" value={props.draft.credential} onChange={(event) => update('credential', event.target.value)} />
      </>}
      {props.draft.authenticationType === 'API_KEY' && <>
        <label htmlFor="test-api-key-name">API key header name</label><input id="test-api-key-name" value={props.draft.apiKeyName} onChange={(event) => update('apiKeyName', event.target.value)} />
        <label htmlFor="test-api-key-value">API key value</label><input id="test-api-key-value" type="password" autoComplete="new-password" value={props.draft.credential} onChange={(event) => update('credential', event.target.value)} />
      </>}
      {props.credentialConfigured && props.draft.authenticationType !== 'NONE' && <small>A credential is already saved. Leave the secret field blank to retain it, or enter a replacement.</small>}
      <label htmlFor="test-assertions">Assertions (JSON array)</label>
      <textarea id="test-assertions" rows={7} value={props.draft.assertions} onChange={(event) => update('assertions', event.target.value)} spellCheck={false} aria-describedby="test-assertions-help" />
      <small id="test-assertions-help">Add at least one assertion. Supported types are STATUS_CODE, JSON_BODY, RESPONSE_HEADER, and RESPONSE_TIME.</small>
      <details className="test-assertion-examples">
        <summary>View assertion examples</summary>
        <pre>{`[
  {"type":"STATUS_CODE","operator":"EQUALS","expected":200},
  {"type":"JSON_BODY","path":"/status","operator":"EQUALS","expected":"ok"},
  {"type":"RESPONSE_HEADER","name":"content-type","operator":"CONTAINS","expected":"application/json"},
  {"type":"RESPONSE_TIME","operator":"LESS_THAN_OR_EQUAL","expected":1000}
]`}</pre>
      </details>
      {props.error && <p className="auth-error" role="alert">{props.error}</p>}
      <div className="test-card-actions">
        <button className="primary-button" type="submit" disabled={props.saving}>{props.saving ? 'Saving…' : props.editing ? 'Save changes' : 'Create test'}</button>
        <button className="secondary-button" type="button" disabled={props.saving} onClick={props.onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function ExecutionResult({ result }: { result: TestExecutionResult }): ReactElement {
  const detail = result.result;
  return (
    <section className={`test-execution-result test-result-${detail.status.toLowerCase()}`} aria-label="Latest test result" aria-live="polite">
      <h3>Latest run: {detail.status}</h3>
      <p>{detail.passed ? 'All assertions passed.' : 'The test did not pass.'} Duration: {detail.durationMs} ms.
        {detail.responseStatus !== null ? ` HTTP status: ${detail.responseStatus}.` : ''}
      </p>
      {detail.status === 'ERROR' && <p role="status">The test execution encountered an error. Review the saved test configuration and try again if appropriate.</p>}
      <ul>
        {detail.assertions.map((assertion, index) => (
          <li key={`${assertion.type}-${index}`}><strong>{assertion.pass ? 'Passed' : 'Failed'}:</strong> {assertion.type.replace('_', ' ')}</li>
        ))}
      </ul>
      <p className="test-safe-result-note">Only assertion status, type, and response metadata are shown. Upstream response values and bodies are not displayed.</p>
    </section>
  );
}
