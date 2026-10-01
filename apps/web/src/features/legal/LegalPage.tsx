import { Logo } from '@hellogram/ui';
import { Link } from 'react-router';
import { Markdown } from '../../shared/markdown.js';

/** Static legal pages rendered from src/content/*.md (replace the Markdown files with final text). */
export function LegalPage({ source }: { source: string }) {
  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-5 py-10">
      <Link to="/" aria-label="Hellogram home">
        <Logo />
      </Link>
      <article className="mt-10">
        <Markdown source={source} />
      </article>
      <nav className="mt-12 flex flex-wrap gap-4 border-t border-border pt-6 text-sm text-muted">
        <Link to="/terms" className="hover:text-fg">Terms</Link>
        <Link to="/privacy" className="hover:text-fg">Privacy</Link>
        <Link to="/guidelines" className="hover:text-fg">Community Guidelines</Link>
        <Link to="/grievance" className="hover:text-fg">Grievance Officer</Link>
      </nav>
    </main>
  );
}
