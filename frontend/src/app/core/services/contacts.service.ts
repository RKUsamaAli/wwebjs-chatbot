import { Injectable, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Observable, tap, map } from 'rxjs';

export interface Contact {
  id?: string;
  name: string;
  phone: string;
  waId?: string;
  email?: string;
  createdAt?: string;
  updatedAt?: string;
}

@Injectable({
  providedIn: 'root'
})
export class ContactsService {
  contactsList = signal<Contact[]>([]);
  
  contactsMap = computed(() => {
    const map = new Map<string, Contact>();
    this.contactsList().forEach(c => {
      const cleanPhone = c.phone.replace(/[+\s-]/g, '');
      map.set(cleanPhone, c);
      if (c.waId) {
        const cleanWaId = c.waId.replace(/[+\s-]/g, '');
        map.set(cleanWaId, c);
      }
    });
    return map;
  });

  constructor(private http: HttpClient) {
    this.fetchContacts();
  }

  fetchContacts(): void {
    this.http.get<{ success: boolean; data: Contact[] }>(`${environment.apiUrl}/contacts`).subscribe({
      next: (res) => {
        if (res.success) {
          this.contactsList.set(res.data);
        }
      },
      error: (err) => console.error('Failed to fetch contacts', err)
    });
  }

  getContactName(phone: string): string {
    let cleanPhone = phone.replace(/[+\s-]/g, '');
    // Strip any @c.us or @lid suffix
    cleanPhone = cleanPhone.split('@')[0];
    const contact = this.contactsMap().get(cleanPhone);
    return contact ? contact.name : cleanPhone;
  }

  createContact(contact: Contact): Observable<Contact> {
    return this.http.post<{ success: boolean; data: Contact }>(`${environment.apiUrl}/contacts`, contact).pipe(
      map(res => res.data),
      tap(() => this.fetchContacts())
    );
  }
}
