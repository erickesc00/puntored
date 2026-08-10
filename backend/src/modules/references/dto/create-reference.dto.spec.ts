import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateReferenceDto } from './create-reference.dto';

describe('CreateReferenceDto', () => {
  const buildPayload = (currency: unknown) =>
    plainToInstance(CreateReferenceDto, {
      concept: 'Pago colegiatura',
      amount: 125000,
      currency,
      dueDate: '2026-08-20T10:00:00.000Z',
    });

  it.each(['COP', 'MXN', 'USD', 'EUR'])(
    'accepts supported currency %s',
    async (currency) => {
      await expect(validate(buildPayload(currency))).resolves.toHaveLength(0);
    },
  );

  it('rejects unsupported currencies', async () => {
    const [error] = await validate(buildPayload('JPY'));

    expect(error?.property).toBe('currency');
    expect(error?.constraints).toMatchObject({
      isIn: 'currency must be one of the following values: COP, MXN, USD, EUR',
    });
  });

  it('rejects missing currency instead of leaking to a later 500 path', async () => {
    const [error] = await validate(buildPayload(undefined));

    expect(error?.property).toBe('currency');
    expect(error?.constraints).toMatchObject({
      isDefined: 'currency should not be null or undefined',
    });
  });
});
