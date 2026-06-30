import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MessagesService, Conversation } from '../../../core/services/messages';
import { AvatarModule } from 'primeng/avatar';
import { BadgeModule } from 'primeng/badge';
import { InputTextModule } from 'primeng/inputtext';
import { TooltipModule } from 'primeng/tooltip';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { ContactsService, Contact } from '../../../core/services/contacts.service';

@Component({
  selector: 'app-conversation-list',
  standalone: true,
  imports: [CommonModule, FormsModule, AvatarModule, BadgeModule, InputTextModule, TooltipModule, ButtonModule, DialogModule],
  templateUrl: './conversation-list.html',
  styleUrls: ['./conversation-list.scss']
})
export class ConversationList implements OnInit {
  showNewChatDialog = false;
  newChatPhone = '';
  newChatName = '';

  constructor(
    public messagesService: MessagesService,
    public contactsService: ContactsService
  ) { }

  ngOnInit() {
    this.messagesService.fetchConversations();
  }

  selectConversation(phone: string) {
    this.messagesService.fetchMessagesForPhone(phone);
  }

  openNewChat() {
    this.newChatPhone = '';
    this.newChatName = '';
    this.showNewChatDialog = true;
  }

  startNewChat() {
    const phone = this.newChatPhone.replace(/[+\s-]/g, '');
    if (!/^\d{6,15}$/.test(phone)) {
      alert('Please enter a valid phone number (digits only, including country code).');
      return;
    }

    const name = this.newChatName.trim();
    if (name) {
      const contact: Contact = { phone, name };
      this.contactsService.createContact(contact).subscribe({
        error: (err) => console.warn('Failed to save contact', err)
      });
    }

    this.showNewChatDialog = false;
    this.messagesService.openConversation(phone);
  }

  trackByPhone(index: number, conv: Conversation): string {
    return conv.phone;
  }

  getPreview(conversation: Conversation): string {
    const msg = conversation.lastMessage;
    if (msg.type === 'text') return msg.content?.text?.body || '';
    if (msg.type === 'image') return '📷 Image';
    if (msg.type === 'audio') return '🎵 Audio';
    if (msg.type === 'video') return '🎥 Video';
    if (msg.type === 'document') return '📄 Document';
    return `[${msg.type}]`;
  }

  onSearchInput(value: string) {
    this.messagesService.conversationSearch.set(value);
  }
}
