import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { useOwnedApis } from '../features/apis/useOwnedApis';
import type {
  Alert,
  AlertConfiguration,
  AlertEvaluation,
  AlertEvent,
  AlertType,
} from '../features/alerts/types';
import { ApiError, apiRequest, apiRequestEnvelope, type ApiPagination } from '../lib/api';

interface AlertDraft {
  name: string;
  type: AlertType;
  durationSeconds: string;
  threshold: string;
  thresholdMs: string;
  windowSeconds: string;
}

interface AlertCollection {
  apiId: string;
  alerts: Alert[];
}

interface AlertEventsState {
  alertId: string;
  events: AlertEvent[];
  pagination: ApiPagination;
}

const alertTypes: AlertType[] = ['API_DOWN', 'UNHEALTHY_DURATION', 'ERROR_RATE', 'LATENCY'];
const pageLimit = 10;

const newAlertDraft = (): AlertDraft => ({
  name: '',
  type: 'API_DOWN',
  durationSeconds: '',
  threshold: '',
  thresholdMs: '',
  windowSeconds: '',
});

function draftFromAlert(alert: Alert): AlertDraft {
  const config = alert.configuration;
  return {
    name: alert.name,
    type: alert.type,
    durationSeconds: 'durationSeconds' in config ? String(config.durationSeconds) : '',
    threshold: 'threshold' in config ? String(config.threshold) : '',
    thresholdMs: 'thresholdMs' in config ? String(config.thresholdMs) : '',
    windowSeconds: 'windowSeconds' in config ? String(config.windowSeconds) : '',
  };
}

function integerInRange(value: string, minimum: number, maximum: number, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return parsed;
}

function configFromDraft(draft: AlertDraft): AlertConfiguration {
  if (draft.type === 'API_DOWN') return {};
  if (draft.type === 'UNHEALTHY_DURATION') {
    return { durationSeconds: integerInRange(draft.durationSeconds, 1, 604_800, 'Duration') };
  }
  const windowSeconds = integerInRange(draft.windowSeconds, 60, 86_400, 'Window');
  if (draft.type === 'ERROR_RATE') {
    const threshold = Number(draft.threshold);
    if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
      throw new Error('Error rate threshold must be greater than 0 and at most 1.');
    }
    return { threshold, windowSeconds };
  }
  return {
    thresholdMs: integerInRange(draft.thresholdMs, 1, 60_000, 'Latency threshold'),
    windowSeconds,
  };
}

function displayTime(value: string | null): string {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Time unavailable';
}

function defaultPagination(): ApiPagination {
  return { page: 1, limit: pageLimit, total: 0, totalPages: 0 };
}

export function AlertsPage(): ReactElement {
  const { apis, loading: loadingApis, error: apiError, reload: reloadApis } = useOwnedApis();
  const [selectedApiIdState, setSelectedApiId] = useState('');
  const selectedApiId = apis.some((api) => api.id === selectedApiIdState)
    ? selectedApiIdState
    : apis[0]?.id ?? '';
  const [collection, setCollection] = useState<AlertCollection | null>(null);
  const [loadingAlerts, setLoadingAlerts] = useState(false);
  const [alertError, setAlertError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [editingAlert, setEditingAlert] = useState<Alert | null>(null);
  const [draft, setDraft] = useState<AlertDraft>(newAlertDraft);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [workingAlertId, setWorkingAlertId] = useState<string | null>(null);
  const [eventAlertId, setEventAlertId] = useState<string | null>(null);
  const [eventPage, setEventPage] = useState(1);
  const [eventState, setEventState] = useState<AlertEventsState | null>(null);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [eventError, setEventError] = useState<string | null>(null);
  const [evaluations, setEvaluations] = useState<Record<string, AlertEvaluation>>({});
  const [evaluationErrors, setEvaluationErrors] = useState<Record<string, string>>({});
  const submissionInProgress = useRef(false);
  const mutationInProgress = useRef(false);
  const requestSequence = useRef(0);
  const eventRequestSequence = useRef(0);

  useEffect(() => {
    let active = true;
    const requestId = ++requestSequence.current;
    void Promise.resolve().then(async () => {
      if (!active) return;
      if (!selectedApiId) {
        setCollection(null);
        setAlertError(null);
        setLoadingAlerts(false);
        return;
      }
      setCollection(null);
      setLoadingAlerts(true);
      setAlertError(null);
      try {
        const alerts = await apiRequest<Alert[]>(`/api/v1/apis/${selectedApiId}/alerts`);
        if (active && requestId === requestSequence.current) setCollection({ apiId: selectedApiId, alerts });
      } catch (error) {
        if (active && requestId === requestSequence.current) {
          setCollection(null);
          setAlertError(error instanceof ApiError ? error.message : 'Unable to load alerts. Please try again.');
        }
      } finally {
        if (active && requestId === requestSequence.current) setLoadingAlerts(false);
      }
    });
    return () => {
      active = false;
      requestSequence.current += 1;
    };
  }, [selectedApiId, revision]);

  useEffect(() => {
    let active = true;
    const requestId = ++eventRequestSequence.current;
    void Promise.resolve().then(async () => {
      if (!eventAlertId) {
        setEventState(null);
        setEventError(null);
        setLoadingEvents(false);
        return;
      }
      setEventState(null);
      setLoadingEvents(true);
      setEventError(null);
      try {
        const response = await apiRequestEnvelope<AlertEvent[]>(
          `/api/v1/alerts/${eventAlertId}/events?page=${eventPage}&limit=${pageLimit}`,
        );
        if (!response.pagination) throw new ApiError('The server returned an invalid event-history response.', null);
        if (active && requestId === eventRequestSequence.current) {
          setEventState({ alertId: eventAlertId, events: response.data, pagination: response.pagination });
        }
      } catch (error) {
        if (active && requestId === eventRequestSequence.current) {
          setEventState(null);
          setEventError(error instanceof ApiError ? error.message : 'Unable to load alert history.');
        }
      } finally {
        if (active && requestId === eventRequestSequence.current) setLoadingEvents(false);
      }
    });
    return () => {
      active = false;
      eventRequestSequence.current += 1;
    };
  }, [eventAlertId, eventPage, revision]);

  const openNewForm = (): void => {
    setEditingAlert(null);
    setDraft(newAlertDraft());
    setFormError(null);
    setFormOpen(true);
  };

  const openEditForm = (alert: Alert): void => {
    setEditingAlert(alert);
    setDraft(draftFromAlert(alert));
    setFormError(null);
    setFormOpen(true);
  };

  const submitAlert = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submissionInProgress.current || !selectedApiId) return;
    setFormError(null);
    try {
      const configuration = configFromDraft(draft);
      if (!draft.name.trim()) throw new Error('Enter an alert name.');
      submissionInProgress.current = true;
      setSaving(true);
      const path = editingAlert
        ? `/api/v1/alerts/${editingAlert.id}`
        : `/api/v1/apis/${selectedApiId}/alerts`;
      await apiRequest<Alert>(path, {
        method: editingAlert ? 'PATCH' : 'POST',
        body: JSON.stringify({ name: draft.name.trim(), type: draft.type, configuration }),
      });
      setFormOpen(false);
      setRevision((current) => current + 1);
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message
        : error instanceof Error ? error.message
          : 'Unable to save this alert.');
    } finally {
      submissionInProgress.current = false;
      setSaving(false);
    }
  };

  const mutateAlert = async (alert: Alert, action: 'enable' | 'disable' | 'delete' | 'evaluate'): Promise<void> => {
    if (mutationInProgress.current) return;
    if (action === 'delete' && !window.confirm(`Delete the alert "${alert.name}"?`)) return;
    mutationInProgress.current = true;
    setWorkingAlertId(alert.id);
    setAlertError(null);
    setEvaluationErrors((current) => ({ ...current, [alert.id]: '' }));
    try {
      if (action === 'delete') {
        await apiRequest<void>(`/api/v1/alerts/${alert.id}`, { method: 'DELETE' });
        if (eventAlertId === alert.id) setEventAlertId(null);
        setRevision((current) => current + 1);
      } else if (action === 'evaluate') {
        const result = await apiRequest<AlertEvaluation>(`/api/v1/alerts/${alert.id}/evaluate`, { method: 'POST' });
        setEvaluations((current) => ({ ...current, [alert.id]: result }));
        setRevision((current) => current + 1);
      } else {
        await apiRequest<Alert>(`/api/v1/alerts/${alert.id}/${action}`, { method: 'POST' });
        setRevision((current) => current + 1);
      }
    } catch (error) {
      const message = error instanceof ApiError ? error.message : `Unable to ${action} this alert.`;
      if (action === 'evaluate') {
        setEvaluationErrors((current) => ({ ...current, [alert.id]: message }));
      } else {
        setAlertError(message);
      }
    } finally {
      mutationInProgress.current = false;
      setWorkingAlertId(null);
    }
  };

  const toggleEventHistory = (alertId: string): void => {
    setEventPage(1);
    setEventAlertId((current) => current === alertId ? null : alertId);
  };

  const alerts = collection?.apiId === selectedApiId ? collection.alerts : [];
  const waitingForAlerts = Boolean(selectedApiId && (loadingAlerts || collection?.apiId !== selectedApiId));

  return (
    <div className="page-container">
      <header className="page-header">
        <div><p className="eyebrow">Operations</p><h1>Alerts</h1></div>
        <button className="primary-button" type="button" onClick={openNewForm} disabled={!selectedApiId || loadingApis}>Create alert</button>
      </header>

      <section className="panel alert-api-picker">
        <label htmlFor="alerts-api">API</label>
        {loadingApis ? <p role="status">Loading APIs…</p> : apiError ? (
          <div role="alert"><p>{apiError}</p><button className="secondary-button" type="button" onClick={reloadApis}>Retry</button></div>
        ) : apis.length ? (
          <select id="alerts-api" value={selectedApiId} onChange={(event) => {
            setSelectedApiId(event.target.value);
            setFormOpen(false);
            setEventAlertId(null);
          }}>
            {apis.map((api) => <option key={api.id} value={api.id}>{api.projectName} / {api.name}</option>)}
          </select>
        ) : (
          <div className="compact-empty"><p>No APIs are available. Create a project and register an API to configure alerts.</p><Link className="text-link" to="/projects">Go to projects</Link></div>
        )}
      </section>

      <p className="alert-runtime-note">Alert configuration status and runtime state are separate. Evaluation is manual from this page; it does not schedule checks or send notifications.</p>

      {formOpen && selectedApiId && (
        <AlertForm
          draft={draft}
          editing={Boolean(editingAlert)}
          saving={saving}
          error={formError}
          onDraftChange={setDraft}
          onSubmit={submitAlert}
          onCancel={() => setFormOpen(false)}
        />
      )}

      {selectedApiId && alertError && <div className="panel state-panel" role="alert"><p>{alertError}</p><button className="secondary-button" type="button" onClick={() => setRevision((current) => current + 1)}>Retry</button></div>}
      {waitingForAlerts ? (
        <div className="panel state-panel" role="status"><span className="loader" />Loading alerts…</div>
      ) : !alertError && selectedApiId && alerts.length === 0 ? (
        <div className="panel empty-panel"><div className="empty-mark" aria-hidden="true">A</div><h2>No alerts for this API</h2><p>Alert rules use GateWatch health checks and recorded gateway traffic. Create a rule to manage it here.</p></div>
      ) : !alertError && selectedApiId ? (
        <section className="alert-list" aria-label="API alerts">
          {alerts.map((alert) => (
            <article className="panel alert-card" key={alert.id}>
              <div className="alert-card-heading">
                <div><p className="eyebrow">{alert.type.replace('_', ' ')}</p><h2>{alert.name}</h2></div>
                <div className="alert-state-badges">
                  <span className={`status-badge ${alert.enabled ? 'lifecycle-active' : 'lifecycle-disabled'}`}>{alert.enabled ? 'Enabled' : 'Disabled'}</span>
                  <span className={`status-badge ${alert.runtimeState === 'TRIGGERED' ? 'health-down' : 'health-healthy'}`}>{alert.runtimeState}</span>
                </div>
              </div>
              <AlertConfigSummary alert={alert} />
              <dl className="alert-times">
                <div><dt>Last triggered</dt><dd>{displayTime(alert.triggeredAt)}</dd></div>
                <div><dt>Last recovered</dt><dd>{displayTime(alert.recoveredAt)}</dd></div>
              </dl>
              <div className="alert-card-actions">
                <button className="primary-button" type="button" disabled={workingAlertId !== null} onClick={() => void mutateAlert(alert, 'evaluate')}>
                  {workingAlertId === alert.id ? 'Working…' : 'Evaluate now'}
                </button>
                <button className="secondary-button" type="button" disabled={workingAlertId !== null} onClick={() => openEditForm(alert)}>Edit</button>
                <button className="secondary-button" type="button" disabled={workingAlertId !== null} onClick={() => void mutateAlert(alert, alert.enabled ? 'disable' : 'enable')}>
                  {alert.enabled ? 'Disable' : 'Enable'}
                </button>
                <button className="danger-button" type="button" disabled={workingAlertId !== null} onClick={() => void mutateAlert(alert, 'delete')}>Delete</button>
                <button className="secondary-button" type="button" aria-expanded={eventAlertId === alert.id} aria-controls={`alert-events-${alert.id}`} onClick={() => toggleEventHistory(alert.id)}>
                  {eventAlertId === alert.id ? 'Hide history' : 'Event history'}
                </button>
              </div>
              {evaluationErrors[alert.id] && <p role="alert" className="auth-error">{evaluationErrors[alert.id]}</p>}
              {evaluations[alert.id] && <p className="alert-evaluation" role="status">
                Condition {evaluations[alert.id].active ? 'is active' : 'is inactive'}; runtime state {evaluations[alert.id].runtimeState ?? alert.runtimeState}.
                {evaluations[alert.id].transitioned ? ' Runtime state changed.' : ' No state transition occurred.'}
                {' '}Evaluated {displayTime(evaluations[alert.id].evaluatedAt)}.
              </p>}
              {eventAlertId === alert.id && (
                <AlertEventHistory
                  alertId={alert.id}
                  events={eventState?.alertId === alert.id ? eventState.events : []}
                  pagination={eventState?.alertId === alert.id ? eventState.pagination : defaultPagination()}
                  page={eventPage}
                  loading={loadingEvents}
                  error={eventError}
                  onPageChange={setEventPage}
                  onRetry={() => setRevision((current) => current + 1)}
                />
              )}
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}

interface AlertFormProps {
  draft: AlertDraft;
  editing: boolean;
  saving: boolean;
  error: string | null;
  onDraftChange: (draft: AlertDraft) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}

function AlertForm(props: AlertFormProps): ReactElement {
  const update = <Key extends keyof AlertDraft>(key: Key, value: AlertDraft[Key]): void => {
    props.onDraftChange({ ...props.draft, [key]: value });
  };

  return (
    <form className="panel management-form alert-form" aria-label={props.editing ? 'Edit alert' : 'Create alert'} onSubmit={props.onSubmit}>
      <h2>{props.editing ? 'Edit alert' : 'Create alert'}</h2>
      <label htmlFor="alert-name">Name</label>
      <input id="alert-name" value={props.draft.name} maxLength={100} onChange={(event) => update('name', event.target.value)} required />
      <label htmlFor="alert-type">Alert type</label>
      <select id="alert-type" value={props.draft.type} onChange={(event) => {
        const type = event.target.value as AlertType;
        props.onDraftChange({ ...newAlertDraft(), name: props.draft.name, type });
      }}>
        {alertTypes.map((type) => <option key={type} value={type}>{type.replace('_', ' ')}</option>)}
      </select>
      {props.draft.type === 'UNHEALTHY_DURATION' && <>
        <label htmlFor="alert-duration">Unhealthy duration (seconds)</label>
        <input id="alert-duration" type="number" min={1} max={604800} step={1} value={props.draft.durationSeconds} onChange={(event) => update('durationSeconds', event.target.value)} required />
      </>}
      {props.draft.type === 'ERROR_RATE' && <>
        <label htmlFor="alert-error-threshold">Error rate threshold (0–1)</label>
        <input id="alert-error-threshold" type="number" min={0} max={1} step="any" value={props.draft.threshold} onChange={(event) => update('threshold', event.target.value)} required />
        <label htmlFor="alert-error-window">Window (seconds)</label>
        <input id="alert-error-window" type="number" min={60} max={86400} step={1} value={props.draft.windowSeconds} onChange={(event) => update('windowSeconds', event.target.value)} required />
      </>}
      {props.draft.type === 'LATENCY' && <>
        <label htmlFor="alert-latency-threshold">Average latency threshold (ms)</label>
        <input id="alert-latency-threshold" type="number" min={1} max={60000} step={1} value={props.draft.thresholdMs} onChange={(event) => update('thresholdMs', event.target.value)} required />
        <label htmlFor="alert-latency-window">Window (seconds)</label>
        <input id="alert-latency-window" type="number" min={60} max={86400} step={1} value={props.draft.windowSeconds} onChange={(event) => update('windowSeconds', event.target.value)} required />
      </>}
      {props.draft.type === 'API_DOWN' && <p>Triggers when the latest persisted health-check result reports the API as down.</p>}
      {props.draft.type === 'ERROR_RATE' && <small>Threshold is a ratio: 0.05 means 5%. GateWatch compares error rate using the configured window.</small>}
      {props.draft.type === 'LATENCY' && <small>Latency is the average response time in milliseconds over the configured window.</small>}
      {props.error && <p className="auth-error" role="alert">{props.error}</p>}
      <div className="alert-card-actions">
        <button className="primary-button" type="submit" disabled={props.saving}>{props.saving ? 'Saving…' : props.editing ? 'Save changes' : 'Create alert'}</button>
        <button className="secondary-button" type="button" disabled={props.saving} onClick={props.onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function AlertConfigSummary({ alert }: { alert: Alert }): ReactElement {
  const config = alert.configuration;
  if (alert.type === 'API_DOWN') return <p>Condition: API health is down.</p>;
  if (alert.type === 'UNHEALTHY_DURATION' && 'durationSeconds' in config) {
    return <p>Condition: unhealthy for {config.durationSeconds} seconds.</p>;
  }
  if (alert.type === 'ERROR_RATE' && 'threshold' in config) {
    return <p>Condition: error rate above {(config.threshold * 100).toLocaleString()}% over {config.windowSeconds} seconds.</p>;
  }
  if (alert.type === 'LATENCY' && 'thresholdMs' in config) {
    return <p>Condition: average latency above {config.thresholdMs} ms over {config.windowSeconds} seconds.</p>;
  }
  return <p>Configuration unavailable.</p>;
}

interface AlertEventHistoryProps {
  alertId: string;
  events: AlertEvent[];
  pagination: ApiPagination;
  page: number;
  loading: boolean;
  error: string | null;
  onPageChange: (page: number) => void;
  onRetry: () => void;
}

function AlertEventHistory(props: AlertEventHistoryProps): ReactElement {
  return (
    <section className="alert-event-history" id={`alert-events-${props.alertId}`} aria-label="Alert event history" aria-live="polite">
      <h3>Event history</h3>
      {props.loading ? <p role="status">Loading events…</p> : props.error ? (
        <div role="alert"><p>{props.error}</p><button className="secondary-button" type="button" onClick={props.onRetry}>Retry</button></div>
      ) : props.events.length === 0 ? (
        <p>No trigger or recovery events recorded.</p>
      ) : (
        <>
          <ol>
            {props.events.map((event) => {
              const label = event.eventType === 'TRIGGERED'
                ? 'Triggered'
                : event.eventType === 'RECOVERED' ? 'Recovered' : `Other event: ${event.eventType}`;
              const style = event.eventType === 'TRIGGERED'
                ? 'health-down'
                : event.eventType === 'RECOVERED' ? 'health-healthy' : 'lifecycle-unknown';
              return (
                <li key={event.id}>
                  <span className={`status-badge ${style}`}>{label}</span>
                  <time dateTime={event.occurredAt}>{displayTime(event.occurredAt)}</time>
                </li>
              );
            })}
          </ol>
          <div className="alert-event-pagination">
            <span>{props.pagination.total} events · Page {props.pagination.page} of {Math.max(props.pagination.totalPages, 1)}</span>
            <button className="secondary-button" type="button" disabled={props.page <= 1} onClick={() => props.onPageChange(props.page - 1)}>Previous</button>
            <button className="secondary-button" type="button" disabled={props.page >= props.pagination.totalPages} onClick={() => props.onPageChange(props.page + 1)}>Next</button>
          </div>
        </>
      )}
    </section>
  );
}
