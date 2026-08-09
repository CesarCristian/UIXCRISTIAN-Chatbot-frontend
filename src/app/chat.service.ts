import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ChatResponse {
  response: string;
  error?: string;
}

@Injectable({
  providedIn: 'root'
})
export class ChatService {
  private readonly apiUrl = 'http://localhost:3000/api/chat';

  constructor(private http: HttpClient) {}

  sendMessage(message: string, history: { role: string; text: string }[] = []): Observable<ChatResponse> {
    return this.http.post<ChatResponse>(this.apiUrl, { message, history });
  }
}
