import { Component, OnInit, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ContactsService, Contact } from '../../core/services/contacts.service';
import { MessagesService } from '../../core/services/messages';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { InputTextModule } from 'primeng/inputtext';

@Component({
  selector: 'app-contacts',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonModule, TooltipModule, InputTextModule],
  template: `
    <div class="contacts-page">
      <!-- Header -->
      <div class="page-header">
        <div>
          <h1 class="page-title">Contacts</h1>
          <p class="page-subtitle">Manage customer contact details for chat conversations</p>
        </div>
        <button id="add-contact-btn" class="add-btn" (click)="openAddModal()">
          <i class="pi pi-plus mr-2"></i> Add Contact
        </button>
      </div>

      <!-- Search & Filters -->
      <div class="search-container">
        <span class="p-input-icon-left w-full max-w-sm">
          <i class="pi pi-search"></i>
          <input type="text" pInputText placeholder="Search contacts by name or phone..." 
                 [formControl]="$any(searchForm.get('query'))" class="w-full" />
        </span>
      </div>

      <!-- Loading State -->
      <div *ngIf="isLoading()" class="loading-state">
        <i class="pi pi-spin pi-spinner"></i>
        <span>Loading contacts...</span>
      </div>

      <!-- Empty State -->
      <div *ngIf="!isLoading() && filteredContacts().length === 0" class="empty-state">
        <div class="empty-icon">
          <i class="pi pi-users"></i>
        </div>
        <h3>No contacts found</h3>
        <p>Contacts will sync automatically when WhatsApp connects, or you can add them manually.</p>
      </div>

      <!-- Contacts List -->
      <div *ngIf="!isLoading() && filteredContacts().length > 0" class="contacts-grid">
        <div *ngFor="let contact of filteredContacts(); trackBy: trackById" class="contact-card">
          <div class="contact-avatar">
            {{ getInitials(contact.name) }}
          </div>
          <div class="contact-details">
            <h3 class="contact-name">{{ contact.name }}</h3>
            <div class="contact-meta">
              <span class="meta-item">
                <i class="pi pi-phone mr-1"></i> +{{ contact.phone }}
              </span>
              <span *ngIf="contact.email" class="meta-item">
                <i class="pi pi-envelope mr-1"></i> {{ contact.email }}
              </span>
            </div>
          </div>
          <div class="contact-actions">
            <button class="action-btn chat-btn" (click)="startChat(contact)" pTooltip="Start Chat">
              <i class="pi pi-comments"></i>
            </button>
          </div>
        </div>
      </div>

      <!-- Add/Edit Contact Modal -->
      <div *ngIf="isModalOpen()" class="modal-backdrop" (click)="closeModal()">
        <div class="modal-content" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <h3>Add New Contact</h3>
            <button class="close-btn" (click)="closeModal()">
              <i class="pi pi-times"></i>
            </button>
          </div>
          <form [formGroup]="contactForm" (ngSubmit)="saveContact()" class="modal-body">
            <div class="form-group">
              <label for="name">Name *</label>
              <input id="name" type="text" pInputText formControlName="name" class="w-full" placeholder="Customer Name" />
              <small *ngIf="contactForm.get('name')?.touched && contactForm.get('name')?.invalid" class="text-red-500">
                Name is required.
              </small>
            </div>
            <div class="form-group">
              <label for="phone">Phone Number *</label>
              <input id="phone" type="text" pInputText formControlName="phone" class="w-full" placeholder="e.g. 923001234567" />
              <small *ngIf="contactForm.get('phone')?.touched && contactForm.get('phone')?.invalid" class="text-red-500">
                Phone number is required (numbers only).
              </small>
            </div>
            <div class="form-group">
              <label for="email">Email Address</label>
              <input id="email" type="email" pInputText formControlName="email" class="w-full" placeholder="customer@email.com" />
              <small *ngIf="contactForm.get('email')?.touched && contactForm.get('email')?.invalid" class="text-red-500">
                Enter a valid email address.
              </small>
            </div>
            
            <div *ngIf="errorMessage()" class="error-banner">
              {{ errorMessage() }}
            </div>

            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" (click)="closeModal()">Cancel</button>
              <button type="submit" class="btn btn-primary" [disabled]="contactForm.invalid || isSaving()">
                <i class="pi pi-spin pi-spinner mr-2" *ngIf="isSaving()"></i> Save
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .contacts-page {
      padding: 2rem;
      max-width: 1000px;
      margin: 0 auto;
      height: 100%;
      overflow-y: auto;
    }

    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 2rem;
    }
    .page-title {
      font-size: 1.75rem;
      font-weight: 700;
      color: #0f172a;
      margin: 0 0 0.25rem;
    }
    .page-subtitle {
      font-size: 0.875rem;
      color: #64748b;
      margin: 0;
    }
    .add-btn {
      background: #3b82f6;
      border: none;
      color: white;
      font-weight: 600;
      font-size: 0.875rem;
      padding: 0.75rem 1.25rem;
      border-radius: 12px;
      cursor: pointer;
      display: flex;
      align-items: center;
      transition: background 0.15s, transform 0.1s;
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.25);
    }
    .add-btn:hover { background: #2563eb; transform: translateY(-1px); }
    .add-btn:active { transform: translateY(0); }

    .search-container {
      margin-bottom: 2rem;
    }

    .loading-state, .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 5rem 2rem;
      gap: 1rem;
      color: #94a3b8;
    }
    .empty-icon {
      width: 80px; height: 80px;
      border-radius: 50%;
      background: #f1f5f9;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2rem;
      color: #cbd5e1;
      margin-bottom: 0.5rem;
    }
    .empty-state h3 { color: #334155; font-size: 1.1rem; margin: 0; }
    .empty-state p { color: #64748b; font-size: 0.875rem; margin: 0; text-align: center; max-width: 320px; }

    .contacts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 1rem;
    }
    .contact-card {
      background: white;
      border: 1px solid #f1f5f9;
      border-radius: 16px;
      padding: 1.25rem;
      display: flex;
      align-items: center;
      gap: 1rem;
      transition: box-shadow 0.2s, border-color 0.2s;
    }
    .contact-card:hover {
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.04);
      border-color: #cbd5e1;
    }

    .contact-avatar {
      width: 48px; height: 48px;
      border-radius: 50%;
      background: #eff6ff;
      color: #3b82f6;
      font-weight: 700;
      font-size: 1.1rem;
      display: flex;
      align-items: center;
      justify-content: center;
      text-transform: uppercase;
      flex-shrink: 0;
    }
    .contact-details {
      flex: 1;
      min-width: 0;
    }
    .contact-name {
      font-weight: 600;
      color: #0f172a;
      font-size: 0.95rem;
      margin: 0 0 0.25rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .contact-meta {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }
    .meta-item {
      font-size: 0.8rem;
      color: #64748b;
      display: flex;
      align-items: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .contact-actions {
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }
    .action-btn {
      border: none;
      background: none;
      width: 32px; height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 0.85rem;
      transition: background 0.15s, transform 0.1s;
    }
    .chat-btn   { color: #10b981; background: #ecfdf5; }
    .chat-btn:hover { background: #d1fae5; transform: scale(1.05); }

    .modal-backdrop {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(15, 23, 42, 0.4);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      animation: fadeIn 0.15s ease-out;
    }
    .modal-content {
      background: white;
      border-radius: 20px;
      width: 100%;
      max-width: 450px;
      box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04);
      animation: slideUp 0.2s ease-out;
      overflow: hidden;
    }

    .modal-header {
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid #f1f5f9;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .modal-header h3 { font-size: 1.1rem; font-weight: 600; color: #0f172a; margin: 0; }
    .close-btn { background: none; border: none; font-size: 1rem; color: #94a3b8; cursor: pointer; }
    .close-btn:hover { color: #64748b; }

    .modal-body {
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    .form-group label {
      font-size: 0.85rem;
      font-weight: 500;
      color: #475569;
    }
    .error-banner {
      background: #fef2f2;
      border: 1px solid #fecaca;
      color: #b91c1c;
      padding: 0.75rem 1rem;
      border-radius: 10px;
      font-size: 0.825rem;
    }

    .modal-footer {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 0.75rem;
      margin-top: 0.5rem;
    }
    .btn {
      padding: 0.65rem 1.25rem;
      border-radius: 10px;
      font-weight: 600;
      font-size: 0.85rem;
      cursor: pointer;
      border: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .btn-secondary { background: #f1f5f9; color: #475569; }
    .btn-secondary:hover { background: #e2e8f0; }
    .btn-primary { background: #3b82f6; color: white; }
    .btn-primary:hover:not(:disabled) { background: #2563eb; }
    .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }

    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  `]
})
export class ContactsComponent implements OnInit {
  isLoading = signal(false);
  isSaving = signal(false);
  isModalOpen = signal(false);
  errorMessage = signal<string | null>(null);

  contactForm: FormGroup;
  searchForm: FormGroup;
  filteredContacts = signal<Contact[]>([]);

  constructor(
    private fb: FormBuilder,
    public contactsService: ContactsService,
    private messagesService: MessagesService,
    private router: Router
  ) {
    this.contactForm = this.fb.group({
      name: ['', Validators.required],
      phone: ['', [Validators.required, Validators.pattern(/^[0-9\\+\\s-]+$/)]],
      email: ['', Validators.email]
    });

    this.searchForm = this.fb.group({
      query: ['']
    });

    // Reactive auto-update of filtered list when contacts list changes
    effect(() => {
      this.filterContacts();
    });
  }

  ngOnInit(): void {
    this.contactsService.fetchContacts();
    this.searchForm.get('query')?.valueChanges.subscribe(() => this.filterContacts());
  }

  filterContacts(): void {
    const q = (this.searchForm.get('query')?.value || '').toLowerCase().trim();
    const list = this.contactsService.contactsList();
    if (!q) {
      this.filteredContacts.set(list);
      return;
    }
    this.filteredContacts.set(
      list.filter((c: Contact) => 
        c.name.toLowerCase().includes(q) || 
        c.phone.toLowerCase().includes(q) || 
        (c.email && c.email.toLowerCase().includes(q))
      )
    );
  }

  getInitials(name: string): string {
    return name.split(' ').map(n => n[0]).slice(0, 2).join('');
  }

  trackById(_: number, c: Contact): string {
    return c.id || c.phone;
  }

  openAddModal(): void {
    this.errorMessage.set(null);
    this.contactForm.reset();
    this.isModalOpen.set(true);
  }

  closeModal(): void {
    this.isModalOpen.set(false);
  }

  saveContact(): void {
    if (this.contactForm.invalid) return;

    this.isSaving.set(true);
    this.errorMessage.set(null);

    const contactVal = this.contactForm.value;

    this.contactsService.createContact(contactVal).subscribe({
      next: () => {
        this.isSaving.set(false);
        this.closeModal();
        this.filterContacts();
      },
      error: (err: any) => {
        this.isSaving.set(false);
        this.errorMessage.set(err?.error?.message || 'An error occurred while saving the contact.');
      }
    });
  }

  startChat(contact: Contact): void {
    const cleanPhone = contact.phone.replace(/[+\s-]/g, '');
    this.messagesService.activeConversationPhone.set(cleanPhone);
    this.messagesService.fetchMessagesForPhone(cleanPhone);
    this.router.navigate(['/inbox']);
  }
}
