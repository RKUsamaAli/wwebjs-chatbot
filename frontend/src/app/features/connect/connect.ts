import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';

import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { CheckboxModule } from 'primeng/checkbox';

import { WhatsappWebService } from '../../core/services/whatsapp-web.service';
import { SocketService } from '../../core/services/socket.service';

@Component({
  selector: 'app-connect',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    CardModule,
    ButtonModule,
    TagModule,
    ToastModule,
    CheckboxModule,
  ],
  providers: [MessageService],
  templateUrl: './connect.html',
  styleUrls: ['./connect.scss'],
})
export class WhatsappConnectComponent implements OnInit, OnDestroy {
  wwebConsent = signal<boolean>(false);
  wwebStatus = signal<string>('DISCONNECTED');
  wwebQr = signal<string | null>(null);
  wwebLoading = signal<boolean>(false);
  wwebInfo = signal<any>(null);

  private subs: Subscription[] = [];

  constructor(
    private messageService: MessageService,
    private wwebService: WhatsappWebService,
    private socketService: SocketService,
  ) {}

  ngOnInit(): void {
    this.fetchWwebStatus();
    this.setupWwebSocketListeners();
  }

  ngOnDestroy(): void {
    this.subs.forEach((sub) => sub.unsubscribe());
  }

  private fetchWwebStatus(): void {
    this.wwebService.getStatus().subscribe({
      next: (data) => {
        this.wwebStatus.set(data.status);
        this.wwebQr.set(data.qr);
        this.wwebInfo.set(data.info);
      },
      error: (err) => {
        console.error('Failed to fetch WhatsApp Web status', err);
      },
    });
  }

  private setupWwebSocketListeners(): void {
    this.subs.push(
      this.socketService.wwebQr$.subscribe((data) => {
        this.wwebQr.set(data.qr);
        this.wwebStatus.set('QR_READY');
        this.wwebLoading.set(false);
      }),
      this.socketService.wwebStatus$.subscribe((data) => {
        this.wwebStatus.set(data.status);
        this.wwebInfo.set(data.info);
        if (data.status === 'CONNECTED' || data.status === 'DISCONNECTED') {
          this.wwebQr.set(null);
          this.wwebLoading.set(false);
        }
      }),
    );
  }

  connectWweb(): void {
    if (!this.wwebConsent()) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Consent Required',
        detail: 'Please accept the WhatsApp policies and blocking warning.',
      });
      return;
    }

    this.wwebLoading.set(true);
    this.wwebService.connect().subscribe({
      next: (res) => {
        this.messageService.add({
          severity: 'info',
          summary: 'Initialization Started',
          detail: res.message || 'WhatsApp Web client starting up...',
        });
      },
      error: (err) => {
        this.wwebLoading.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'Connection Failed',
          detail: err?.error?.error || 'Failed to start WhatsApp Web client',
        });
      },
    });
  }

  disconnectWweb(): void {
    this.wwebLoading.set(true);
    this.wwebService.disconnect().subscribe({
      next: (res) => {
        this.wwebStatus.set('DISCONNECTED');
        this.wwebQr.set(null);
        this.wwebInfo.set(null);
        this.wwebLoading.set(false);
        this.messageService.add({
          severity: 'info',
          summary: 'Disconnected',
          detail: res.message || 'WhatsApp Web client disconnected successfully',
        });
      },
      error: (err) => {
        this.wwebLoading.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: err?.error?.error || 'Failed to disconnect WhatsApp Web client',
        });
      },
    });
  }
}
