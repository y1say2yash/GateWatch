import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

export function APIsPage(): ReactElement {
  return (
    <div className="page-container">
      <header className="page-header">
        <div>
          <p className="eyebrow">APIs</p>
          <h1>Registered endpoints</h1>
        </div>
      </header>
      <section className="panel">
        <h2>Choose a project</h2>
        <p>
          APIs are managed within a project. Select a project to view its registered APIs or create a project first.
        </p>
        <Link className="primary-button inline-link" to="/projects">
          Browse projects
        </Link>
      </section>
    </div>
  );
}
