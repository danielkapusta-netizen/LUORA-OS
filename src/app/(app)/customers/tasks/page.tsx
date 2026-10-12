import { redirect } from 'next/navigation';

// Customer tasks are ordinary tasks now; they have their own pages under Tasks.
export default function CustomerTasksRedirect(): never {
  redirect('/tasks');
}
