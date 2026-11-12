import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Field, Input } from '../../../ui';
import { cashCountFormSchema, type CashCountFormValues } from '../../../../shared/schemas/spaces';

const fields = [['cash', 'Efectivo contado'], ['card', 'Tarjeta contada'], ['transfer', 'Transferencia contada']] as const;

/** Paso de conteo del cierre de caja: valida los tres montos antes de revisar el cierre. */
export function CashCountStep({ initial, onReview, onBack }: {
  initial: { cash: string; card: string; transfer: string };
  onReview: (values: CashCountFormValues) => void;
  onBack: () => void;
}) {
  const form = useForm({ resolver: zodResolver(cashCountFormSchema), defaultValues: initial });
  const { errors } = form.formState;
  return (
    <form noValidate aria-label="Conteo de caja" className="space-y-4" onSubmit={form.handleSubmit(onReview)}>
      {fields.map(([key, label]) => (
        <div key={key}>
          <Field label={label} htmlFor={`cash-count-${key}`} error={errors[key]?.message}>
            <Input id={`cash-count-${key}`} type="number" inputMode="numeric" min="0" step="1" invalid={Boolean(errors[key])} {...form.register(key)} />
          </Field>
        </div>
      ))}
      <Button type="submit" size="lg" fullWidth>Revisar cierre</Button>
      <Button variant="secondary" fullWidth onClick={onBack}>Volver</Button>
    </form>
  );
}
