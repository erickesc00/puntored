'use client';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginPageClient } from './login-page-client';
import { ApiClientError } from '@/lib/api/errors';

const replaceMock = vi.fn();
const loginMock = vi.fn();
const refreshSessionMock = vi.fn();
const useSearchParamsMock = vi.fn();
const routerMock = { replace: replaceMock };

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  useSearchParams: () => useSearchParamsMock(),
}));

vi.mock('@/lib/session/session-provider', () => ({
  useSession: () => ({
    login: loginMock,
    refreshSession: refreshSessionMock,
    status: 'anonymous',
    user: null,
  }),
}));

describe('LoginPageClient', () => {
  beforeEach(() => {
    replaceMock.mockReset();
    loginMock.mockReset();
    refreshSessionMock.mockReset();
    useSearchParamsMock.mockReturnValue(new URLSearchParams());
  });

  it('shows a generic auth error for invalid credentials', async () => {
    loginMock.mockRejectedValue(
      new ApiClientError({
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid credentials',
      }),
    );

    const user = userEvent.setup();

    render(<LoginPageClient />);

    await user.type(screen.getByLabelText('Usuario'), 'operator');
    await user.type(screen.getByLabelText('Password'), 'bad-password');
    await user.click(screen.getByRole('button', { name: 'Ingresar' }));

    expect(loginMock).toHaveBeenCalledWith({
      username: 'operator',
      password: 'bad-password',
      returnTo: '/references',
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Credenciales inválidas.',
    );
  });
});
