import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Observable, tap, map } from 'rxjs';
import { SocketService } from './socket.service';

export interface Message {
  id: string;
  otherMessageId?: string;
  direction: 'INBOUND' | 'OUTBOUND';
  fromDevice: string;
  toDevice: string;
  type: string;
  content: any;
  status: string;
  createdAt: string;
  sentAt?: string;
  deliveredAt?: string;
  seenAt?: string;
  playedAt?: string;
  error?: string;
}

export interface Conversation {
  phone: string;
  lastMessage: Message;
  unreadCount: number;
}

@Injectable({
  providedIn: 'root'
})
export class MessagesService {
  conversations = signal<Conversation[]>([]);
  activeConversationPhone = signal<string | null>(null);
  activeMessages = signal<Message[]>([]);
  isLoading = signal<boolean>(false);

  currentPage = signal<number>(1);
  hasMore = signal<boolean>(true);
  isLoadingMore = signal<boolean>(false);

  conversationSearch = signal<string>('');
  messageSearch = signal<string>('');
  showMessageSearch = signal<boolean>(false);

  constructor(
    private http: HttpClient,
    private socketService: SocketService,
  ) {
    this.listenToSocketEvents();
  }

  private listenToSocketEvents(): void {
    this.socketService.messageCreated$.subscribe((msg: Message) => {
      const activePhone = this.activeConversationPhone();
      const contactPhone = msg.direction === 'OUTBOUND' ? msg.toDevice : msg.fromDevice;

      // 1. Append if active conversation
      if (activePhone === contactPhone) {
        const exists = this.activeMessages().some(
          m => m.id === msg.id || (m.otherMessageId && m.otherMessageId === msg.otherMessageId)
        );
        if (!exists) {
          this.activeMessages.update(msgs => [...msgs, msg]);
          if (msg.direction === 'INBOUND' && msg.status !== 'READ') {
            this.markConversationAsRead(activePhone, [msg]);
          }
        }
      }

      // 2. Update sidebar conversation list
      this.conversations.update(convs => {
        const index = convs.findIndex(c => c.phone === contactPhone);
        if (index === -1) {
          const newConv: Conversation = {
            phone: contactPhone,
            lastMessage: msg,
            unreadCount: msg.direction === 'INBOUND' && activePhone !== contactPhone ? 1 : 0
          };
          return [newConv, ...convs];
        } else {
          const existing = convs[index];
          const updated = {
            ...existing,
            lastMessage: msg,
            unreadCount: msg.direction === 'INBOUND' && activePhone !== contactPhone && msg.status !== 'READ'
              ? existing.unreadCount + 1
              : existing.unreadCount
          };
          const nextConvs = [...convs];
          nextConvs.splice(index, 1);
          return [updated, ...nextConvs];
        }
      });
    });

    this.socketService.messageStatusUpdated$.subscribe((payload: {
      messageId: string;
      otherMessageId: string;
      status: string;
      sentAt?: string | null;
      deliveredAt?: string | null;
      seenAt?: string | null;
      playedAt?: string | null;
      phone: string;
    }) => {
      const activePhone = this.activeConversationPhone();

      // 1. If active conversation, update message status
      if (activePhone === payload.phone) {
        this.activeMessages.update(msgs =>
          msgs.map(m => {
            if (m.id === payload.messageId || (payload.otherMessageId && m.otherMessageId === payload.otherMessageId)) {
              return {
                ...m,
                status: payload.status,
                ...(payload.sentAt && { sentAt: payload.sentAt }),
                ...(payload.deliveredAt && { deliveredAt: payload.deliveredAt }),
                ...(payload.seenAt && { seenAt: payload.seenAt }),
                ...(payload.playedAt && { playedAt: payload.playedAt }),
              };
            }
            return m;
          })
        );
      }

      // 2. Update status in conversations list
      this.conversations.update(convs =>
        convs.map(c => {
          if (c.phone === payload.phone &&
            (c.lastMessage.id === payload.messageId ||
              (payload.otherMessageId && c.lastMessage.otherMessageId === payload.otherMessageId))) {
            return {
              ...c,
              lastMessage: {
                ...c.lastMessage,
                status: payload.status,
                ...(payload.sentAt && { sentAt: payload.sentAt }),
                ...(payload.deliveredAt && { deliveredAt: payload.deliveredAt }),
                ...(payload.seenAt && { seenAt: payload.seenAt }),
                ...(payload.playedAt && { playedAt: payload.playedAt }),
              }
            };
          }
          return c;
        })
      );
    });
  }

  get filteredConversations(): Conversation[] {
    const q = this.conversationSearch().toLowerCase().trim();
    const sorted = [...this.conversations()].sort((a, b) => {
      return new Date(b.lastMessage.createdAt).getTime() - new Date(a.lastMessage.createdAt).getTime();
    });
    if (!q) return sorted;
    return sorted.filter(c => c.phone.toLowerCase().includes(q));
  }

  get filteredMessages(): Message[] {
    const q = this.messageSearch().toLowerCase().trim();
    if (!q) return this.activeMessages();
    return this.activeMessages().filter(m => {
      const text = m.content?.text?.body || m.content?.caption || '';
      return text.toLowerCase().includes(q);
    });
  }

  addOptimisticMessage(msg: Message) {
    this.activeMessages.update(msgs => [...msgs, msg]);
  }

  removeOptimisticMessage(id: string) {
    this.activeMessages.update(msgs => msgs.filter(m => m.id !== id));
  }

  updateOptimisticState(id: string, partial: Partial<Message>) {
    this.activeMessages.update(msgs => msgs.map(m => m.id === id ? { ...m, ...partial } : m));
  }

  fetchConversations() {
    if (this.conversations().length === 0) {
      this.isLoading.set(true);
    }
    this.http.get<{ success: boolean, data: Message[] }>(`${environment.apiUrl}/messages?limit=100`).subscribe({
      next: (res) => {
        if (res.success) {
          const grouped = new Map<string, Conversation>();

          res.data.forEach(msg => {
            const contactPhone = msg.direction === 'OUTBOUND' ? msg.toDevice : msg.fromDevice;

            if (!grouped.has(contactPhone)) {
              grouped.set(contactPhone, {
                phone: contactPhone,
                lastMessage: msg,
                unreadCount: msg.direction === 'INBOUND' && msg.status !== 'READ' ? 1 : 0
              });
            } else {
              const conv = grouped.get(contactPhone)!;
              if (new Date(msg.createdAt) > new Date(conv.lastMessage.createdAt)) {
                conv.lastMessage = msg;
              }
              if (msg.direction === 'INBOUND' && msg.status !== 'READ') {
                conv.unreadCount += 1;
              }
            }
          });

          const sortedConvs = Array.from(grouped.values()).sort((a, b) => {
            return new Date(b.lastMessage.createdAt).getTime() - new Date(a.lastMessage.createdAt).getTime();
          });
          this.conversations.set(sortedConvs);
        }
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Failed to load conversations', err);
        this.isLoading.set(false);
      }
    });
  }

  fetchMessagesForPhone(phone: string, page: number = 1) {
    if (page === 1) {
      this.activeConversationPhone.set(phone);
      this.currentPage.set(1);
      this.hasMore.set(true);
      this.messageSearch.set('');
      this.showMessageSearch.set(false);
    }

    this.isLoadingMore.set(true);
    const limit = 30;

    this.http.get<{ success: boolean, data: Message[], meta: any }>(
      `${environment.apiUrl}/messages?phone=${phone}&page=${page}&limit=${limit}`
    ).subscribe({
      next: (res) => {
        if (res.success) {
          const apiMessages = res.data.reverse();

          if (page === 1) {
            const tempMessages = this.activeMessages().filter(
              m => m.id.startsWith('temp-') && (m.status === 'UPLOADING' || m.status === 'PENDING' || m.status === 'FAILED')
            );
            this.activeMessages.set([...apiMessages, ...tempMessages]);
            this.markConversationAsRead(phone, apiMessages);
          } else {
            this.activeMessages.update(msgs => [...apiMessages, ...msgs]);
          }

          const totalPages = res.meta?.totalPages || 1;
          this.currentPage.set(page);
          this.hasMore.set(page < totalPages);
        }
        this.isLoadingMore.set(false);
      },
      error: (err) => {
        console.error('Failed to load messages', err);
        this.isLoadingMore.set(false);
      }
    });
  }

  private markConversationAsRead(phone: string, messages: Message[]): void {
    // Clear unread badge immediately in local state
    this.conversations.update(convs =>
      convs.map(c => c.phone === phone ? { ...c, unreadCount: 0 } : c)
    );

    const unreadInbound = messages.filter(
      m => m.direction === 'INBOUND' && m.status !== 'READ' && m.id
    );

    unreadInbound.forEach(msg => {
      this.http.put<{ success: boolean }>(
        `${environment.apiUrl}/messages/${msg.id}/read`, {}
      ).subscribe({ error: (e) => console.warn('markAsRead failed', e) });
    });
  }

  sendText(to: string, body: string, quotedMessageId?: string): Observable<boolean> {
    const payload: any = { to, body };
    if (quotedMessageId) payload.quotedMessageId = quotedMessageId;
    return this.http.post<{ success: boolean, data: any }>(`${environment.apiUrl}/messages/text`, payload).pipe(
      tap(res => {
        if (res.success) {
          this.fetchMessagesForPhone(to);
          this.fetchConversations();
        }
      }),
      map(res => res.success)
    );
  }

  sendMediaDirect(to: string, type: 'image' | 'audio' | 'video' | 'document' | 'sticker', file: File, caption?: string, quotedMessageId?: string): Observable<boolean> {
    const formData = new FormData();
    formData.append('to', to);
    formData.append('type', type);
    formData.append('file', file);
    if (caption) {
      formData.append('caption', caption);
    }
    if (quotedMessageId) {
      formData.append('quotedMessageId', quotedMessageId);
    }

    return this.http.post<{ success: boolean, data: any }>(`${environment.apiUrl}/messages/media`, formData).pipe(
      tap(res => {
        if (res.success) {
          this.fetchMessagesForPhone(to);
          this.fetchConversations();
        }
      }),
      map(res => res.success)
    );
  }

  /** Deletes all messages of a conversation from the local DB. */
  clearConversation(phone: string): Observable<boolean> {
    return this.http.delete<{ success: boolean }>(`${environment.apiUrl}/messages?phone=${encodeURIComponent(phone)}`).pipe(
      tap(res => {
        if (res.success) {
          // Remove from sidebar and clear the open chat if it's the active one.
          this.conversations.update(convs => convs.filter(c => c.phone !== phone));
          if (this.activeConversationPhone() === phone) {
            this.activeMessages.set([]);
          }
        }
      }),
      map(res => res.success)
    );
  }

  /** Opens (or starts) a conversation with the given phone number. */
  openConversation(phone: string): void {
    const cleanPhone = phone.replace(/[+\s-]/g, '');
    this.fetchMessagesForPhone(cleanPhone);
  }
}
