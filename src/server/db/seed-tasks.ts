// Demo projects and tasks around today, so the Tasks pages are alive in demo mode. They carry the demo flag, so
// "Remove demo data" takes them away again.
import { eq } from 'drizzle-orm';
import { addDays, today } from '../../lib/tasks/dates';
import { createProject, createTask, type TaskInput } from '../services/tasks';
import { getDb } from './client';
import { tasks } from './schema';

interface People {
  admin: string;
  ola: string;
  marek: string;
}

export async function seedDemoTasks(people: People): Promise<void> {
  const db = getDb();
  const now = today();
  const day = (offset: number) => addDays(now, offset);
  const actor = { id: people.admin };

  const project = (name: string, color: string, ownerId: string, description: string) => createProject({ name, color, ownerId, description, demo: true }, actor);
  const [campaign, warehouse, listings, suppliers] = await Promise.all([
    project('Autumn campaign', 'lime', people.ola, 'Posters, newsletter and the Black Friday offers.'),
    project('Warehouse and shipping', 'orange', people.admin, 'Packing, boxes, couriers and stock counts.'),
    project('Marketplace listings', 'sky', people.marek, 'Prices, photos and barcodes on Allegro, Empik and Von Halsky.'),
    project('Suppliers', 'violet', people.admin, 'Deliveries, invoices and shipping rates.'),
  ]);

  const make = async (input: TaskInput, finishedDaysAgo?: number) => {
    const id = await createTask(input, actor);
    if (finishedDaysAgo !== undefined) {
      await db.update(tasks).set({ doneAt: new Date(`${day(-finishedDaysAgo)}T12:00:00Z`) }).where(eq(tasks.id, id));
    }
    return id;
  };

  // Today: the reference layout, a finished task, one in progress, and two for the afternoon.
  await make({ title: 'Shoot the new poster for Wednesday morning', description: 'Two layouts, one with the serum, one with the cream.', projectId: campaign, status: 'done', dueDate: day(0), startTime: '10:30', endTime: '12:30', tags: ['posters', 'ideas'], assigneeIds: [people.ola] }, 0);
  await make({ title: 'Create a carousel of shots about the last launch', description: 'Nine frames, square, for the shop and Instagram.', projectId: campaign, status: 'in_progress', dueDate: day(0), startTime: '11:00', endTime: '17:30', tags: ['posters'], assigneeIds: [people.ola, people.marek], checklist: ['Pick the nine best photos', 'Retouch the colours', 'Write the captions'] });
  await make({ title: 'Pack the big Allegro orders before the courier at 15:00', projectId: warehouse, priority: 'high', dueDate: day(0), startTime: '13:00', endTime: '14:30', tags: ['shipping'], assigneeIds: [people.admin, people.marek] });
  await make({ title: 'Answer the supplier about the delayed delivery', description: 'Ask for a new date in writing and for a discount on the next order.', projectId: suppliers, dueDate: day(0), startTime: '13:10', endTime: '13:50', tags: ['supplier'], assigneeIds: [people.admin] });

  // Late and coming up.
  await make({ title: 'Update the prices of the NIDA range on Allegro', projectId: listings, priority: 'high', dueDate: day(-2), tags: ['pricing'], assigneeIds: [people.marek] });
  await make({ title: 'Order shipping boxes', description: 'Small and medium; we are down to about 40.', projectId: warehouse, status: 'in_progress', priority: 'urgent', dueDate: day(-1), tags: ['shipping'], assigneeIds: [people.admin] });
  await make({ title: 'Write the autumn newsletter', projectId: campaign, dueDate: day(1), startTime: '09:00', endTime: '11:00', tags: ['newsletter', 'ideas'], assigneeIds: [people.ola], checklist: ['Subject line', 'Three product blocks', 'Test send'] });
  await make({ title: 'Photograph the new serums for Empik', projectId: listings, dueDate: day(2), tags: ['photos'], assigneeIds: [people.ola] });
  await make({ title: 'Count the stock of the Anua range', projectId: warehouse, priority: 'high', dueDate: day(3), tags: ['stock'], assigneeIds: [people.marek] });
  await make({ title: 'Fix the missing barcodes on four listings', projectId: listings, dueDate: day(4), tags: ['listings'], assigneeIds: [people.marek] });
  await make({ title: 'Negotiate the shipping rates with InPost', projectId: suppliers, dueDate: day(5), tags: ['shipping', 'supplier'], assigneeIds: [people.admin] });
  await make({ title: 'Plan the Black Friday offers', description: 'Which products, how deep, which days.', projectId: campaign, priority: 'high', dueDate: day(9), tags: ['ideas'], assigneeIds: [people.admin, people.ola] });

  // No day.
  await make({ title: 'Think about a loyalty programme', projectId: campaign, tags: ['ideas'], assigneeIds: [people.admin] });
  await make({ title: 'Clean up the old product photos', projectId: listings, priority: 'low', assigneeIds: [people.ola] });

  // Finished over the last days, for the productivity figures.
  const finished: [string, number, string, string][] = [
    ['Send the October invoice reminders', 1, people.admin, suppliers],
    ['Reply to the review on Allegro', 1, people.marek, listings],
    ['Re-photograph the cream', 2, people.ola, campaign],
    ['Update the Von Halsky offers', 2, people.marek, listings],
    ['Check the courier invoices', 2, people.admin, suppliers],
    ['Ship the sample parcels', 4, people.marek, warehouse],
    ['Draft the poster ideas', 5, people.ola, campaign],
    ['Archive the summer campaign', 6, people.admin, campaign],
  ];
  for (const [title, ago, who, projectId] of finished) await make({ title, projectId, status: 'done', dueDate: day(-ago), assigneeIds: [who] }, ago);
}
