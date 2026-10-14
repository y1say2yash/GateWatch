import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

export function NotFoundPage(): ReactElement {
  return (
    <div className="page-state not-found-page">
      <h1>404</h1>
      <p>The page you requested could not be found.</p>
      <Link to="/dashboard" className="primary-button inline-link">
        Return to dashboard
      </Link>
    </div>
  );
}
