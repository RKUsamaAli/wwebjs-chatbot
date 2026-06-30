import { Component, ViewChild, ElementRef, OnInit, AfterViewChecked, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MessagesService, Message } from '../../../core/services/messages';
import { AvatarModule } from 'primeng/avatar';
import { TextareaModule } from 'primeng/textarea';
import { ButtonModule } from 'primeng/button';
import { MenuModule } from 'primeng/menu';
import { MenuItem } from 'primeng/api';
import { TooltipModule } from 'primeng/tooltip';
import { InputTextModule } from 'primeng/inputtext';

import { ContactsService } from '../../../core/services/contacts.service';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-chat-window',
  standalone: true,
  imports: [CommonModule, FormsModule, AvatarModule, TextareaModule, ButtonModule, MenuModule, TooltipModule, InputTextModule],
  templateUrl: './chat-window.html',
  styleUrls: ['./chat-window.scss']
})
export class ChatWindow implements OnInit, AfterViewChecked {
  newMessage = '';
  isUploading = false;
  replyingTo: Message | null = null;
  attachmentOptions: MenuItem[] = [];
  headerMenuItems: MenuItem[] = [];
  currentAccept = '*';

  // Audio Recording State
  recordingState: 'inactive' | 'recording' | 'paused' = 'inactive';
  mediaRecorder: MediaRecorder | null = null;
  audioChunks: Blob[] = [];
  recordingDuration = 0;
  private recordingTimer: any = null;
  private isCancelled = false;

  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  @ViewChild('scrollContainer') scrollContainer!: ElementRef<HTMLDivElement>;

  private shouldScrollToBottom = false;
  private previousScrollHeight = 0;
  private shouldRestoreScrollPosition = false;
  private pendingScrollToUnread = false;
  private unreadScrollTargetId = '';
  private shouldScrollToTarget = false;

  // Snapshot of messages that were unread when the conversation was opened, so
  // they stay highlighted for this view even after being marked read.
  unreadIds = new Set<string>();
  firstUnreadId = '';

  constructor(
    public messagesService: MessagesService,
    private router: Router,
    public contactsService: ContactsService,
  ) {
    effect(() => {
      const phone = this.messagesService.activeConversationPhone();
      if (phone) {
        this.pendingScrollToUnread = true;
        // Reset the unread snapshot for the newly opened conversation.
        this.unreadIds = new Set<string>();
        this.firstUnreadId = '';
      }
    });

    effect(() => {
      const messages = this.messagesService.activeMessages();
      const phone = this.messagesService.activeConversationPhone();
      const isLoading = this.messagesService.isLoading();
      if (phone && !isLoading && this.pendingScrollToUnread) {
        const unread = messages.filter(m => m.direction === 'INBOUND' && m.status !== 'READ');
        // Snapshot unread messages so the highlight + divider persist for this
        // view even after they get marked read on open.
        this.unreadIds = new Set(unread.map(m => m.id));
        this.firstUnreadId = unread.length ? unread[0].id : '';
        this.unreadScrollTargetId = this.firstUnreadId || 'bottom';
        this.shouldScrollToTarget = true;
        this.pendingScrollToUnread = false;
      }
    });
  }

  ngOnInit() {
    this.attachmentOptions = [
      { label: 'Image / Video', icon: 'pi pi-image', command: () => this.openFilePicker('image/*,video/*') },
      { label: 'Document', icon: 'pi pi-file', command: () => this.openFilePicker('application/*,.pdf,.doc,.docx,.xls,.xlsx,.zip') },
    ];

    this.headerMenuItems = [
      { label: 'Clear chat', icon: 'pi pi-trash', command: () => this.clearChat() },
    ];
  }

  clearChat() {
    const phone = this.messagesService.activeConversationPhone();
    if (!phone) return;
    const name = this.contactsService.getContactName(phone);
    if (!confirm(`Clear all messages with ${name}? This cannot be undone.`)) return;

    this.messagesService.clearConversation(phone).subscribe({
      error: (err) => {
        console.error('Failed to clear chat', err);
        alert('Failed to clear chat. Please try again.');
      }
    });
  }

  ngAfterViewChecked() {
    if (this.shouldScrollToBottom) {
      this.scrollToBottom();
      this.shouldScrollToBottom = false;
    } else if (this.shouldRestoreScrollPosition) {
      const container = this.scrollContainer.nativeElement;
      container.scrollTop = container.scrollHeight - this.previousScrollHeight;
      this.shouldRestoreScrollPosition = false;
    } else if (this.shouldScrollToTarget) {
      if (this.unreadScrollTargetId === 'bottom') {
        this.scrollToBottom();
        this.shouldScrollToTarget = false;
      } else {
        const el = document.getElementById('msg-' + this.unreadScrollTargetId);
        if (el) {
          el.scrollIntoView({ block: 'start', behavior: 'smooth' });
          this.shouldScrollToTarget = false;
        }
      }
    }
  }

  scrollToBottom() {
    if (this.scrollContainer) {
      setTimeout(() => {
        const container = this.scrollContainer.nativeElement;
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      }, 50);
    }
  }

  onScroll(event: Event) {
    const container = event.target as HTMLDivElement;
    if (container.scrollTop <= 5 && !this.messagesService.isLoadingMore() && this.messagesService.hasMore()) {
      this.loadMore();
    }
  }

  loadMore() {
    const container = this.scrollContainer.nativeElement;
    this.previousScrollHeight = container.scrollHeight;
    this.shouldRestoreScrollPosition = true;

    const phone = this.messagesService.activeConversationPhone();
    if (phone) {
      const nextPage = this.messagesService.currentPage() + 1;
      this.messagesService.fetchMessagesForPhone(phone, nextPage);
    }
  }

  showDateHeader(index: number): boolean {
    const messages = this.messagesService.filteredMessages;
    if (index === 0) return true;

    const currentMsgDate = new Date(messages[index].createdAt).toDateString();
    const prevMsgDate = new Date(messages[index - 1].createdAt).toDateString();

    return currentMsgDate !== prevMsgDate;
  }

  getDateLabel(dateString: string): string {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    } else {
      return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
    }
  }

  trackByMessageId(index: number, msg: Message): string {
    return msg.id || `${index}`;
  }

  openFilePicker(accept: string) {
    this.currentAccept = accept;
    setTimeout(() => this.fileInput.nativeElement.click(), 0);
  }

  onFileSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.handleFileUpload(file);
    this.fileInput.nativeElement.value = '';
  }

  handleFileUpload(file: File) {
    const phone = this.messagesService.activeConversationPhone();
    if (!phone) return;

    let type: 'image' | 'audio' | 'video' | 'document' | 'sticker' = 'document';
    if (file.type.startsWith('image/')) type = 'image';
    else if (file.type.startsWith('audio/')) type = 'audio';
    else if (file.type.startsWith('video/')) type = 'video';

    const tempId = `temp-${Date.now()}`;
    const objectUrl = URL.createObjectURL(file);

    const replyTo = this.replyingTo;
    const quotedMessageId = replyTo ? this.replyTargetId(replyTo) : undefined;
    this.replyingTo = null;

    const tempMsg: Message = {
      id: tempId,
      direction: 'OUTBOUND',
      fromDevice: 'me',
      toDevice: phone,
      type: type,
      content: { [type]: { id: objectUrl }, ...(replyTo ? { context: this.buildReplyContext(replyTo) } : {}) },
      status: 'UPLOADING',
      createdAt: new Date().toISOString()
    };

    this.messagesService.addOptimisticMessage(tempMsg);
    this.isUploading = true;
    this.shouldScrollToBottom = true;

    this.messagesService.sendMediaDirect(phone, type, file, undefined, quotedMessageId).subscribe({
      next: (success) => {
        this.isUploading = false;
        if (success) {
          this.messagesService.updateOptimisticState(tempId, { status: 'SENT' });
        } else {
          this.messagesService.updateOptimisticState(tempId, { status: 'FAILED', error: 'Failed to send media' });
        }
        URL.revokeObjectURL(objectUrl);
      },
      error: (err) => {
        this.isUploading = false;
        this.messagesService.updateOptimisticState(tempId, { status: 'FAILED', error: err?.error?.message || 'Error sending media' });
        URL.revokeObjectURL(objectUrl);
      }
    });
  }

  // ── Audio Recording ───────────────────────────────────────────────────────

  async startRecording() {
    try {
      let mimeType = 'audio/webm';
      let extension = 'webm';
      let options = {};

      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        options = { mimeType: 'audio/webm;codecs=opus' };
        mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/webm')) {
        options = { mimeType: 'audio/webm' };
        mimeType = 'audio/webm';
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        options = { mimeType: 'audio/mp4' };
        mimeType = 'audio/mp4';
        extension = 'mp4';
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaRecorder = new MediaRecorder(stream, options);
      this.audioChunks = [];
      this.isCancelled = false;
      this.recordingDuration = 0;

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) this.audioChunks.push(event.data);
      };

      this.mediaRecorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
        this.stopTimer();
        this.recordingState = 'inactive';
        if (this.isCancelled) return;

        const actualMimeType = this.mediaRecorder?.mimeType || mimeType;
        const audioBlob = new Blob(this.audioChunks, { type: actualMimeType });
        const file = new File([audioBlob], `audio-${Date.now()}.${extension}`, { type: actualMimeType });
        this.handleFileUpload(file);
      };

      this.mediaRecorder.start();
      this.recordingState = 'recording';
      this.startTimer();
    } catch (err) {
      console.error('Microphone access denied', err);
      alert('Microphone access is required to record audio.');
    }
  }

  pauseRecording() {
    if (this.mediaRecorder && this.recordingState === 'recording') {
      this.mediaRecorder.pause();
      this.recordingState = 'paused';
      this.stopTimer();
    }
  }

  resumeRecording() {
    if (this.mediaRecorder && this.recordingState === 'paused') {
      this.mediaRecorder.resume();
      this.recordingState = 'recording';
      this.startTimer();
    }
  }

  cancelRecording() {
    this.isCancelled = true;
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
  }

  sendRecording() {
    this.isCancelled = false;
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
  }

  private startTimer() {
    this.recordingTimer = setInterval(() => { this.recordingDuration++; }, 1000);
  }

  private stopTimer() {
    if (this.recordingTimer) {
      clearInterval(this.recordingTimer);
      this.recordingTimer = null;
    }
  }

  formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  // ── Messages ──────────────────────────────────────────────────────────────

  setReply(msg: Message) {
    this.replyingTo = msg;
  }

  cancelReply() {
    this.replyingTo = null;
  }

  /** The id used to quote a message when replying (server matches by otherMessageId or id). */
  private replyTargetId(msg: Message): string {
    return msg.otherMessageId || msg.id;
  }

  /** Builds the stored reply-context shape for an optimistic bubble. */
  private buildReplyContext(msg: Message): any {
    return {
      id: this.replyTargetId(msg),
      type: msg.type,
      text: this.getContent(msg),
      from: msg.direction === 'OUTBOUND' ? 'me' : msg.fromDevice,
    };
  }

  /** Display name for the author of the message being replied to (composer bar). */
  getReplyTargetName(msg: Message): string {
    if (msg.direction === 'OUTBOUND') return 'You';
    return this.contactsService.getContactName(msg.fromDevice) || msg.fromDevice;
  }

  /** Display name for the author of a quoted message. */
  getQuotedSender(context: any): string {
    if (!context) return '';
    if (context.from === 'me') return 'You';
    return this.contactsService.getContactName(context.from) || context.from;
  }

  /** Short preview text for a quoted message snippet. */
  getQuotedPreview(context: any): string {
    if (!context) return '';
    if (context.text) return context.text;
    return `[${context.type}]`;
  }

  sendMessage() {
    const phone = this.messagesService.activeConversationPhone();
    if (!phone || !this.newMessage.trim()) return;

    const tempId = `temp-${Date.now()}`;
    const msgText = this.newMessage.trim();
    this.newMessage = '';

    const replyTo = this.replyingTo;
    const quotedMessageId = replyTo ? this.replyTargetId(replyTo) : undefined;
    this.replyingTo = null;

    const tempMsg: Message = {
      id: tempId,
      direction: 'OUTBOUND',
      fromDevice: 'me',
      toDevice: phone,
      type: 'text',
      content: { text: { body: msgText }, ...(replyTo ? { context: this.buildReplyContext(replyTo) } : {}) },
      status: 'PENDING',
      createdAt: new Date().toISOString()
    };
    this.messagesService.addOptimisticMessage(tempMsg);
    this.shouldScrollToBottom = true;

    this.messagesService.sendText(phone, msgText, quotedMessageId).subscribe({
      next: (success) => {
        if (success) {
          this.messagesService.updateOptimisticState(tempId, { status: 'SENT' });
        } else {
          this.messagesService.updateOptimisticState(tempId, { status: 'FAILED', error: 'Failed to send text' });
        }
      },
      error: (err) => {
        this.messagesService.updateOptimisticState(tempId, { status: 'FAILED', error: err?.error?.message || 'Failed to send text' });
      }
    });
  }

  // ── In-chat search ────────────────────────────────────────────────────────

  toggleMessageSearch(): void {
    const next = !this.messagesService.showMessageSearch();
    this.messagesService.showMessageSearch.set(next);
    if (!next) this.messagesService.messageSearch.set('');
  }

  onMessageSearchInput(value: string): void {
    this.messagesService.messageSearch.set(value);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  getContent(msg: any): string {
    if (msg.type === 'text') return msg.content?.text?.body || '';
    if (msg.type === 'image') return '📷 Image';
    if (msg.type === 'audio') return '🎵 Audio';
    if (msg.type === 'video') return '🎥 Video';
    if (msg.type === 'document') return '📄 Document';
    return `[${msg.type} message]`;
  }

  getMediaSrc(msg: any): string {
    const type = msg.type;
    const mediaObj = msg.content?.[type];
    if (!mediaObj) return '';

    if (mediaObj.id && mediaObj.id.startsWith('blob:')) {
      return mediaObj.id;
    }

    const contactPhone = msg.direction === 'OUTBOUND' ? msg.toDevice : msg.fromDevice;
    // Derive the server origin from apiUrl: '' (same-origin) in prod, localhost in dev.
    const base = environment.apiUrl.replace('/api/v1', '');
    return `${base}/uploads/${contactPhone}/${mediaObj.localFilename}`;
  }

  getStatusTooltip(msg: any): string {
    let tooltip = `Status: ${msg.status}`;
    if (msg.sentAt) {
      tooltip += `\nSent: ${new Date(msg.sentAt).toLocaleString()}`;
    }
    if (msg.deliveredAt) {
      tooltip += `\nDelivered: ${new Date(msg.deliveredAt).toLocaleString()}`;
    }
    if (msg.seenAt) {
      tooltip += `\nSeen/Read: ${new Date(msg.seenAt).toLocaleString()}`;
    }
    if (msg.playedAt) {
      tooltip += `\nPlayed: ${new Date(msg.playedAt).toLocaleString()}`;
    }
    return tooltip;
  }
}
