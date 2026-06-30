import { Injectable, OnDestroy, NgZone } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Subject } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class SocketService implements OnDestroy {
  private socket!: Socket;
  private connected = false;

  // Public event streams
  messageCreated$ = new Subject<any>();
  messageStatusUpdated$ = new Subject<any>();
  wwebQr$ = new Subject<{ qr: string }>();
  wwebStatus$ = new Subject<{ status: string; info?: any }>();

  constructor(private ngZone: NgZone) {
    this.connect();
  }

  private connect(): void {
    // '' (same-origin in prod) → pass undefined so socket.io uses window origin.
    const wsUrl = environment.apiUrl.replace('/api/v1', '') || undefined;

    this.socket = io(wsUrl, {
      transports: ['polling', 'websocket'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
      timeout: 10000,
    });

    this.socket.on('connect', () => {
      this.ngZone.run(() => {
        this.connected = true;
        console.log('[Socket.io] Connected:', this.socket.id);
      });
    });

    this.socket.on('disconnect', (reason) => {
      this.ngZone.run(() => {
        this.connected = false;
        console.log('[Socket.io] Disconnected:', reason);
      });
    });

    this.socket.on('connect_error', (err) => {
      this.ngZone.run(() => {
        console.warn('[Socket.io] Connection error (will retry):', err.message);
      });
    });

    this.socket.on('message:created', (payload: any) => {
      this.ngZone.run(() => {
        console.log('[Socket.io] message:created', payload);
        this.messageCreated$.next(payload);
      });
    });

    this.socket.on('message:status_updated', (payload: any) => {
      this.ngZone.run(() => {
        console.log('[Socket.io] message:status_updated', payload);
        this.messageStatusUpdated$.next(payload);
      });
    });

    this.socket.on('wweb:qr', (payload: { qr: string }) => {
      this.ngZone.run(() => {
        console.log('[Socket.io] wweb:qr');
        this.wwebQr$.next(payload);
      });
    });

    this.socket.on('wweb:status', (payload: { status: string; info?: any }) => {
      this.ngZone.run(() => {
        console.log('[Socket.io] wweb:status', payload);
        this.wwebStatus$.next(payload);
      });
    });
  }

  get isConnected(): boolean {
    return this.connected;
  }

  ngOnDestroy(): void {
    if (this.socket) {
      this.socket.disconnect();
    }
    this.messageCreated$.complete();
    this.messageStatusUpdated$.complete();
    this.wwebQr$.complete();
    this.wwebStatus$.complete();
  }
}
