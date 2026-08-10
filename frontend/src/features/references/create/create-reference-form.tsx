'use client';

import { CreateReferenceFormView } from './create-reference-form-view';
import { useCreateReferenceFormController } from './use-create-reference-form-controller';

export function CreateReferenceForm() {
  const controller = useCreateReferenceFormController();

  return <CreateReferenceFormView controller={controller} />;
}
