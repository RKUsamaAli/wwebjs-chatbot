import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface WhatsappWebStatus {
  status: 'DISCONNECTED' | 'INITIALIZING' | 'QR_READY' | 'CONNECTED';
  qr: string | null;
  info: {
    pushname?: string;
    wid?: {
      user: string;
      server: string;
      _serialized: string;
    };
    platform?: string;
  } | null;
}

@Injectable({
  providedIn: 'root',
})
export class WhatsappWebService {
  constructor(private http: HttpClient) {}

  getStatus(): Observable<WhatsappWebStatus> {
    return this.http
      .get<{ success: boolean; data: WhatsappWebStatus }>(`${environment.apiUrl}/whatsapp-web/status`)
      .pipe(map((res) => res.data));
  }

  connect(): Observable<{ success: boolean; message: string }> {
    return this.http.post<{ success: boolean; message: string }>(
      `${environment.apiUrl}/whatsapp-web/connect`,
      {},
    );
  }

  disconnect(): Observable<{ success: boolean; message: string }> {
    return this.http.post<{ success: boolean; message: string }>(
      `${environment.apiUrl}/whatsapp-web/disconnect`,
      {},
    );
  }
}
