import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./layouts/dashboard-layout/dashboard-layout').then(m => m.DashboardLayout),
    children: [
      { path: 'inbox', loadComponent: () => import('./features/inbox/inbox-layout/inbox-layout').then(m => m.InboxLayout) },
      { path: 'connect', loadComponent: () => import('./features/connect/connect').then(m => m.WhatsappConnectComponent) },
      { path: 'contacts', loadComponent: () => import('./features/contacts/contacts').then(m => m.ContactsComponent) },
      { path: '', redirectTo: 'inbox', pathMatch: 'full' }
    ]
  },
  { path: '**', redirectTo: 'inbox' }
];
