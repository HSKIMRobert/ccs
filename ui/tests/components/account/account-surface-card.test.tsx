import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AccountSurfaceCard } from '@/components/account/shared/account-surface-card';

describe('AccountSurfaceCard privacy titles', () => {
  it('keeps sensitive account title attributes available outside privacy mode', () => {
    const { container } = render(
      <AccountSurfaceCard
        mode="compact"
        provider="gemini"
        accountId="person@example.com#abcdef12-team"
        email="person@example.com"
      />
    );

    expect(screen.getByText('person@example.com')).toHaveAttribute('title', 'person@example.com');
    expect(container.querySelector('[title="Business"]')).toBeInTheDocument();
    expect(container.querySelector('[title="Workspace abcdef12"]')).toBeInTheDocument();
  });

  it('removes sensitive account title attributes in privacy mode', () => {
    const { container } = render(
      <>
        <AccountSurfaceCard
          mode="compact"
          provider="gemini"
          accountId="person@example.com#abcdef12-team"
          email="person@example.com"
          privacyMode
        />
        <AccountSurfaceCard
          mode="compact"
          provider="codex"
          accountId="codex@example.com#enterprise-pro"
          email="codex@example.com"
          privacyMode
        />
      </>
    );

    expect(screen.getByText('person@example.com')).not.toHaveAttribute('title');
    expect(screen.getByText('codex@example.com')).not.toHaveAttribute('title');
    expect(container.querySelector('[title="Business"]')).not.toBeInTheDocument();
    expect(container.querySelector('[title="Workspace abcdef12"]')).not.toBeInTheDocument();
    expect(container.querySelector('[title*="Enterprise"]')).not.toBeInTheDocument();
  });
});
