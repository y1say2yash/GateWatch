import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, apiRequest } from '../../lib/api';
import type { Api, Project } from '../../types/management';

export interface OwnedApiOption {
  id: string;
  name: string;
  projectName: string;
  status: Api['status'];
}

interface OwnedApisState {
  apis: OwnedApiOption[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useOwnedApis(): OwnedApisState {
  const [apis, setApis] = useState<OwnedApiOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const requestSequence = useRef(0);

  const reload = useCallback(() => setRevision((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    const requestId = ++requestSequence.current;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setLoading(true);
      setError(null);
      try {
        const projects = await apiRequest<Project[]>('/api/v1/projects');
        const apiGroups = await Promise.all(
          projects.map(async (project) => ({
            project,
            apis: await apiRequest<Api[]>(`/api/v1/projects/${project.id}/apis`),
          })),
        );
        if (active && requestId === requestSequence.current) {
          setApis(apiGroups.flatMap(({ project, apis: projectApis }) =>
            projectApis.map((api) => ({
              id: api.id,
              name: api.name,
              projectName: project.name,
              status: api.status,
            })),
          ));
        }
      } catch (requestError) {
        if (active && requestId === requestSequence.current) {
          setApis([]);
          setError(requestError instanceof ApiError
            ? requestError.message
            : 'Unable to load your APIs. Please try again.');
        }
      } finally {
        if (active && requestId === requestSequence.current) setLoading(false);
      }
    });
    return () => {
      active = false;
      requestSequence.current += 1;
    };
  }, [revision]);

  return { apis, loading, error, reload };
}
