import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConversationList } from '../conversation-list/conversation-list';
import { ChatWindow } from '../chat-window/chat-window';

@Component({
  selector: 'app-inbox-layout',
  standalone: true,
  imports: [CommonModule, ConversationList, ChatWindow],
  templateUrl: './inbox-layout.html',
  styleUrls: ['./inbox-layout.scss']
})
export class InboxLayout {}
