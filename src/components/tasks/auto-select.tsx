'use client';

import type { ComponentProps } from 'react';
import { Select } from '@/components/ui';

/** A select that submits its form as soon as the choice changes. */
export function AutoSelect(props: ComponentProps<'select'>) {
  return <Select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
